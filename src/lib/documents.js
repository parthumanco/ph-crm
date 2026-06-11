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

export async function fetchDocuments({ dealId, companyId } = {}) {
  let query = supabase
    .from('documents')
    .select('*')
    .order('updated_at', { ascending: false });
  if (dealId)    query = query.eq('deal_id', dealId);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
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
