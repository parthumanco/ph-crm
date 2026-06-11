import { supabase } from './supabase';

export const DOC_TYPES = [
  { id: 'proposal', label: 'Proposal',                   icon: '📋', color: '#3b82f6', bg: '#eff6ff' },
  { id: 'goo',      label: 'Goals & Objectives',         icon: '🎯', color: '#8b5cf6', bg: '#f5f3ff' },
  { id: 'sow',      label: 'Statement of Work',          icon: '📝', color: '#10b981', bg: '#f0fdf4' },
  { id: 'msa',      label: 'Master Services Agreement',  icon: '🤝', color: '#f59e0b', bg: '#fffbeb' },
  { id: 'mnda',     label: 'Mutual NDA',                 icon: '🔒', color: '#ef4444', bg: '#fef2f2' },
];

export const DOC_STATUSES = [
  { id: 'draft',  label: 'Draft',  color: '#94a3b8' },
  { id: 'sent',   label: 'Sent',   color: '#3b82f6' },
  { id: 'signed', label: 'Signed', color: '#10b981' },
];

export const docType   = id => DOC_TYPES.find(t => t.id === id) || DOC_TYPES[0];
export const docStatus = id => DOC_STATUSES.find(s => s.id === id) || DOC_STATUSES[0];

// ── DB operations ─────────────────────────────────────────────────────────────

