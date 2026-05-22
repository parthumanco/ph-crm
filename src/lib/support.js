import { supabase } from './supabase';

export const CASE_STATUSES = [
  { id: 'open',        label: 'Open',              color: '#3b82f6' },
  { id: 'in_progress', label: 'In Progress',        color: '#f59e0b' },
  { id: 'waiting',     label: 'Waiting on Client',  color: '#8b5cf6' },
  { id: 'resolved',    label: 'Resolved',           color: '#10b981' },
  { id: 'closed',      label: 'Closed',             color: '#6b7280' },
];

export const CASE_PRIORITIES = [
  { id: 'urgent', label: 'Urgent', color: '#ef4444', slaHours: 4  },
  { id: 'high',   label: 'High',   color: '#f97316', slaHours: 8  },
  { id: 'normal', label: 'Normal', color: '#3b82f6', slaHours: 24 },
  { id: 'low',    label: 'Low',    color: '#6b7280', slaHours: 72 },
];

export const CHANNELS = [
  { id: 'email',     label: 'Email',     icon: '📧' },
  { id: 'phone',     label: 'Phone',     icon: '📞' },
  { id: 'chat',      label: 'Chat',      icon: '💬' },
  { id: 'social',    label: 'Social',    icon: '📱' },
  { id: 'in_person', label: 'In Person', icon: '🤝' },
];

export const statusColor   = id => CASE_STATUSES.find(s => s.id === id)?.color   || '#6b7280';
export const statusLabel   = id => CASE_STATUSES.find(s => s.id === id)?.label   || id;
export const priorityColor = id => CASE_PRIORITIES.find(p => p.id === id)?.color || '#6b7280';
export const priorityLabel = id => CASE_PRIORITIES.find(p => p.id === id)?.label || id;
export const channelIcon   = id => CHANNELS.find(c => c.id === id)?.icon         || '📧';
export const channelLabel  = id => CHANNELS.find(c => c.id === id)?.label        || id;
export const getSlaHours   = id => CASE_PRIORITIES.find(p => p.id === id)?.slaHours || 24;

export function slaSummary(dueAt, resolvedAt) {
  if (!dueAt) return null;
  const ref    = resolvedAt ? new Date(resolvedAt) : new Date();
  const due    = new Date(dueAt);
  const diffMs = due - ref;
  const diffH  = diffMs / 3600000;

  if (diffH < 0) {
    const absH = Math.abs(Math.floor(diffH));
    const absM = Math.abs(Math.floor((diffMs % 3600000) / 60000));
    return { label: `${absH}h ${absM}m overdue`, status: 'overdue' };
  }
  if (diffH < 1) {
    const m = Math.floor(diffMs / 60000);
    return { label: `${m}m left`, status: 'critical' };
  }
  const h = Math.floor(diffH);
  return { label: `${h}h left`, status: diffH < 4 ? 'warning' : 'ok' };
}

// ── Cases ─────────────────────────────────────────────────────────────────────

export async function fetchCases() {
  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertCase(c) {
  const now = new Date().toISOString();
  // Strip generated column
  const { case_number, ...payload } = c;
  payload.updated_at = now;

  if (!payload.id) {
    payload.created_at = now;
    const hours = getSlaHours(payload.priority || 'normal');
    payload.sla_hours = hours;
    payload.due_at    = new Date(Date.now() + hours * 3600000).toISOString();
  }

  const isClosing = ['resolved', 'closed'].includes(payload.status);
  if (isClosing && !payload.resolved_at) payload.resolved_at = now;
  if (!isClosing) payload.resolved_at = null;

  const { data, error } = await supabase
    .from('cases')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCase(id) {
  const { error } = await supabase.from('cases').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function fetchMessages(caseId) {
  const { data, error } = await supabase
    .from('case_messages')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function addMessage(msg) {
  const { error } = await supabase.from('case_messages').insert({
    ...msg,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteMessage(id) {
  const { error } = await supabase.from('case_messages').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
