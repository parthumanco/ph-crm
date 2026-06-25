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
export const OWNERS = ['Mike', 'Pete', 'Jill'];

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
  // Trim text fields so trailing/leading spaces never cause lookup mismatches
  for (const key of ['company_name', 'contact_name', 'contact_email']) {
    if (typeof payload[key] === 'string') payload[key] = payload[key].trim();
  }
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

// ── Deal Files (deal-level, not tied to a task) ───────────────────────────────

export async function uploadDealFile(dealId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `deal-files/${dealId}/${Date.now()}-${safeName}`;
  const { error: storageErr } = await supabase.storage
    .from('project-files')
    .upload(path, file, { contentType: file.type });
  if (storageErr) throw new Error(storageErr.message);
  const { data: { publicUrl } } = supabase.storage.from('project-files').getPublicUrl(path);
  const { data, error } = await supabase
    .from('deal_files')
    .insert({ deal_id: dealId, name: file.name, size: file.size, mime_type: file.type, storage_path: path, url: publicUrl })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDealFiles(dealId) {
  const { data, error } = await supabase
    .from('deal_files')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteDealFile(id, storagePath) {
  if (storagePath) await supabase.storage.from('project-files').remove([storagePath]);
  const { error } = await supabase.from('deal_files').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Deal Task Files ────────────────────────────────────────────────────────────

export async function uploadDealTaskFile(taskId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `deal-tasks/${taskId}/${Date.now()}-${safeName}`;
  const { error: storageErr } = await supabase.storage
    .from('project-files')
    .upload(path, file, { contentType: file.type });
  if (storageErr) throw new Error(storageErr.message);
  const { data: { publicUrl } } = supabase.storage.from('project-files').getPublicUrl(path);
  const { data, error } = await supabase
    .from('deal_task_files')
    .insert({ task_id: taskId, name: file.name, size: file.size, mime_type: file.type, storage_path: path, url: publicUrl })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDealTaskFiles(taskIds) {
  if (!taskIds.length) return [];
  const { data, error } = await supabase.from('deal_task_files').select('*').in('task_id', taskIds);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteDealTaskFile(id, storagePath) {
  if (storagePath) await supabase.storage.from('project-files').remove([storagePath]);
  const { error } = await supabase.from('deal_task_files').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markDealTaskSent(taskId, sentBy = 'Pete') {
  const { data, error: fetchErr } = await supabase.from('tasks').select('review_chain').eq('id', taskId).single();
  if (fetchErr) console.warn('markDealTaskSent: could not fetch existing chain:', fetchErr.message);
  const chain = Array.isArray(data?.review_chain) ? data.review_chain : [];
  const updated = [...chain, { type: 'sent', by: sentBy, at: new Date().toISOString() }];
  const { error } = await supabase.from('tasks').update({ review_chain: updated }).eq('id', taskId);
  if (error) throw new Error(error.message);
  return updated;
}
