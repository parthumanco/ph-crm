import { supabase } from './supabase';

// ── Clients ───────────────────────────────────────────────────────────────────

export async function fetchClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*, projects(id, name, status, start_date, end_date)')
    .order('name');
  if (error) throw new Error(error.message);
  return data || [];
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
    .select('id, name, status, start_date, end_date, client_name, contact_name, contacts, description')
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

export async function askClientQuestion({ client, projects, activities, meetings, items }, question) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error('No API key configured');

  // Build context string
  const ctx = [];

  ctx.push(`CLIENT: ${client.name}`);
  if (client.website)      ctx.push(`Website: ${client.website}`);
  if (client.linkedin_url) ctx.push(`LinkedIn: ${client.linkedin_url}`);
  if (client.notes)        ctx.push(`Notes: ${client.notes}`);

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
