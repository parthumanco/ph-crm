import { supabase } from './supabase';

// ── Clients ───────────────────────────────────────────────────────────────────

export async function fetchClients() {
  // First ensure any projects with client_name but no client_id are reconciled
  try {
    const { data: orphans } = await supabase
      .from('projects')
      .select('id, client_name')
      .not('client_name', 'is', null)
      .neq('client_name', '')
      .is('client_id', null);

    if (orphans?.length > 0) {
      // Create missing client records and link them
      for (const p of orphans) {
        const client = await findOrCreateClient(p.client_name);
        if (client) {
          await supabase.from('projects').update({ client_id: client.id }).eq('id', p.id);
        }
      }
    }
  } catch { /* non-fatal — fetch still proceeds */ }

  const { data, error } = await supabase
    .from('clients')
    .select('*, projects(id, name, status, archived_at, start_date, end_date)')
    .order('name');
  if (error) throw new Error(error.message);
  return (data || []).filter(c => (c.projects || []).length > 0);
}

export async function findOrCreateClient(name) {
  if (!name?.trim()) return null;
  const clean = name.trim();

  // Try to find existing (case-insensitive)
  const { data: existing } = await supabase
    .from('clients')
    .select('*')
    .ilike('name', clean)
    .limit(1)
    .single();
  if (existing) return existing;

  // Create new
  const { data, error } = await supabase
    .from('clients')
    .insert({ name: clean })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Company intelligence (from companies table) ───────────────────────────────

export async function fetchCompanyIntel(clientName) {
  if (!clientName) return null;
  const { data } = await supabase
    .from('companies')
    .select('*')
    .ilike('name', clientName)
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function findOrCreateCompany(name) {
  if (!name?.trim()) throw new Error('Company name required');
  const { data: existing } = await supabase
    .from('companies')
    .select('*')
    .ilike('name', name.trim())
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name: name.trim(), added_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return created;
}

// ── Company research items (links, documents, notes) ───────────────────────────

export async function addCompanyResearchItem(companyId, item) {
  const { data: row } = await supabase.from('companies').select('research_items').eq('id', companyId).single();
  const items = row?.research_items || [];
  const newItem = { id: crypto.randomUUID(), ...item, added_at: new Date().toISOString() };
  const updated = [...items, newItem];
  const { error } = await supabase.from('companies').update({ research_items: updated }).eq('id', companyId);
  if (error) throw new Error(error.message);
  return updated;
}

export async function addCompanyContact(companyId, contact) {
  const { data: row } = await supabase.from('companies').select('contact_angles').eq('id', companyId).single();
  const contacts = row?.contact_angles || [];
  // Skip duplicate names
  if (contacts.some(c => c.name?.toLowerCase() === contact.name?.toLowerCase())) return contacts;
  const updated = [...contacts, { id: crypto.randomUUID(), ...contact }];
  const { error } = await supabase.from('companies').update({ contact_angles: updated }).eq('id', companyId);
  if (error) throw new Error(error.message);
  return updated;
}

export async function deleteCompanyContact(companyId, contactName) {
  const { data: row } = await supabase.from('companies').select('contact_angles').eq('id', companyId).single();
  const updated = (row?.contact_angles || []).filter(c => c.name !== contactName);
  const { error } = await supabase.from('companies').update({ contact_angles: updated }).eq('id', companyId);
  if (error) throw new Error(error.message);
  return updated;
}

export async function updateCompanyContact(companyId, contactName, patch) {
  const { data: row } = await supabase.from('companies').select('contact_angles').eq('id', companyId).single();
  const contacts = row?.contact_angles || [];
  const updated = contacts.map(c => {
    if (c.name !== contactName) return c;
    const merged = { ...c };
    for (const [k, v] of Object.entries(patch)) {
      const trimmed = typeof v === 'string' ? v.trim() : v;
      if (trimmed !== '' && trimmed !== null && trimmed !== undefined) merged[k] = trimmed;
    }
    return merged;
  });
  const { error } = await supabase.from('companies').update({ contact_angles: updated }).eq('id', companyId);
  if (error) throw new Error(error.message);
  return updated;
}

export async function removeCompanyResearchItem(companyId, itemId) {
  const { data: row } = await supabase.from('companies').select('research_items').eq('id', companyId).single();
  const updated = (row?.research_items || []).filter(i => i.id !== itemId);
  const { error } = await supabase.from('companies').update({ research_items: updated }).eq('id', companyId);
  if (error) throw new Error(error.message);
  return updated;
}

export async function runClientDeepScan(companyId, company, icp, detail = {}, clientId = null) {
  const { scanDeepDive } = await import('./anthropic.js');
  const result = await scanDeepDive(company, icp, company.engagement_type || null, detail);

  const stripEmDash = s => (s || '').replace(/\s*—\s*/g, ' – ');
  const update = {
    icp_tier:          result.icpTier    || null,
    icp_score:         result.icpScore   ? Math.round(result.icpScore)   : null,
    overall_score:     result.overallScore ? Math.round(result.overallScore) : null,
    funding_stage:     result.fundingStage || null,
    employee_count_num: result.employeeCountNum ? Math.round(result.employeeCountNum) : null,
    employee_count:    result.employeeCountNum  ? String(Math.round(result.employeeCountNum)) : null,
    summary:           stripEmDash(result.summary) || null,
    triggers:          (result.triggers || []).map(t => ({ ...t, headline: stripEmDash(t.headline), detail: stripEmDash(t.detail) })),
    recommended_angle: stripEmDash(result.recommendedAngle) || null,
    contact_angles:    (result.contactAngles || []).map(ca => ({ ...ca, angle: stripEmDash(ca.angle) })),
    scan_date:         new Date().toISOString(),
    deep_scanned:      true,
    ...(result.website         ? { website:          result.website }         : {}),
    ...(result.hq              ? { hq:               result.hq }              : {}),
    ...(result.industry        ? { industry:         result.industry }        : {}),
    ...(result.companyLinkedinUrl ? { company_linkedin: result.companyLinkedinUrl } : {}),
  };

  const { error } = await supabase.from('companies').update(update).eq('id', companyId);
  if (error) throw new Error(error.message);

  // Auto-populate client contacts from scan results
  if (clientId) {
    const found = extractContactsFromResult(result, 'scan');
    if (found.length) await upsertClientContacts(clientId, found).catch(() => {});
  }

  return { ...company, ...update };
}

export async function runBuildThesis(companyId, company, icp, detail = {}, onProgress = () => {}, clientId = null) {
  const { buildCompanyThesis } = await import('./anthropic.js');
  const result = await buildCompanyThesis(company, icp, detail, (phase, status, data, message) => onProgress(phase, status, data, message));

  const stripEmDash = s => (s || '').replace(/\s*—\s*/g, ' - ');
  const update = {
    icp_score:          result.icp_score      ? Math.round(result.icp_score)      : null,
    overall_score:      result.overall_score  ? Math.round(result.overall_score)  : null,
    icp_tier:           result.icp_tier       || null,
    funding_stage:      result.funding_stage  || null,
    employee_count_num: result.employee_count_num ? Math.round(result.employee_count_num) : null,
    employee_count:     result.employee_count_num ? String(Math.round(result.employee_count_num)) : null,
    hq:                 result.hq             || null,
    industry:           result.industry       || null,
    summary:            stripEmDash(result.summary) || null,
    recommended_angle:  stripEmDash(result.recommended_angle) || null,
    triggers:           (result.triggers || []).map(t => ({ ...t, headline: stripEmDash(t.headline), detail: stripEmDash(t.detail) })),
    contact_angles:     [
      ...(result.entry_contact ? [{ ...result.entry_contact, angle: stripEmDash(result.entry_contact.angle), hook: stripEmDash(result.entry_contact.hook), is_primary: true }] : []),
      ...(result.contact_angles || []).map(ca => ({ ...ca, angle: stripEmDash(ca.angle), hook: stripEmDash(ca.hook) })),
    ],
    thesis:             result.thesis         || null,
    thesis_risks:       result.risks          || [],
    thesis_next_step:   result.next_step      || null,
    thesis_built:       true,
    thesis_date:        new Date().toISOString(),
    deep_scanned:       true,
    scan_date:          new Date().toISOString(),
    ...(result.website ? { website: result.website } : {}),
    ...(result.companyLinkedinUrl ? { company_linkedin: result.companyLinkedinUrl } : {}),
  };

  // Split into safe columns (always exist) and thesis columns (require migration).
  // If we send unknown columns in one payload, Supabase rejects the ENTIRE update.
  const { thesis, thesis_risks, thesis_next_step, thesis_built, thesis_date, research_items, ...safeUpdate } = update;

  // Use .select('id') so we can detect a 0-row update (ID mismatch / RLS silent block)
  const { data: safeRows, error: safeError } = await supabase
    .from('companies').update(safeUpdate).eq('id', companyId).select('id');
  if (safeError) throw new Error(safeError.message);
  if (!safeRows?.length) throw new Error(`Company record not found (id=${companyId}). The deal may point to a stale or missing company row.`);

  // Try to save thesis columns separately — these require DB migration
  // Use .select('id') so we can detect a 0-row update without reading new columns
  // (reading new columns via PostgREST can return null if schema cache is still warming up)
  const thesisUpdate = { thesis, thesis_risks, thesis_next_step, thesis_built, thesis_date };
  const { data: thesisRows, error: thesisError } = await supabase
    .from('companies').update(thesisUpdate).eq('id', companyId).select('id');

  // Auto-populate client contacts from thesis results
  if (clientId) {
    const found = extractContactsFromResult(result, 'thesis');
    if (found.length) await upsertClientContacts(clientId, found).catch(() => {});
  }

  if (thesisError) {
    return { ...company, ...update, _thesisSaveError: thesisError.message };
  }
  if (!thesisRows?.length) {
    return { ...company, ...update, _thesisSaveError: 'Thesis columns are missing from the DB — run the migration SQL in the Supabase SQL editor.' };
  }

  return { ...company, ...update };
}

// ── Contact dossier helpers ───────────────────────────────────────────────────

// Merge a list of new contacts into the clients.contacts column, deduping by name.
// New values win over old; existing enrichment data is preserved if not overwritten.
export async function upsertClientContacts(clientId, newContacts = []) {
  if (!newContacts.length) return [];
  const { data: row } = await supabase.from('clients').select('contacts').eq('id', clientId).single();
  const existing = row?.contacts || [];

  const map = new Map(existing.map(c => [c.name?.toLowerCase(), c]));
  for (const c of newContacts) {
    if (!c.name?.trim()) continue;
    const key = c.name.toLowerCase();
    const prev = map.get(key) || {};
    // Merge: prefer non-empty new values; keep existing enrichment if new doesn't have it
    const merged = { ...prev };
    for (const [k, v] of Object.entries(c)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      merged[k] = v;
    }
    if (!merged.id) merged.id = crypto.randomUUID();
    if (!merged.source) merged.source = 'scan';
    map.set(key, merged);
  }

  const contacts = Array.from(map.values());
  const { error } = await supabase.from('clients').update({ contacts, updated_at: new Date().toISOString() }).eq('id', clientId);
  if (error) throw new Error(error.message);
  return contacts;
}

// Run enrichContactDossier for one contact and merge results back into clients.contacts
export async function enrichClientContact(clientId, contact, companyName) {
  const { enrichContactDossier } = await import('./anthropic.js');
  const enrichment = await enrichContactDossier(contact, companyName);
  if (!enrichment) throw new Error('Enrichment returned no data');

  const merged = { ...contact, ...Object.fromEntries(Object.entries(enrichment).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))), enriched_at: new Date().toISOString() };
  return upsertClientContacts(clientId, [merged]);
}

