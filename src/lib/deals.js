import { supabase } from './supabase';

export const STAGES = [
  { id: 'prospect',       label: 'Prospect',        color: '#94a3b8' },
  { id: 'outreach',       label: 'Outreach',         color: '#f59e0b' },
  { id: 'responded',      label: 'Responded',        color: '#3b82f6' },
  { id: 'discovery_call', label: 'Discovery Call',   color: '#8b5cf6' },
  { id: 'proposal_sent',  label: 'Proposal Sent',    color: '#ec4899' },
  { id: 'negotiation',    label: 'Negotiation',      color: '#f97316' },
  { id: 'won',            label: 'Won',              color: '#10b981' },
  { id: 'lost',           label: 'Lost',             color: '#ef4444' },
  { id: 'nurture',        label: 'Nurture',          color: '#6b7280' },
];

export const ACTIVE_STAGES  = STAGES.filter(s => !['won','lost','nurture'].includes(s.id));
export const CLOSED_STAGES  = STAGES.filter(s =>  ['won','lost','nurture'].includes(s.id));

export const ACTIVITY_TYPES = ['email','call','meeting','note','proposal','contract'];
export const OWNERS = ['Mike', 'Pete'];

export const stageColor = id => STAGES.find(s => s.id === id)?.color || '#94a3b8';
export const stageLabel = id => STAGES.find(s => s.id === id)?.label || id;

export const dealValue = d =>
  (parseFloat(d.retainer_value) || 0) * 12 + (parseFloat(d.project_value) || 0);

export const fmt$ = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export const daysSince = dateStr => {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
};

// ── Deals ─────────────────────────────────────────────────────────────────────

export async function fetchDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertDeal(deal) {
  const now = new Date().toISOString();
  const payload = { ...deal, updated_at: now };
  if (!payload.id) payload.created_at = now;
  // Coerce empty strings to null for numeric columns
  for (const key of ['retainer_value', 'project_value']) {
    if (payload[key] === '' || payload[key] === undefined) payload[key] = null;
    else if (payload[key] !== null) payload[key] = parseFloat(payload[key]) || null;
  }
  const { data, error } = await supabase
    .from('deals')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function moveStage(dealId, newStage) {
  const now = new Date().toISOString();
  const extra = newStage === 'won'  ? { won_date: now.slice(0,10) }
              : newStage === 'lost' ? { lost_date: now.slice(0,10) }
              : {};
  const { error } = await supabase.from('deals').update({
    stage: newStage,
    stage_entered_at: now,
    updated_at: now,
    ...extra,
  }).eq('id', dealId);
  if (error) throw new Error(error.message);
}

export async function deleteDeal(id) {
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Activities ────────────────────────────────────────────────────────────────

export async function fetchActivities(dealId) {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('deal_id', dealId)
    .order('activity_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function addActivity(activity) {
  const { error } = await supabase.from('activities').insert({
    ...activity,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteActivity(id) {
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function fetchTasks(dealId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('deal_id', dealId)
    .order('due_date', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function addTask(task) {
  const { error } = await supabase.from('tasks').insert({
    ...task,
    completed: false,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function completeTask(id, completed) {
  const { error } = await supabase.from('tasks').update({
    completed,
    completed_at: completed ? new Date().toISOString() : null,
  }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
