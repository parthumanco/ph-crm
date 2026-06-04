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
  const update = {
    completed,
    completed_at: completed ? new Date().toISOString() : null,
  };
  // Unchecking resets the entire review chain
  if (!completed) {
    update.approved_at        = null;
    update.approved_by        = null;
    update.rejected_at        = null;
    update.rejected_by        = null;
    update.rejection_notes    = null;
    update.rejection_response = null;
  }
  const { error } = await supabase.from('project_tasks').update(update).eq('id', id);
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

// Effective owner = task.assigned_to OR (if blank) the milestone's assigned_to.
// This function returns all tasks where the effective owner matches `owner`.
export async function fetchAllTasksByOwner(owner) {
  const isUnassigned = owner === '__unassigned__';

  // Helper: run a tasks query with optional soft-delete filter
  async function queryTasks(filter) {
    try {
      const { data, error } = await filter(
        supabase.from('project_tasks').select('*').is('deleted_at', null)
      );
      if (!error) return data || [];
    } catch {}
    // fallback — no deleted_at column
    const { data, error } = await filter(supabase.from('project_tasks').select('*'));
    if (error) throw new Error(error.message);
    return data || [];
  }

  // 1. Tasks directly assigned to owner (or unassigned for the __unassigned__ case)
  const directTasks = await queryTasks(q =>
    isUnassigned
      ? q.or('assigned_to.is.null,assigned_to.eq.').order('due_date', { ascending: true, nullsFirst: false })
      : q.eq('assigned_to', owner).order('due_date', { ascending: true, nullsFirst: false })
  );

  // 2. Find milestones owned by this person, then pull their unassigned tasks
  //    (tasks with no assigned_to fall back to the milestone owner)
  let inheritedTasks = [];
  if (!isUnassigned) {
    const { data: ownerMs } = await supabase
      .from('milestones').select('id').eq('assigned_to', owner);
    const msIds = (ownerMs || []).map(m => m.id);
    if (msIds.length > 0) {
      inheritedTasks = await queryTasks(q =>
        q.in('milestone_id', msIds)
         .or('assigned_to.is.null,assigned_to.eq.')
         .order('due_date', { ascending: true, nullsFirst: false })
      );
    }
  }

  // For __unassigned__: exclude tasks whose milestone IS assigned to someone
  if (isUnassigned) {
    const { data: assignedMs } = await supabase
      .from('milestones').select('id').not('assigned_to', 'is', null).neq('assigned_to', '');
    const assignedMsIds = new Set((assignedMs || []).map(m => m.id));
    const truly = directTasks.filter(t => !t.milestone_id || !assignedMsIds.has(t.milestone_id));
    return truly;
  }

  // Merge direct + inherited, dedupe by id, sort by due_date
  const seen = new Set();
  return [...directTasks, ...inheritedTasks]
    .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
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
  "total_budget": 45000,
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
- "total_budget": extract the total project fee, investment, or contract value as a plain number (no $ or commas). If not stated, omit the field or set to null
- assigned_to fields should be blank strings
- "page" must be the page where that task or milestone is described IN DETAIL — meaning it has its own paragraph, section heading, or substantial explanation of what will be done and how. NEVER use a page that only contains a table of contents, executive summary, scope overview, deliverables list, or any other page where the task appears as a single line or bullet point. If a task is briefly listed on page 2 but has a full description on page 7, "page" must be 7. When in doubt, choose the later page with more detail over the earlier page with a brief mention. If the proposal is plain text (not a PDF), omit page fields or set them to null
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
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchArchivedProjectFiles(projectId) {
  const { data, error } = await supabase
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function archiveProjectFile(id) {
  const { error } = await supabase
    .from('project_files')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function restoreProjectFile(id) {
  const { error } = await supabase
    .from('project_files')
    .update({ archived_at: null })
    .eq('id', id);
  if (error) throw new Error(error.message);
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

export async function fetchProjectByToken(token) {
  const { data, error } = await supabase
    .from('projects').select('*').eq('share_token', token).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function approveMilestone(milestoneId, approvedBy) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('milestones')
    .update({ approved_at: now, approved_by: approvedBy })
    .eq('id', milestoneId);
  if (error) throw new Error(error.message);
}

// ── Review chain helpers ──────────────────────────────────────────────────────

export async function addToReviewChain(taskId, event) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('project_tasks').select('review_chain').eq('id', taskId).single();
  if (error) throw new Error(error.message);
  const chain = Array.isArray(data?.review_chain) ? data.review_chain : [];
  const updated = [...chain, { ...event, at: event.at || now }];
  const { error: err2 } = await supabase
    .from('project_tasks').update({ review_chain: updated }).eq('id', taskId);
  if (err2) throw new Error(err2.message);
  return updated;
}

export async function approveTask(taskId, approvedBy) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('project_tasks')
    .update({ approved_at: now, approved_by: approvedBy, rejected_at: null, rejected_by: null, rejection_notes: null, rejection_response: null })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  const chain = await addToReviewChain(taskId, { type: 'approved', by: approvedBy, at: now });
  await syncMilestoneStatusForTask(taskId);
  return chain;
}

export async function rejectTask(taskId, rejectedBy, notes) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('project_tasks')
    .update({ rejected_at: now, rejected_by: rejectedBy, rejection_notes: notes, approved_at: null, approved_by: null })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  const chain = await addToReviewChain(taskId, { type: 'rejected', by: rejectedBy, notes, at: now });
  // Push milestone back to in_progress so it no longer shows "Completed"
  await syncMilestoneStatusForTask(taskId);
  return chain;
}

// Recalculate and save milestone status based on current tasks in DB.
// Called after portal-side events (reject/approve) where the PM isn't online.
export async function syncMilestoneStatusForTask(taskId) {
  try {
    const { data: task } = await supabase.from('project_tasks').select('milestone_id').eq('id', taskId).single();
    if (!task?.milestone_id) return;
    const msId = task.milestone_id;

    const { data: msTasks } = await supabase.from('project_tasks').select('completed,rejected_at').eq('milestone_id', msId).is('deleted_at', null);
    const tasks = msTasks || [];
    if (!tasks.length) return;

    const hasRejected = tasks.some(t => t.rejected_at);
    const doneCount   = tasks.filter(t => t.completed && !t.rejected_at).length;
    const newStatus   = hasRejected || doneCount < tasks.length
                        ? (doneCount > 0 || hasRejected ? 'in_progress' : 'not_started')
                        : 'completed';

    await supabase.from('milestones').update({ status: newStatus }).eq('id', msId);
  } catch { /* non-fatal */ }
}

// Called when PM sends a revision — clears rejection fields so the portal resets
// to "awaiting approval" state. History is preserved in review_chain.
export async function clearRejectionFields(taskId) {
  const { error } = await supabase.from('project_tasks')
    .update({ rejected_at: null, rejected_by: null, rejection_notes: null, rejection_response: null })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await syncMilestoneStatusForTask(taskId);
}

export async function saveRejectionResponse(taskId, response) {
  const { error } = await supabase.from('project_tasks')
    .update({ rejection_response: response })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
}

// ── Project meetings ──────────────────────────────────────────────────────────

export async function fetchProjectMeetings(projectId) {
  const { data, error } = await supabase
    .from('project_meetings')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function saveProjectMeeting({ projectId, dealId, title, meetingDate, summary, transcript, actionItems }) {
  const { data, error } = await supabase
    .from('project_meetings')
    .insert({
      project_id:   projectId || null,
      deal_id:      dealId    || null,
      title,
      meeting_date: meetingDate || null,
      summary:      summary || null,
      transcript:   transcript || null,
      action_items: actionItems || [],
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDealMeetings(dealId) {
  const { data, error } = await supabase
    .from('project_meetings')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// Migrate deal meetings to a project when a deal is won
export async function migrateDealMeetingsToProject(dealId, projectId) {
  const { error } = await supabase
    .from('project_meetings')
    .update({ project_id: projectId })
    .eq('deal_id', dealId);
  if (error) throw new Error(error.message);
}

export async function generateProposalFromMeetings(meetings, companyName, startDate) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error('No API key configured');

  const today = startDate || new Date().toISOString().slice(0, 10);
  const transcriptBlock = meetings
    .map((m, i) => `--- Meeting ${i + 1}: ${m.title}${m.meeting_date ? ` (${m.meeting_date})` : ''} ---\n${m.transcript || m.summary || ''}`)
    .join('\n\n');

  const prompt = `You are an expert project manager at a creative/digital agency. Based on the following discovery meeting transcripts with a prospective client, generate a structured project proposal plan.

Client/Company: ${companyName || 'Prospective Client'}
Project start date: ${today}

Return ONLY a valid JSON object with no markdown, no explanation, no code fences:
{
  "project_name": "Short descriptive project name",
  "total_budget": null,
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
- Create 3–6 sequential phases that reflect the full project scope based on what was discussed
- Each milestone starts the day the previous one ends
- Tasks within a milestone are concrete, actionable deliverables
- Estimate realistic durations based on the described work
- Base the scope entirely on what the client described needing — don't add things not mentioned
- If budget was discussed, include it as total_budget (number only, no $ or commas)
- Return ONLY the raw JSON object, nothing else

MEETING TRANSCRIPTS:
${transcriptBlock}`;

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
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  const text = json.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response as JSON');
  return JSON.parse(match[0]);
}

export async function deleteProjectMeeting(id) {
  const { error } = await supabase.from('project_meetings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function parseMeetingWithAI(transcript) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error('No API key configured');

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You are an expert project manager. Read this meeting transcript and extract a structured summary.

Today's date: ${today}

Return ONLY a valid JSON object with no markdown, no explanation, no code fences:
{
  "title": "Short descriptive meeting title (eg. 'Kickoff', 'Intro Call', 'Week 2 Check-in')",
  "meeting_date": "YYYY-MM-DD if a date is mentioned or implied, otherwise null",
  "company_name": "The client or prospect company name if identifiable from context, otherwise null",
  "contact_name": "The primary external contact's full name if mentioned, otherwise null",
  "contact_email": "The primary external contact's email if mentioned, otherwise null",
  "summary": "2-3 sentence summary of what was discussed and decided",
  "action_items": [
    {
      "title": "Specific actionable task",
      "owner": "Person responsible if mentioned, otherwise empty string",
      "due_date": "YYYY-MM-DD if a deadline is mentioned, otherwise null",
      "notes": "Any extra context for this task, or empty string"
    }
  ]
}

Rules:
- Only extract genuine action items — things that need to be done, not things already completed
- Keep task titles concise and actionable (start with a verb)
- If no action items are mentioned, return an empty array
- For company_name: extract the client/prospect company, NOT Part Human or the user's own company
- Return ONLY the raw JSON object, nothing else

TRANSCRIPT:
${transcript}`;

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
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  const text = json.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response as JSON');
  return JSON.parse(match[0]);
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