// Extract contacts from a scan/thesis result and save to clients.contacts
function extractContactsFromResult(result, source = 'scan') {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    if (!c?.name?.trim()) return;
    const key = c.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...c, source });
  };
  // contact_angles (deep scan uses camelCase, thesis uses snake_case)
  (result.contactAngles || result.contact_angles || []).forEach(ca => add({ name: ca.name, title: ca.title, linkedin: ca.linkedinUrl || ca.linkedin || null, angle: ca.angle, hook: ca.hook }));
  // thesis entry contact
  if (result.entry_contact?.name) add({ ...result.entry_contact, is_primary: true });
  // discoveredContacts (deep scan)
  (result.discoveredContacts || []).forEach(c => add({ name: c.name, title: c.title, linkedin: c.linkedinUrl || c.linkedin || null }));
  return out;
}

export async function upsertClient(client) {
  const { data, error } = await supabase
    .from('clients')
    .upsert({ ...client, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Client detail (full context) ─────────────────────────────────────────────

export async function fetchClientDetail(clientId) {
  // Projects linked to this client
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, status, archived_at, start_date, end_date, client_name, contact_name, contacts, description')
    .eq('client_id', clientId)
    .order('start_date', { ascending: false });

  const projectIds = (projects || []).map(p => p.id);

  // Deals matching client name (for activities + deal meetings)
  const client = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()
    .then(r => r.data);

  let deals = [];
  let activities = [];
  if (client?.name) {
    const { data: dealData } = await supabase
      .from('deals')
      .select('id, company_name, contact_name, contact_email, stage, won_date')
      .ilike('company_name', client.name);
    deals = dealData || [];

    const dealIds = deals.map(d => d.id);
    if (dealIds.length > 0) {
      const { data: actData } = await supabase
        .from('activities')
        .select('*')
        .in('deal_id', dealIds)
        .order('activity_date', { ascending: false });
      activities = actData || [];
    }
  }

  // Meetings: from projects + from deals
  let meetings = [];
  const meetingFilters = [];
  if (projectIds.length > 0) meetingFilters.push(`project_id.in.(${projectIds.join(',')})`);
  if (deals.length > 0)      meetingFilters.push(`deal_id.in.(${deals.map(d => d.id).join(',')})`);
  if (meetingFilters.length > 0) {
    const { data: mtgData } = await supabase
      .from('project_meetings')
      .select('*')
      .or(meetingFilters.join(','))
      .order('meeting_date', { ascending: false });
    meetings = mtgData || [];
  }

  // Research items
  const { data: items } = await supabase
    .from('client_items')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  return {
    client,
    projects:   projects   || [],
    deals:      deals,
    activities: activities,
    meetings:   meetings,
    items:      items      || [],
  };
}

// ── Research items ────────────────────────────────────────────────────────────

export async function addClientItem({ clientId, type, title, url, body, addedBy }) {
  const { data, error } = await supabase
    .from('client_items')
    .insert({ client_id: clientId, type, title: title || '', url: url || null, body: body || null, added_by: addedBy || null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteClientItem(id) {
  const { error } = await supabase.from('client_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── AI Q&A ───────────────────────────────────────────────────────────────────

export async function askClientQuestion({ client, projects, activities, meetings, items, intel }, question) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error('No API key configured');

  // Build context string
  const ctx = [];

  ctx.push(`CLIENT: ${client.name}`);
  if (client.website)      ctx.push(`Website: ${client.website}`);
  if (client.linkedin_url) ctx.push(`LinkedIn: ${client.linkedin_url}`);
  if (client.notes)        ctx.push(`Notes: ${client.notes}`);

  // Company intelligence (from companies / deep scan data)
  if (intel) {
    ctx.push('\nCOMPANY INTELLIGENCE:');
    if (intel.industry)        ctx.push(`Industry: ${intel.industry}`);
    if (intel.hq)              ctx.push(`HQ: ${intel.hq}`);
    if (intel.funding_stage)   ctx.push(`Funding stage: ${intel.funding_stage}`);
    if (intel.employee_count)  ctx.push(`Employee count: ${intel.employee_count}`);
    if (intel.icp_tier)        ctx.push(`ICP tier: ${intel.icp_tier}`);
    if (intel.icp_score)       ctx.push(`ICP score: ${intel.icp_score}`);
    if (intel.overall_score)   ctx.push(`Overall score: ${intel.overall_score}`);
    if (intel.engagement_type) ctx.push(`Engagement type: ${intel.engagement_type}`);
    if (intel.summary)         ctx.push(`Summary: ${intel.summary}`);
    if (intel.recommended_angle) ctx.push(`Recommended angle: ${intel.recommended_angle}`);
    if (intel.triggers?.length > 0) {
      ctx.push('Signal triggers:');
      intel.triggers.forEach(t => ctx.push(`  - [${t.category || 'signal'}] ${t.headline}: ${t.detail || ''}`));
    }
    if (intel.contact_angles?.length > 0) {
      ctx.push('Contact angles:');
      intel.contact_angles.forEach(ca => ctx.push(`  - ${ca.name || ''}${ca.title ? ` (${ca.title})` : ''}: ${ca.angle || ''}`));
    }
  }

  if (projects.length > 0) {
    ctx.push('\nPROJECTS:');
    projects.forEach(p => {
      ctx.push(`- ${p.name} (${p.status}) started ${p.start_date || 'unknown'}`);
      if (p.description) ctx.push(`  ${p.description}`);
      // Contacts
      const contacts = [
        ...(p.contacts || []).map(c => `${c.name}${c.title ? ` (${c.title})` : ''}${c.email ? ` <${c.email}>` : ''}`),
        p.contact_name ? p.contact_name : null,
      ].filter(Boolean);
      if (contacts.length > 0) ctx.push(`  Contacts: ${contacts.join(', ')}`);
    });
  }

  if (activities.length > 0) {
    ctx.push('\nACTIVITIES:');
    activities.slice(0, 30).forEach(a => {
      ctx.push(`- [${a.activity_date}] ${a.type} (${a.assigned_to || 'unassigned'}): ${a.summary}`);
    });
  }

  if (meetings.length > 0) {
    ctx.push('\nMEETINGS:');
    meetings.slice(0, 20).forEach(m => {
      ctx.push(`- [${m.meeting_date || 'no date'}] ${m.title}: ${m.summary || ''}`);
      if (m.transcript) ctx.push(`  Transcript excerpt: ${m.transcript.slice(0, 600)}…`);
    });
  }

  if (items.length > 0) {
    ctx.push('\nRESEARCH & NOTES:');
    items.forEach(it => {
      if (it.type === 'note') ctx.push(`- Note: ${it.body || it.title}`);
      if (it.type === 'link') ctx.push(`- Link: ${it.title}${it.url ? ` (${it.url})` : ''}${it.body ? ` — ${it.body}` : ''}`);
    });
  }

  const prompt = `You are an expert business advisor for Part Human, a brand strategy agency. You have been given all available information about one of their clients. Answer the user's question concisely and specifically using this context. If the answer isn't in the context, say so honestly.

CLIENT CONTEXT:
${ctx.join('\n')}

QUESTION: ${question}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  return json.content[0].text.trim();
}