export async function fetchDocuments({ dealId, companyId, companyName } = {}) {
  let query = supabase
    .from('documents')
    .select('*')
    .order('updated_at', { ascending: false });
  if (dealId)      query = query.eq('deal_id', dealId);
  if (companyId)   query = query.eq('company_id', companyId);
  if (companyName) query = query.ilike('company_name', companyName);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

// ── Company picker — all unique companies across deals + clients ──────────────

export async function fetchAllCompaniesForPicker() {
  const [dealsRes, clientsRes] = await Promise.all([
    supabase.from('deals').select('company_name, stage').not('company_name', 'is', null),
    supabase.from('clients').select('name').not('name', 'is', null),
  ]);

  const seen = new Set();
  const companies = [];

  // From deals — group by stage category
  for (const d of dealsRes.data || []) {
    const name = d.company_name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const isActive = !['won', 'lost', 'nurture'].includes(d.stage);
    companies.push({ name, source: isActive ? 'Pipeline' : 'Past Deal' });
  }

  // From clients table
  for (const c of clientsRes.data || []) {
    const name = c.name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    companies.push({ name, source: 'Client' });
  }

  return companies.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Contacts for a company (from companies + clients tables) ─────────────────

export async function fetchContactsForCompany(companyName) {
  const [compRes, clientRes] = await Promise.all([
    supabase.from('companies').select('contacts').ilike('name', companyName).maybeSingle(),
    supabase.from('clients').select('contacts').ilike('name', companyName).maybeSingle(),
  ]);
  const contacts = [];
  const seen = new Set();
  for (const c of [...(compRes.data?.contacts || []), ...(clientRes.data?.contacts || [])]) {
    const key = (c.name || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    contacts.push(c);
  }
  return contacts;
}

// ── Context gatherer — everything we know about a company ────────────────────

export async function gatherCompanyContext(companyName, contactName = null) {
  const lines = [`COMPANY: ${companyName}`];
  if (contactName) lines.push(`PRIMARY CONTACT: ${contactName}`);

  // 1. Company intel (thesis, summary, scores)
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .ilike('name', companyName)
    .maybeSingle();

  if (company) {
    if (company.website)  lines.push(`WEBSITE: ${company.website}`);
    lines.push('');
    lines.push('== COMPANY INTELLIGENCE ==');
    if (company.summary)   lines.push(`Summary: ${company.summary}`);
    if (company.thesis)    lines.push(`\nThesis:\n${company.thesis}`);
    if (company.icp_score) lines.push(`ICP Score: ${company.icp_score}/10`);
    if (company.overall_score) lines.push(`Signal Score: ${company.overall_score}/10`);
    if (company.recommended_angle) lines.push(`Recommended Angle: ${company.recommended_angle}`);
    const tags = (company.tags || []).map(t => typeof t === 'string' ? t : t?.label || '').filter(Boolean);
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
    const triggers = (company.triggers || []).map(t => typeof t === 'string' ? t : t?.category || t?.label || '').filter(Boolean);
    if (triggers.length) lines.push(`Triggers: ${triggers.join(', ')}`);
    const contacts = (company.contacts || []);
    if (contacts.length) {
      lines.push(`Contacts: ${contacts.map(c => `${c.name}${c.title ? ` (${c.title})` : ''}${c.email ? ` <${c.email}>` : ''}`).join('; ')}`);
    }
    const thesis_risks = (company.thesis_risks || []);
    if (thesis_risks.length) {
      lines.push(`\nKnown Risks:`);
      thesis_risks.forEach(r => lines.push(`  - ${r.title || r}: ${r.detail || ''}`));
    }
  }

  // 2. Most recent/active deal
  const { data: deals } = await supabase
    .from('deals')
    .select('*')
    .ilike('company_name', companyName)
    .order('updated_at', { ascending: false })
    .limit(3);

  const activeDeal = (deals || []).find(d => !['won', 'lost'].includes(d.stage)) || (deals || [])[0];
  if (activeDeal) {
    lines.push('');
    lines.push('== DEAL STATUS ==');
    lines.push(`Stage: ${activeDeal.stage?.replace(/_/g, ' ')}`);
    if (activeDeal.retainer_value) lines.push(`Monthly Retainer: $${parseFloat(activeDeal.retainer_value).toLocaleString()}/mo`);
    if (activeDeal.project_value)  lines.push(`Project Value: $${parseFloat(activeDeal.project_value).toLocaleString()}`);
    if (activeDeal.engagement_type) lines.push(`Engagement Type: ${activeDeal.engagement_type}`);
    if (activeDeal.notes)          lines.push(`\nDeal Notes:\n${activeDeal.notes}`);

    // Activities
    const { data: activities } = await supabase
      .from('activities')
      .select('*')
      .eq('deal_id', activeDeal.id)
      .order('activity_date', { ascending: false })
      .limit(10);

    if ((activities || []).length > 0) {
      lines.push('');
      lines.push('== RECENT ACTIVITIES ==');
      activities.forEach(a => {
        const d = a.activity_date ? new Date(a.activity_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
        lines.push(`[${d}] ${a.type?.toUpperCase() || 'NOTE'}: ${(a.summary || '').slice(0, 200)}`);
      });
    }

    // Open tasks
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('deal_id', activeDeal.id)
      .eq('completed', false)
      .order('created_at', { ascending: true });

    if ((tasks || []).length > 0) {
      lines.push('');
      lines.push('== OPEN NEXT STEPS ==');
      tasks.forEach(t => lines.push(`  - ${t.title}${t.assigned_to ? ` [${t.assigned_to}]` : ''}${t.due_date ? ` due ${t.due_date}` : ''}`));
    }
  }

  // 3. Meetings (from deals + projects)
  const dealIds = (deals || []).map(d => d.id);
  if (dealIds.length) {
    const { data: meetings } = await supabase
      .from('project_meetings')
      .select('*')
      .in('deal_id', dealIds)
      .order('meeting_date', { ascending: false })
      .limit(6);

    if ((meetings || []).length > 0) {
      lines.push('');
      lines.push('== MEETINGS ==');
      meetings.forEach(m => {
        const d = m.meeting_date ? new Date(m.meeting_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
        lines.push(`\n[${d}] ${m.title || 'Meeting'}`);
        if (m.summary) lines.push(`Summary: ${m.summary}`);
        const actions = (m.action_items || []);
        if (actions.length) {
          lines.push(`Action items: ${actions.map(ai => ai.title || ai).join('; ')}`);
        }
      });
    }
  }

  // 4. Active projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, status, description, start_date, end_date, client_name')
    .ilike('client_name', companyName)
    .is('archived_at', null)
    .limit(3);

  if ((projects || []).length > 0) {
    lines.push('');
    lines.push('== ACTIVE PROJECTS ==');
    projects.forEach(p => {
      lines.push(`${p.name} — ${p.status || 'active'}${p.description ? `: ${p.description}` : ''}`);
    });
  }

  return lines.join('\n');
}

// ── Company files (HTML snapshots saved from Document Editor) ─────────────────

const companySlug = name => name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export async function saveDocToCompanyFiles(companyName, docTitle, docId, htmlContent) {
  const slug = companySlug(companyName);
  const safeName = docTitle.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'document';
  const timestamp = Date.now();
  const fileName = `${safeName}-${timestamp}.html`;
  const storagePath = `company-files/${slug}/${fileName}`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const { error: upErr } = await supabase.storage
    .from('project-files')
    .upload(storagePath, blob, { contentType: 'text/html', upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(storagePath);
  const url = urlData?.publicUrl || '';

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('company_files')
    .insert({ company_name: companyName, name: `${safeName}.html`, size: blob.size, mime_type: 'text/html', storage_path: storagePath, url, source: 'document', document_id: docId || null, created_at: now })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchCompanyFiles(companyName) {
  const { data, error } = await supabase
    .from('company_files')
    .select('*')
    .ilike('company_name', companyName)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteCompanyFile(id, storagePath) {
  if (storagePath) {
    await supabase.storage.from('project-files').remove([storagePath]);
  }
  const { error } = await supabase.from('company_files').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function upsertDocument(doc) {
  const now = new Date().toISOString();
  const payload = { ...doc, updated_at: now };
  if (!payload.id) payload.created_at = now;
  const { data, error } = await supabase
    .from('documents')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteDocument(id) {
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Default empty sections per type ──────────────────────────────────────────

const todayLong = () =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

export function defaultSections(type) {
  switch (type) {
    case 'proposal': return {
      prepared_for: '',
      date: todayLong(),
      understanding: '',
      strategic_approach: '',
      objectives: [],
      outcomes: [],
      phases: [],
      investment: '',
      next_steps: '',
    };
    case 'goo': return {
      prepared_for: '',
      date: todayLong(),
      what_we_heard: '',
      the_goal: '',
      objectives: [],
      outcomes: [],
      what_this_is_not: '',
      next_step: '',
    };
    case 'sow': return {
      prepared_for: '',
      date: todayLong(),
      approach: '',
      timeline: '',
      goals: '',
      deliverables: [],
      cost: '',
      payment_schedule: '',
      start_date: '',
    };
    case 'msa': return {
      client_name: '',
      client_entity_type: '',
      client_address: '',
      effective_date: todayLong(),
      non_solicitation_period: '1',
    };
    case 'mnda': return {
      counterparty_name: '',
      counterparty_address: '',
      effective_date: todayLong(),
      purpose: 'evaluation of a possible business relationship',
    };
    default: return {};
  }
}

// ── SOW Standard Terms boilerplate (Part Human branded) ──────────────────────
// Used verbatim in SOW preview/export; AI does not generate these.

export const SOW_STANDARD_TERMS = [
  {
    heading: 'Invoicing and Expenses',
    items: [
      'The project deposit must be received before work commences.',
      'Subsequent invoices will be sent to the Client based on the invoice schedule and are payable upon receipt.',
      "If any deliverable within each period is late or has not been delivered within the time period outlined within this SOW because of any delays on Part Human's part, payment will be postponed until the deliverable has been received by the Client. If the deliverable is not delivered because of any delays due to the Client, payment will still be processed and that deliverable will be included in the next period.",
      "If the project timeline extends more than 2 weeks past the final expected delivery date due to delays on the Client's part, Part Human and the Client will revisit the project schedule and will align on impacts to budget before proceeding to complete the project as outlined in this SOW.",
      'The final invoice will be made once all deliverables are handed over to the Client, given no Client delays as outlined above.',
    ],
  },
  {
    heading: 'Assessment of Scope and Additional Work',
    items: [
      'This estimate will be confirmed upon identification of final project requirements and deliverables after the discovery + definitions phase.',
      'We will assess our estimates at the end of each phase of work with the Client to ensure that the estimate is neither too high nor too low based on the actual complexity of work required and will make adjustments as necessary.',
      'Any work or deliverables outside the scope of activities outlined above will be estimated separately and these cost estimates will be supplied to the Client for approval before additional work is completed.',
      'Anyone who will have input on the project must be present for the kickoff meeting. In the event of a key decision-maker joining the client team after the project has begun, Part Human reserves the right to re-estimate the project.',
      'Any work or support after the final asset hand-off will be discussed and detailed in a separate change order or ongoing support agreement.',
      'This estimate does not include photography, video, or content development and management. These may be sourced and/or estimated as needed, based upon evolving project requirements.',
      'Travel and/or accommodations are not included in this estimate and will be billed in addition to this scope.',
      "Part Human's pricing incorporates up to two weekly meetings/review sessions. A significant increase in the number of live sessions may require an adjustment to the project cost or an additional hourly agreement.",
    ],
  },
  {
    heading: 'Pausing',
    items: [
      'The Client team may put the project on hold or delay project schedule once, at no charge, with two weeks\' advance notice. If less than two weeks\' notice is given, then Part Human reserves the right to bill a hold fee of up to $5,000 per week during the hold period to maintain the team assigned to the project.',
      "If a Client deliverable or payment is late more than 10 business days, the project will be considered 'on hold.'",
      "Once the Client is ready to resume and/or outstanding deliverables or payments have been received, the project will be reactivated and rescheduled based on Part Human's current workload and availability.",
      "If the Client cancels the project by no fault of Part Human or its partners, the Client agrees to pay a termination fee (20% of the remaining estimated project cost) plus a fee for the cost of work performed to date if payment has not already been made.",
      "In the event of the project being canceled, the Client owns all original work that has been created for the project by Part Human for which the Client has paid in full. If the Client decides to restart a project after canceling, a new deposit will be required. Part Human also reserves the right to cancel a project. In the event of Part Human canceling a project, we will return all unused funds and deliver all paid-for work promptly.",
    ],
  },
  {
    heading: 'Ownership',
    items: [
      "The Client owns all original work created for the project by Part Human as soon as payment is received. If payments are current, the Client owns all work completed to date.",
      "Part Human is not to be held responsible for any legal actions taken in response to the work performed in the scope of this statement of work.",
    ],
  },
  {
    heading: 'Dependencies',
    items: [
      "The schedule outlined and fee estimate is dependent on the Client team's availability, timely feedback, and receipt of necessary documentation from the Client. Review sessions and subsequent feedback due dates will be scheduled as the project progresses. If Client feedback is not received according to the feedback due date, the Part Human team will move forward on the project using the deliverables shown in the review session as they were presented. If the Client team becomes unavailable or necessary documentation is not received from the Client promptly, then the project will be paused and the schedule and estimate will be modified via change order.",
    ],
  },
];
