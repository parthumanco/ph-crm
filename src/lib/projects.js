import { supabase } from './supabase';

export const PROJECT_STATUSES = [
  { id: 'active',    label: 'Active',    color: '#10b981' },
  { id: 'on_hold',   label: 'On Hold',   color: '#f59e0b' },
  { id: 'completed', label: 'Completed', color: '#6b7280' },
  { id: 'cancelled', label: 'Cancelled', color: '#ef4444' },
];

export const MILESTONE_STATUSES = [
  { id: 'not_started', label: 'Not Started', color: '#94a3b8' },
  { id: 'in_progress', label: 'In Progress',  color: '#f59e0b' },
  { id: 'completed',   label: 'Completed',    color: '#10b981' },
  { id: 'blocked',     label: 'Blocked',      color: '#ef4444' },
];

export const OWNERS = ['Mike', 'Pete'];

export const projColor = id => PROJECT_STATUSES.find(s => s.id === id)?.color   || '#6b7280';
export const projLabel = id => PROJECT_STATUSES.find(s => s.id === id)?.label   || id;
export const msColor   = id => MILESTONE_STATUSES.find(s => s.id === id)?.color || '#94a3b8';
export const msLabel   = id => MILESTONE_STATUSES.find(s => s.id === id)?.label || id;

export function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function projectProgress(tasks = []) {
  if (!tasks.length) return 0;
  return Math.round(tasks.filter(t => t.completed).length / tasks.length * 100);
}

export function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function fetchProjects() {
  const { data, error } = await supabase
    .from('projects').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertProject(p) {
  const now = new Date().toISOString();
  const payload = { ...p, updated_at: now };
  if (!payload.id) payload.created_at = now;
  const { data, error } = await supabase
    .from('projects').upsert(payload, { onConflict: 'id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Milestones ────────────────────────────────────────────────────────────────

export async function fetchMilestones(projectId) {
  const { data, error } = await supabase
    .from('milestones').select('*').eq('project_id', projectId)
    .order('order_index', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertMilestone(m) {
  const now = new Date().toISOString();
  const payload = { ...m, updated_at: now };
  if (!payload.id) payload.created_at = now;
  const { data, error } = await supabase
    .from('milestones').upsert(payload, { onConflict: 'id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMilestone(id) {
  const { error } = await supabase.from('milestones').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function fetchProjectTasks(projectId) {
  const { data, error } = await supabase
    .from('project_tasks').select('*').eq('project_id', projectId)
    .order('order_index', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertProjectTask(t) {
  const now = new Date().toISOString();
  const payload = { ...t, created_at: t.created_at || now };
  const { data, error } = await supabase
    .from('project_tasks').upsert(payload, { onConflict: 'id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function toggleTask(id, completed) {
  const { error } = await supabase.from('project_tasks').update({
    completed,
    completed_at: completed ? new Date().toISOString() : null,
  }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProjectTask(id) {
  const { error } = await supabase.from('project_tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Bulk insert for AI-generated timelines
export async function bulkInsertMilestones(rows) {
  const { error } = await supabase.from('milestones').insert(rows);
  if (error) throw new Error(error.message);
}

export async function bulkInsertTasks(rows) {
  const { error } = await supabase.from('project_tasks').insert(rows);
  if (error) throw new Error(error.message);
}

// ── AI Proposal Parsing ───────────────────────────────────────────────────────

export async function parseProposalWithAI(proposalText, startDate) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error('No API key configured');

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
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are an expert project manager. Read this proposal and extract a structured project plan.

Project start date: ${startDate}

PROPOSAL:
${proposalText}

Return ONLY a valid JSON object with no markdown, no explanation, no code fences. Use this exact structure:
{
  "project_name": "Short descriptive project name",
  "milestones": [
    {
      "title": "Phase name",
      "description": "What this phase delivers",
      "duration_days": 14,
      "assigned_to": "",
      "tasks": [
        { "title": "Specific deliverable or action", "duration_days": 3, "assigned_to": "" }
      ]
    }
  ]
}

Rules:
- Create 3–7 sequential phases that reflect the full project scope
- Each milestone starts the day the previous one ends
- Tasks within a milestone are concrete, actionable deliverables
- Estimate realistic durations based on the described work
- assigned_to fields should be blank strings
- Return ONLY the raw JSON object, nothing else`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  const text = json.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response as JSON');
  return JSON.parse(match[0]);
}

export function buildTimelineFromParsed(parsed, projectId, startDateStr) {
  let cursor = startDateStr;
  const milestones = [];
  const tasks = [];
  const now = new Date().toISOString();

  (parsed.milestones || []).forEach((m, mi) => {
    const msStart = cursor;
    const msEnd   = addDays(cursor, m.duration_days || 14);
    const msId    = crypto.randomUUID();

    milestones.push({
      id: msId,
      project_id:  projectId,
      title:       m.title,
      description: m.description || '',
      status:      'not_started',
      assigned_to: m.assigned_to || '',
      start_date:  msStart,
      due_date:    msEnd,
      order_index: mi,
      created_at:  now,
      updated_at:  now,
    });

    let taskCursor = msStart;
    (m.tasks || []).forEach((t, ti) => {
      const tEnd = addDays(taskCursor, t.duration_days || 2);
      tasks.push({
        project_id:  projectId,
        milestone_id: msId,
        title:       t.title,
        assigned_to: t.assigned_to || '',
        due_date:    tEnd,
        completed:   false,
        order_index: ti,
        created_at:  now,
      });
      taskCursor = tEnd;
    });

    cursor = msEnd;
  });

  return { milestones, tasks, endDate: cursor };
}
