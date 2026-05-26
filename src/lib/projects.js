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

export const OWNERS = ['Mike', 'Pete', 'Jill'];

export const projColor = id => PROJECT_STATUSES.find(s => s.id === id)?.color   || '#6b7280';
export const projLabel = id => PROJECT_STATUSES.find(s => s.id === id)?.label   || id;
export const msColor   = id => MILESTONE_STATUSES.find(s => s.id === id)?.color || '#94a3b8';
export const msLabel   = id => MILESTONE_STATUSES.find(s => s.id === id)?.label || id;

export function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function addDays(dateStr, n) {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  d.setDate(d.getDate() + (Number(n) || 0));
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
    .from('projects').select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchArchivedProjects() {
  const { data, error } = await supabase
    .from('projects').select('*')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function archiveProject(id) {
  const { error } = await supabase
    .from('projects').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function restoreProject(id) {
  const { error } = await supabase
    .from('projects').update({ archived_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function upsertProject(p) {
  const now = new Date().toISOString();
  const payload = { ...p, updated_at: now };
  if (!payload.id) {
    payload.id = crypto.randomUUID();
    payload.created_at = now;
  }
  // Convert empty strings to null for date columns
  if (!payload.start_date) payload.start_date = null;
  if (!payload.end_date)   payload.end_date   = null;
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
    .is('archived_at', null)
    .order('order_index', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchArchivedMilestones(projectId) {
  const { data, error } = await supabase
    .from('milestones').select('*').eq('project_id', projectId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function archiveMilestone(id) {
  const { error } = await supabase
    .from('milestones').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function restoreMilestone(id) {
  const { error } = await supabase
    .from('milestones').update({ archived_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
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
  // Try with soft-delete filter first; fall back if column doesn't exist yet
  const { data, error } = await supabase
    .from('project_tasks').select('*').eq('project_id', projectId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true });
  if (error) {
    const { data: fallback, error: err2 } = await supabase
      .from('project_tasks').select('*').eq('project_id', projectId)
      .order('order_index', { ascending: true });
    if (err2) throw new Error(err2.message);
    return fallback || [];
  }
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
  // Soft delete — preserves the row for restore
  const { error } = await supabase
    .from('project_tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    // Column might not exist yet — fall back to hard delete
    const { error: err2 } = await supabase.from('project_tasks').delete().eq('id', id);
    if (err2) throw new Error(err2.message);
  }
}

export async function restoreProjectTask(id, taskData = null) {
  // Try soft-restore first (update deleted_at → null)
  const { data, error } = await supabase
    .from('project_tasks').update({ deleted_at: null }).eq('id', id).select().single();

  // Successful restore
  if (data && !error) return data;

  // Row was hard-deleted or column missing — re-insert from local state
  if (taskData) {
    // eslint-disable-next-line no-unused-vars
    const { deleted_at, ...clean } = taskData;
    return upsertProjectTask({ ...clean, deleted_at: null });
  }

  throw new Error(error?.message || 'Task not found — run: alter table project_tasks add column if not exists deleted_at timestamptz;');
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

// ── PDF Text + Page Extraction ───────────────────────────────────────────────

// Parse Claude's page-marked text into clean text + per-paragraph page numbers
function parseMarkedText(markedText) {
  const sections = [];
  const pagePattern = /\[PAGE (\d+)\]/g;
  let lastIndex = 0, lastPage = 1, match;

  while ((match = pagePattern.exec(markedText)) !== null) {
    if (match.index > lastIndex) {
      sections.push({ page: lastPage, text: markedText.slice(lastIndex, match.index) });
    }
    lastPage = parseInt(match[1]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < markedText.length) {
    sections.push({ page: lastPage, text: markedText.slice(lastIndex) });
  }

  const allParas = [], paraPages = [];
  for (const { page, text } of sections) {
    const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    for (const para of paras) {
      allParas.push(para);
      paraPages.push(page);
    }
  }

  return { text: allParas.join('\n\n'), paraPages };
}

export async function extractPdfTextAndPages(pdfBase64) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) return { text: '', paraPages: [] };

  const prompt = `Extract the complete text of this PDF. Before each new page insert the marker [PAGE N] where N is the page number.

Example:
[PAGE 1]
First page text...

[PAGE 2]
Second page text...

Return only the marked text, nothing else.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: prompt },
      ]}],
    }),
  });

  if (!res.ok) return { text: '', paraPages: [] };
  const json = await res.json();
  const raw  = json.content[0].text.trim();
  return parseMarkedText(raw);
}

// Ask Claude to map each task title directly to the page where it's discussed.
// Returns a plain object { "Task title": pageNumber, ... }.
export async function indexTaskPages(pdfBase64, taskTitles) {
  if (!pdfBase64 || !taskTitles.length) return {};
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) return {};

  const list = taskTitles.map(t => `- ${t}`).join('\n');
  const prompt = `You are reading a project proposal PDF. Below is a list of task titles that were extracted from this proposal.

For each task title, identify the page number where that task or deliverable is described in the most detail (i.e. the dedicated section or paragraph — NOT a brief mention in an overview list or table of contents).

Task titles:
${list}

Return ONLY a valid JSON object — no markdown, no explanation:
{"exact task title": page_number, ...}

Use the exact task title strings as keys. If a task has no dedicated section, use the page where it is most substantively discussed.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: prompt },
      ]}],
    }),
  });

  if (!res.ok) return {};
  const json = await res.json();
  try {
    const raw = json.content[0].text.trim();
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'');
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

// ── AI Proposal Parsing ───────────────────────────────────────────────────────

export async function parseProposalWithAI(proposalText, startDate, pdfBase64 = null) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error('No API key configured');

  const prompt = `You are an expert project manager. Read this proposal and extract a structured project plan.

Project start date: ${startDate}

Return ONLY a valid JSON object with no markdown, no explanation, no code fences. Use this exact structure:
{
  "project_name": "Short descriptive project name",
  "milestones": [
    {
      "title": "Phase name",
      "description": "What this phase delivers",
      "duration_days": 14,
      "page": 3,
      "assigned_to": "",
      "tasks": [
        { "title": "Specific deliverable or action", "duration_days": 3, "page": 4, "assigned_to": "" }
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
- "page" is the PDF page number where the section describing that milestone or task appears — the dedicated section, NOT a table of contents or overview list. If the proposal is plain text (not a PDF), omit page fields or set them to null
- Return ONLY the raw JSON object, nothing else`;

  // Build content array — PDF document block or plain text
  const content = pdfBase64
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: prompt },
      ]
    : `${prompt}\n\nPROPOSAL:\n${proposalText}`;

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
      messages: [{ role: 'user', content }],
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

// ── Project Files ─────────────────────────────────────────────────────────────

export async function fetchProjectFiles(projectId) {
  const { data, error } = await supabase
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function uploadProjectFile(projectId, file, milestoneId = null, taskId = null) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const folder   = taskId       ? `${projectId}/tasks/${taskId}`
                 : milestoneId  ? `${projectId}/${milestoneId}`
                 : `${projectId}/general`;
  const path     = `${folder}/${Date.now()}-${safeName}`;

  const { error: storageErr } = await supabase.storage
    .from('project-files')
    .upload(path, file, { contentType: file.type });
  if (storageErr) throw new Error(storageErr.message);

  const { data: { publicUrl } } = supabase.storage
    .from('project-files')
    .getPublicUrl(path);

  const { data, error } = await supabase
    .from('project_files')
    .insert({
      project_id:   projectId,
      milestone_id: milestoneId || null,
      task_id:      taskId || null,
      name:         file.name,
      size:         file.size,
      mime_type:    file.type,
      storage_path: path,
      url:          publicUrl,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteProjectFile(id, storagePath) {
  // Don't try to delete external links from storage
  if (storagePath && storagePath !== 'external') {
    await supabase.storage.from('project-files').remove([storagePath]);
  }
  const { error } = await supabase.from('project_files').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function addExternalLink(projectId, url, name, milestoneId = null, taskId = null) {
  const { data, error } = await supabase
    .from('project_files')
    .insert({
      project_id:   projectId,
      milestone_id: milestoneId || null,
      task_id:      taskId || null,
      name:         name || url,
      size:         null,
      mime_type:    'link',
      storage_path: 'external',
      url,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
