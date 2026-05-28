import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchProjects, fetchArchivedProjects, upsertProject, archiveProject, restoreProject, deleteProject,
  fetchMilestones, fetchArchivedMilestones, upsertMilestone, archiveMilestone, restoreMilestone, deleteMilestone,
  fetchProjectTasks, upsertProjectTask, toggleTask, deleteProjectTask,
  fetchProjectFiles, uploadProjectFile, deleteProjectFile, addExternalLink,
  restoreProjectTask, fetchAllTasksByOwner,
  bulkInsertMilestones, bulkInsertTasks, parseProposalWithAI,
  PROJECT_STATUSES, MILESTONE_STATUSES, OWNERS,
  projColor, projLabel, msColor, msLabel,
  daysBetween, addDays, projectProgress, fmtDate,
} from '../lib/projects';
import { fetchDeals } from '../lib/deals';
import ProposalImporter from '../components/ProposalImporter';

// ── Small shared components ───────────────────────────────────────────────────

function Badge({ label, color, small }) {
  return (
    <span style={{
      fontSize: small ? 10 : 11, fontWeight: 700, padding: small ? '2px 6px' : '3px 9px',
      borderRadius: 10, background: `${color}18`, color, border: `1px solid ${color}30`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function ProgressBar({ pct, color = '#10b981', height = 6 }) {
  return (
    <div style={{ height, background: 'var(--surface-2)', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: height, transition: 'width .4s' }} />
    </div>
  );
}

function Lbl({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 4 }}>{children}</div>;
}

function fileIcon(mime) {
  if (!mime) return '📎';
  if (mime === 'link') return '🔗';
  if (mime.includes('pdf'))                                        return '📄';
  if (mime.includes('image'))                                      return '🖼️';
  if (mime.includes('word') || mime.includes('document'))         return '📝';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📊';
  return '📎';
}

function parseLinkName(url) {
  try {
    const u = new URL(url);
    // Google Docs / Sheets / Slides — skip uninformative path segments
    if (u.hostname === 'docs.google.com') {
      const type = u.pathname.startsWith('/spreadsheets') ? 'Google Sheet'
                 : u.pathname.startsWith('/presentation') ? 'Google Slides'
                 : 'Google Doc';
      return type;
    }
    const SKIP = new Set(['edit', 'view', 'preview', 'pub', 'copy', '']);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] || '');
    if (last && !SKIP.has(last.toLowerCase()) && last.length > 2) return last;
    return u.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Proposal text helpers ─────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a','an','the','and','or','to','of','in','for','with','on','at','by','from','is','are','be','that','this','it','as','will','we','our','your','their','its','any','all','can','not','have','has','had']);

function titleWords(str) {
  return str.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// Build a search string for the Chrome PDF viewer's #search= parameter.
// Uses the 4 most meaningful words from the task title so the viewer
// highlights the relevant text on the target page.
function pdfSearchParam(title) {
  const words = titleWords(title);
  return encodeURIComponent(words.slice(0, 4).join(' '));
}

// Find the best-matching key in pageHints for a given title using word overlap
function findPageHint(pageHints, taskTitle, fallbackTitle = '') {
  if (!pageHints || !taskTitle) return null;
  const keys = Object.keys(pageHints);
  if (!keys.length) return null;

  // 1. Exact match
  if (pageHints[taskTitle] != null) return pageHints[taskTitle];

  // 2. Case-insensitive exact match
  const lower = taskTitle.toLowerCase();
  const ciKey = keys.find(k => k.toLowerCase() === lower);
  if (ciKey) return pageHints[ciKey];

  // 3. Best word-overlap match across all keys
  const words = titleWords(taskTitle);
  if (words.length) {
    let bestKey = null, bestScore = 0;
    keys.forEach(k => {
      const score = titleWords(k).filter(w => words.includes(w)).length;
      if (score > bestScore) { bestScore = score; bestKey = k; }
    });
    if (bestScore > 0) return pageHints[bestKey];
  }

  // 4. Fall back to milestone title
  if (fallbackTitle) return findPageHint(pageHints, fallbackTitle);

  return null;
}

// Split proposal text into paragraphs and find the one most relevant to a task title.
// Prefers longer, substantive paragraphs (≥20 words) over short list items.
function findRelevantParaIndex(proposalText, taskTitle) {
  if (!proposalText || !taskTitle) return -1;
  const paras = proposalText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return -1;

  const words = titleWords(taskTitle);
  if (!words.length) return -1;

  // Score each paragraph: word-overlap * length bonus (log of word count, floored at 1).
  // Paragraphs under 20 words are still considered but penalised (multiplier 0.3).
  let bestIdx = -1, bestScore = -1;
  paras.forEach((p, i) => {
    const lower = p.toLowerCase();
    const paraWordCount = p.split(/\s+/).filter(Boolean).length;
    const overlap = words.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
    if (overlap === 0) return;
    const lengthFactor = paraWordCount >= 20
      ? Math.log2(paraWordCount)   // ≥20 words: full bonus
      : 0.3;                        // <20 words: heavily penalised
    const score = overlap * lengthFactor;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
}

// ── Gantt chart ───────────────────────────────────────────────────────────────

const LABEL_W = 190;

function GanttChart({ milestones, projectStart, projectEnd, onMilestoneClick }) {
  if (!projectStart || !projectEnd || !milestones.length) return null;
  const totalDays = daysBetween(projectStart, projectEnd);
  if (totalDays <= 0) return null;

  const todayStr  = new Date().toISOString().slice(0, 10);
  const todayPct  = Math.min(100, Math.max(0, daysBetween(projectStart, todayStr) / totalDays * 100));
  const showToday = todayStr >= projectStart && todayStr <= projectEnd;

  // Month label stops
  const months = [];
  const d = new Date(projectStart);
  d.setDate(1);
  while (d.toISOString().slice(0, 10) <= projectEnd) {
    const pct = daysBetween(projectStart, d.toISOString().slice(0, 10)) / totalDays * 100;
    if (pct >= 0 && pct <= 102) {
      months.push({ label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }), pct: Math.max(0, pct) });
    }
    d.setMonth(d.getMonth() + 1);
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 560, position: 'relative' }}>
        {/* Month labels */}
        <div style={{ display: 'flex', marginBottom: 6 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={{ flex: 1, position: 'relative', height: 18 }}>
            {months.map((m, i) => (
              <span key={i} style={{
                position: 'absolute', left: `${m.pct}%`,
                fontSize: 10, color: 'var(--text-faint)', fontWeight: 600,
                transform: 'translateX(-50%)', whiteSpace: 'nowrap',
              }}>{m.label}</span>
            ))}
          </div>
        </div>

        {/* Milestone rows */}
        <div style={{ position: 'relative' }}>
          {/* Today line spanning all rows */}
          {showToday && (
            <div style={{
              position: 'absolute',
              left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${todayPct / 100})`,
              top: -4, bottom: 0, width: 2,
              background: '#ef4444', zIndex: 4, pointerEvents: 'none',
            }}>
              <span style={{
                position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)',
                fontSize: 9, fontWeight: 800, color: '#ef4444', whiteSpace: 'nowrap',
              }}>TODAY</span>
            </div>
          )}

          {milestones.map(m => {
            if (!m.start_date || !m.due_date) return null;
            const lPct = daysBetween(projectStart, m.start_date) / totalDays * 100;
            const wPct = daysBetween(m.start_date, m.due_date)   / totalDays * 100;
            const color = msColor(m.status);
            const clickable = !!onMilestoneClick;

            return (
              <div
                key={m.id}
                onClick={() => onMilestoneClick?.(m.id)}
                style={{
                  display: 'flex', alignItems: 'center', marginBottom: 8, height: 30,
                  cursor: clickable ? 'pointer' : 'default',
                  borderRadius: 4,
                  transition: 'background .12s',
                }}
                onMouseEnter={e => { if (clickable) e.currentTarget.style.background = 'var(--accent-light)'; }}
                onMouseLeave={e => { if (clickable) e.currentTarget.style.background = 'transparent'; }}
                title={clickable ? `Jump to ${m.title}` : m.title}
              >
                {/* Label */}
                <div style={{
                  width: LABEL_W, flexShrink: 0, paddingRight: 12,
                  fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{m.title}</div>

                {/* Track */}
                <div style={{ flex: 1, height: '100%', background: 'var(--surface-2)', borderRadius: 6, position: 'relative' }}>
                  <div style={{
                    position: 'absolute',
                    left:  `${Math.max(0, lPct)}%`,
                    width: `${Math.min(wPct, 100 - Math.max(0, lPct))}%`,
                    minWidth: 6,
                    height: '100%',
                    background: color,
                    borderRadius: 6,
                    opacity: m.status === 'completed' ? 0.55 : 0.88,
                    display: 'flex', alignItems: 'center', paddingLeft: 8,
                    overflow: 'hidden',
                  }}>
                    {m.assigned_to && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
                        {m.assigned_to}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Project list card ─────────────────────────────────────────────────────────

function ProjectCard({ project, tasks, files, onClick, onUpload, onImport, uploading }) {
  const pct    = projectProgress(tasks);
  const color  = projColor(project.status);
  const active = !['completed', 'cancelled'].includes(project.status);

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '18px 20px', cursor: 'pointer',
        transition: 'box-shadow .15s, border-color .15s',
        display: 'flex', flexDirection: 'column', gap: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = 'var(--accent-border)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3 }}>{project.name}</div>
        <Badge label={projLabel(project.status)} color={color} small />
      </div>

      {/* Client */}
      {project.client_name && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          {project.client_name}{project.contact_name ? ` · ${project.contact_name}` : ''}
        </div>
      )}

      {/* Progress */}
      <ProgressBar pct={pct} color={active ? color : '#94a3b8'} />
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, marginBottom: files?.length ? 10 : 0 }}>
        {pct}% complete · {tasks.length} tasks
        {project.end_date ? ` · Due ${fmtDate(project.end_date)}` : ''}
      </div>

      {/* Attached files */}
      {files?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {files.map(f => (
            <a
              key={f.id}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 6,
                background: 'var(--bg)', border: '1px solid var(--border-light)',
                textDecoration: 'none', color: 'var(--text)',
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)' }}>{f.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>
            </a>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
        <button
          onClick={e => { e.stopPropagation(); onImport(project.id); }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)',
            background: 'var(--surface-2)', cursor: 'pointer',
            fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          }}
        >
          📋 Import Proposal
        </button>
        <button
          onClick={e => { e.stopPropagation(); onUpload(project.id, null, e); }}
          disabled={uploading}
          title="Upload a file"
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)',
            background: 'var(--surface-2)', cursor: uploading ? 'default' : 'pointer',
            fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          }}
        >
          {uploading ? '⏳ Uploading…' : '📎 Upload File'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectsPage({ goHomeRef, refreshKey = 0, teamMembers = [] }) {
  // Dynamic owner list from Settings — falls back to hardcoded OWNERS if not configured
  const owners = teamMembers.length ? teamMembers.map(m => m.name) : OWNERS;
  const [view, setView]             = useState('list');   // 'list' | 'detail'
  const [projects, setProjects]     = useState([]);
  const [allTasks, setAllTasks]     = useState({});       // { projectId: tasks[] }
  const [loading, setLoading]       = useState(true);
  const [wonDeals, setWonDeals]     = useState([]);
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [showArchived, setShowArchived]         = useState(false);
  const [loadingArchived, setLoadingArchived]   = useState(false);

  // Detail state
  const [activeProject, setActiveProject]   = useState(null);
  const [milestones, setMilestones]         = useState([]);
  const [tasks, setTasks]                   = useState([]);
  const [loadingDetail, setLoadingDetail]   = useState(false);
  const [expanded, setExpanded]             = useState({});          // milestone expansion
  const [editingMs, setEditingMs]           = useState(null);        // inline edit milestone id
  const [showImporter, setShowImporter]     = useState(false);
  const [newTaskMs, setNewTaskMs]           = useState(null);        // ms id for new task row
  const [newTaskTitle, setNewTaskTitle]     = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProj, setNewProj]               = useState({ name: '', client_name: '', contact_name: '', status: 'active', start_date: new Date().toISOString().slice(0, 10), end_date: '', description: '' });
  const [savingProj, setSavingProj]         = useState(false);
  const [projError, setProjError]           = useState('');
  const [confirmDeleteProj, setConfirmDeleteProj] = useState(false);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null);
  const [deletedTasks, setDeletedTasks]           = useState({});
  const [showArchivedMs, setShowArchivedMs]       = useState({});
  const [archivedMilestones, setArchivedMilestones]   = useState([]);
  const [showArchivedMilestones, setShowArchivedMilestones] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete]   = useState(null); // { type: 'task'|'milestone'|'project', item }
  const [reindexing, setReindexing]                 = useState(false);
  const [assignedOwner, setAssignedOwner]   = useState(OWNERS[0]); // initial fallback — updated below
  const [assignedTasks, setAssignedTasks]   = useState([]);
  const [assignedFiles, setAssignedFiles]   = useState({});  // taskId → File[]
  const [loadingAssigned, setLoadingAssigned] = useState(false);
  const [projectOwnerFilter, setProjectOwnerFilter] = useState(''); // '' = all, '__unassigned__', or owner name
  const [showLinkModal, setShowLinkModal]         = useState(null); // { projectId, milestoneId, taskId }
  const [linkUrl, setLinkUrl]                     = useState('');
  const [linkName, setLinkName]                   = useState('');
  const [editingTask, setEditingTask]             = useState(null); // task id
  const [editTaskDraft, setEditTaskDraft]         = useState({});   // { title, due_date, assigned_to, estimated_hours }
  const [showEstimate, setShowEstimate]           = useState(false);
  const [proposalPanel, setProposalPanel]         = useState(null); // { task } | null

  // File state
  const [projectFiles, setProjectFiles]         = useState([]);
  const [cardFiles, setCardFiles]               = useState({});   // { projectId: files[] } for list view
  const [uploadingFor, setUploadingFor]         = useState(null);
  const [showImporterForProject, setShowImporterForProject] = useState(null); // projectId | null
  const fileInputRef                             = useRef(null);
  const pendingUpload                            = useRef({ projectId: null, milestoneId: null });

  // Register go-home callback so the App header can trigger it
  useEffect(() => {
    if (goHomeRef) goHomeRef.current = () => { setView('list'); setActiveProject(null); };
    return () => { if (goHomeRef) goHomeRef.current = null; };
  }, [goHomeRef]);

  // Load projects + won deals + card-level files
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, deals] = await Promise.all([fetchProjects(), fetchDeals()]);
      setProjects(ps);
      setWonDeals(deals.filter(d => d.stage === 'won'));
      const taskMap = {};
      const fileMap = {};
      await Promise.all(ps.map(async p => {
        const [tasks, files] = await Promise.all([
          fetchProjectTasks(p.id),
          fetchProjectFiles(p.id),
        ]);
        taskMap[p.id] = tasks;
        fileMap[p.id] = files;
      }));
      setAllTasks(taskMap);
      setCardFiles(fileMap);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadAssigned = useCallback(async (owner) => {
    setLoadingAssigned(true);
    try {
      const rawTasks = await fetchAllTasksByOwner(owner);
      const projectIds = [...new Set(rawTasks.map(t => t.project_id).filter(Boolean))];
      const milestoneMap = {};
      const fileMap = {};
      await Promise.all(projectIds.map(async pid => {
        const [ms, files] = await Promise.all([
          fetchMilestones(pid),
          fetchProjectFiles(pid),
        ]);
        ms.forEach(m => { milestoneMap[m.id] = m; });
        files.filter(f => f.task_id).forEach(f => {
          if (!fileMap[f.task_id]) fileMap[f.task_id] = [];
          fileMap[f.task_id].push(f);
        });
      }));
      setAssignedTasks(rawTasks.map(t => {
        const ms = t.milestone_id ? milestoneMap[t.milestone_id] : null;
        return {
          ...t,
          _project:   projects.find(p => p.id === t.project_id) || { name: 'Unknown', id: t.project_id },
          _milestone: ms,
          // _inherited: task has no direct assigned_to — ownership comes from the milestone
          _inherited: !t.assigned_to && !!ms?.assigned_to,
        };
      }));
      setAssignedFiles(fileMap);
    } catch (e) {
      console.error('loadAssigned error:', e);
    } finally {
      setLoadingAssigned(false);
    }
  }, [projects]);

  // Open project detail
  const openProject = async (project) => {
    setActiveProject(project);
    setView('detail');
    setLoadingDetail(true);
    setExpanded({});
    setEditingMs(null);
    setEditingTask(null);
    setConfirmDeleteTask(null);
    setNewTaskMs(null);
    setNewTaskTitle('');
    setProjectOwnerFilter('');
    setProposalPanel(null);
    setDeletedTasks({});
    setShowArchivedMs({});
    setArchivedMilestones([]);
    setShowArchivedMilestones(false);
    setMilestones([]);
    setTasks([]);
    setProjectFiles([]);
    try {
      const [ms, ts, files] = await Promise.all([
        fetchMilestones(project.id),
        fetchProjectTasks(project.id),
        fetchProjectFiles(project.id).catch(() => []),
      ]);
      setMilestones(ms);
      setTasks(ts);
      setProjectFiles(files);
    } catch (e) {
      console.error('Failed to load project detail:', e);
      // Try loading milestones and tasks independently so a single failure
      // doesn't blank the entire view
      try { setMilestones(await fetchMilestones(project.id)); } catch {}
      try { setTasks(await fetchProjectTasks(project.id)); } catch {}
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshDetail = async (projId) => {
    try {
      const [ms, ts, files] = await Promise.all([
        fetchMilestones(projId),
        fetchProjectTasks(projId),
        fetchProjectFiles(projId).catch(() => []),
      ]);
      setMilestones(ms);
      setTasks(ts);
      setProjectFiles(files);
      setAllTasks(prev => ({ ...prev, [projId]: ts }));
    } catch (e) {
      console.error('refreshDetail failed:', e);
    }
  };

  // ── New project ───────────────────────────────────────────────────────────
  const handleCreateProject = async () => {
    if (!newProj.name.trim()) return;
    setSavingProj(true);
    setProjError('');
    try {
      const saved = await upsertProject(newProj);
      await loadAll();
      setShowNewProject(false);
      setNewProj({ name: '', client_name: '', contact_name: '', status: 'active', start_date: new Date().toISOString().slice(0, 10), end_date: '', description: '' });
      openProject(saved);
    } catch (e) {
      setProjError(e.message || 'Failed to save project. Check Supabase RLS is disabled on the projects table.');
    } finally {
      setSavingProj(false);
    }
  };

  // ── Save project header edits ─────────────────────────────────────────────
  const handleSaveProject = async () => {
    const saved = await upsertProject(activeProject);
    setActiveProject(saved);
    setProjects(prev => prev.map(p => p.id === saved.id ? saved : p));
  };

  // ── Archive / restore project ─────────────────────────────────────────────
  const handleArchiveProject = async () => {
    if (!confirmDeleteProj) { setConfirmDeleteProj(true); return; }
    try {
      await archiveProject(activeProject.id);
      setProjects(prev => prev.filter(p => p.id !== activeProject.id));
      setView('list');
    } catch (e) {
      console.error('Archive failed:', e);
      alert('Failed to archive project. Please try again.');
    } finally {
      setConfirmDeleteProj(false);
    }
  };

  const handleLoadArchived = async () => {
    setLoadingArchived(true);
    try {
      const data = await fetchArchivedProjects();
      setArchivedProjects(data);
    } finally {
      setLoadingArchived(false);
    }
  };

  const handleRestoreProject = async (project) => {
    await restoreProject(project.id);
    setArchivedProjects(prev => prev.filter(p => p.id !== project.id));
    await loadAll();
  };

  // ── Milestone edits ───────────────────────────────────────────────────────
  const handleSaveMilestone = async (ms) => {
    const saved = await upsertMilestone(ms);
    setMilestones(prev => prev.map(m => m.id === saved.id ? saved : m));
    setEditingMs(null);
  };

  const handleArchiveMilestone = async (ms) => {
    await archiveMilestone(ms.id);
    setMilestones(prev => prev.filter(m => m.id !== ms.id));
    setArchivedMilestones(prev => [{ ...ms, archived_at: new Date().toISOString() }, ...prev]);
    setShowArchivedMilestones(true);
  };

  const handleRestoreMilestone = async (ms) => {
    await restoreMilestone(ms.id);
    setArchivedMilestones(prev => prev.filter(m => m.id !== ms.id));
    // Re-fetch milestones to restore correct order
    const fresh = await fetchMilestones(activeProject.id);
    setMilestones(fresh);
  };

  // ── Hard delete (permanent) ───────────────────────────────────────────────
  // Re-index: re-parse the stored PDF so Claude maps tasks → pages in one pass
  const handleReindexPages = async () => {
    const pdfUrl = activeProject.proposal_pdf_url;
    if (!pdfUrl || reindexing) return;
    setReindexing(true);
    try {
      // Fetch PDF → base64
      const resp = await fetch(pdfUrl);
      const blob = await resp.blob();
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });

      // Re-parse — Claude reads the PDF and returns page numbers for every task
      const parsed = await parseProposalWithAI('', activeProject.start_date || new Date().toISOString().slice(0,10), base64);

      const hints = {};
      (parsed.milestones || []).forEach(m => {
        (m.tasks || []).forEach(t => {
          if (t.title && t.page != null) hints[t.title] = t.page;
        });
      });
      if (!Object.keys(hints).length) throw new Error('No page numbers returned — try re-importing the proposal');

      // Save to DB + update local state
      await upsertProject({ ...activeProject, proposal_page_hints: hints });
      setActiveProject(prev => ({ ...prev, proposal_page_hints: hints }));
      setProjects(prev => prev.map(p => p.id === activeProject.id ? { ...p, proposal_page_hints: hints } : p));
    } catch (e) {
      console.error('Re-index failed:', e.message);
      alert('Re-index failed: ' + e.message);
    } finally {
      setReindexing(false);
    }
  };

  const handleHardDeleteTask = async (task) => {
    await deleteProjectTask(task.id);
    setDeletedTasks(prev => ({
      ...prev,
      [task.milestone_id]: (prev[task.milestone_id] || []).filter(t => t.id !== task.id),
    }));
    setConfirmHardDelete(null);
  };

  const handleHardDeleteMilestone = async (ms) => {
    await deleteMilestone(ms.id);
    setArchivedMilestones(prev => prev.filter(m => m.id !== ms.id));
    setConfirmHardDelete(null);
  };

  const handleHardDeleteProject = async (project) => {
    await deleteProject(project.id);
    setArchivedProjects(prev => prev.filter(p => p.id !== project.id));
    setConfirmHardDelete(null);
  };

  const handleAddMilestone = async () => {
    const lastMs = milestones[milestones.length - 1];
    const start  = lastMs?.due_date || activeProject.start_date || new Date().toISOString().slice(0, 10);
    const end    = addDays(start, 14);
    const saved  = await upsertMilestone({
      project_id:  activeProject.id,
      title:       'New Milestone',
      description: '',
      status:      'not_started',
      assigned_to: '',
      start_date:  start,
      due_date:    end,
      order_index: milestones.length,
    });
    setMilestones(prev => [...prev, saved]);
    setEditingMs(saved.id);
    setExpanded(prev => ({ ...prev, [saved.id]: true }));
  };

  // ── Task edits ────────────────────────────────────────────────────────────

  // Auto-update milestone status based on task completion:
  //   0 done  → not_started | some done → in_progress | all done → completed
  const syncMilestoneStatus = async (milestoneId, allProjectTasks) => {
    const msTasks = allProjectTasks.filter(t => t.milestone_id === milestoneId);
    if (!msTasks.length) return;
    const doneCount = msTasks.filter(t => t.completed).length;
    const newStatus = doneCount === msTasks.length ? 'completed'
                    : doneCount > 0               ? 'in_progress'
                    :                               'not_started';
    const ms = milestones.find(m => m.id === milestoneId);
    if (!ms || ms.status === newStatus) return;
    const newMs = { ...ms, status: newStatus };
    await upsertMilestone(newMs);
    setMilestones(prev => prev.map(m => m.id === milestoneId ? newMs : m));
  };

  const handleToggleTask = async (task) => {
    await toggleTask(task.id, !task.completed);
    const updated = tasks.map(t => t.id === task.id ? { ...t, completed: !t.completed } : t);
    setTasks(updated);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
    if (task.milestone_id) await syncMilestoneStatus(task.milestone_id, updated);
  };

  const handleAddTask = async (milestoneId) => {
    if (!newTaskTitle.trim()) return;
    const saved = await upsertProjectTask({
      project_id:  activeProject.id,
      milestone_id: milestoneId,
      title:       newTaskTitle.trim(),
      assigned_to: '',
      completed:   false,
      order_index: tasks.filter(t => t.milestone_id === milestoneId).length,
      created_at:  new Date().toISOString(),
    });
    const updated = [...tasks, saved];
    setTasks(updated);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
    setNewTaskTitle('');
    setNewTaskMs(null);
  };

  const handleDeleteTask = async (id) => {
    const task = tasks.find(t => t.id === id);
    try {
      await deleteProjectTask(id);
      const updated = tasks.filter(t => t.id !== id);
      setTasks(updated);
      setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
      // Stash for in-session restore
      if (task) {
        setDeletedTasks(prev => ({
          ...prev,
          [task.milestone_id]: [{ ...task, deleted_at: new Date().toISOString() }, ...(prev[task.milestone_id] || [])],
        }));
      }
    } catch (e) {
      console.error('Delete task failed:', e);
    }
  };

  const handleRestoreTask = async (task) => {
    const restored = await restoreProjectTask(task.id, task);
    const updated = [...tasks, restored].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    setTasks(updated);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
    setDeletedTasks(prev => ({
      ...prev,
      [task.milestone_id]: (prev[task.milestone_id] || []).filter(t => t.id !== task.id),
    }));
  };

  const startEditTask = (task) => {
    setEditingTask(task.id);
    setEditTaskDraft({ title: task.title, due_date: task.due_date || '', assigned_to: task.assigned_to || '', estimated_hours: task.estimated_hours ?? '' });
  };

  // Extend milestone (and project) date bounds if a task date falls outside them.
  // Called after any task due_date save so the Gantt bar stays in sync.
  const syncMilestoneDates = async (updatedTask) => {
    const { due_date, milestone_id, project_id } = updatedTask;
    if (!due_date || !milestone_id) return;
    const ms = milestones.find(m => m.id === milestone_id);
    if (!ms) return;
    let newMs = { ...ms };
    let changed = false;
    if (!ms.due_date || due_date > ms.due_date)   { newMs.due_date   = due_date; changed = true; }
    if (!ms.start_date || due_date < ms.start_date) { newMs.start_date = due_date; changed = true; }
    if (changed) {
      await upsertMilestone(newMs);
      setMilestones(prev => prev.map(m => m.id === newMs.id ? newMs : m));
      // Also extend project end_date if needed
      if (newMs.due_date > (activeProject?.end_date || '')) {
        const updatedProj = { ...activeProject, end_date: newMs.due_date };
        setActiveProject(updatedProj);
        upsertProject(updatedProj).catch(console.error);
      }
    }
  };

  const handleSaveTaskEdit = async (task, overrides = {}) => {
    const draft = { ...editTaskDraft, ...overrides };
    if (!draft.title?.trim()) { setEditingTask(null); return; }
    const updated = {
      ...task,
      title:            draft.title.trim(),
      due_date:         draft.due_date   || null,
      assigned_to:      draft.assigned_to || '',
      estimated_hours:  draft.estimated_hours !== '' && draft.estimated_hours != null ? parseFloat(draft.estimated_hours) : null,
    };
    await upsertProjectTask(updated);
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setAllTasks(prev => ({ ...prev, [activeProject.id]: prev[activeProject.id]?.map(t => t.id === updated.id ? updated : t) || [] }));
    await syncMilestoneDates(updated);
  };

  const handleToggleAssignedTask = async (task) => {
    await toggleTask(task.id, !task.completed);
    setAssignedTasks(prev => prev.map(t =>
      t.id === task.id ? { ...t, completed: !t.completed, completed_at: !task.completed ? new Date().toISOString() : null } : t
    ));
    if (task.milestone_id && task.project_id) {
      const projectTasks = (allTasks[task.project_id] || []).map(t =>
        t.id === task.id ? { ...t, completed: !t.completed } : t
      );
      await syncMilestoneStatus(task.milestone_id, projectTasks);
    }
  };

  const handleSaveAssignedTaskEdit = async (task, overrides = {}) => {
    const draft = { ...editTaskDraft, ...overrides };
    if (!draft.title?.trim()) { setEditingTask(null); return; }
    const updated = { ...task, title: draft.title.trim(), due_date: draft.due_date || null, assigned_to: draft.assigned_to || '', estimated_hours: draft.estimated_hours !== '' && draft.estimated_hours != null ? parseFloat(draft.estimated_hours) : null };
    await upsertProjectTask(updated);
    setAssignedTasks(prev => prev.map(t =>
      t.id === updated.id ? { ...updated, _project: t._project, _milestone: t._milestone } : t
    ));
    await syncMilestoneDates(updated);
    // Keep in list if still directly assigned OR still inherited via milestone
    const milestoneOwner = task._milestone?.assigned_to || '';
    const stillMatches =
      assignedOwner === '__unassigned__'
        ? (!updated.assigned_to && !milestoneOwner)
        : (updated.assigned_to === assignedOwner || (!updated.assigned_to && milestoneOwner === assignedOwner));
    if (!stillMatches) {
      setAssignedTasks(prev => prev.filter(t => t.id !== updated.id));
      setEditingTask(null);
    } else {
      // Re-compute _inherited flag after edit
      setAssignedTasks(prev => prev.map(t =>
        t.id === updated.id
          ? { ...t, ...updated, _inherited: !updated.assigned_to && !!milestoneOwner }
          : t
      ));
    }
  };

  const handleDeleteAssignedTask = async (id) => {
    try {
      await deleteProjectTask(id);
      setAssignedTasks(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      console.error('Delete assigned task failed:', e);
    }
  };

  // ── Proposal import callback (works from card OR detail view) ────────────
  const handleImported = async ({ startDate, projectName, milestones: msParsed, proposalText, proposalPdfFile, proposalPageHints, gdocUrl, gdocName }, fromProjectId) => {
    const projectId = fromProjectId || activeProject?.id;
    const baseProj  = projects.find(p => p.id === projectId) || activeProject;
    const fromCard  = !!fromProjectId;
    try {
      const updatedProj = {
        ...baseProj,
        name:       baseProj.name || projectName || baseProj.name,
        start_date: startDate,
      };

      const now = new Date().toISOString();
      let cursor = startDate;
      const msRows = [];
      const tRows  = [];

      msParsed.forEach((m, mi) => {
        const msId  = m._id || crypto.randomUUID();
        const msEnd = addDays(cursor, m.duration);
        msRows.push({
          id:          msId,
          project_id:  projectId,
          title:       m.title,
          description: m.description || '',
          status:      'not_started',
          assigned_to: m.assigned_to || '',
          start_date:  cursor,
          due_date:    msEnd,
          order_index: mi,
          created_at:  now,
          updated_at:  now,
        });
        let taskCursor = cursor;
        (m.tasks || []).forEach((t, ti) => {
          const tEnd = addDays(taskCursor, t.duration || 2);
          tRows.push({
            project_id:   projectId,
            milestone_id: msId,
            title:        t.title,
            assigned_to:  t.assigned_to || '',
            due_date:     tEnd,
            completed:    false,
            order_index:  ti,
            created_at:   now,
          });
          taskCursor = tEnd;
        });
        cursor = msEnd;
      });

      updatedProj.end_date = cursor;

      // ── Save timeline first (never blocked by proposal columns) ──────────
      const savedProj = await upsertProject(updatedProj);
      await bulkInsertMilestones(msRows);
      await bulkInsertTasks(tRows);

      // ── Save proposal reference separately — fails gracefully if columns
      //    haven't been added to the DB yet ──────────────────────────────────
      try {
        const proposalUpdate = { id: savedProj.id };
        if (proposalText)      proposalUpdate.proposal_text       = proposalText;
        if (proposalPageHints) proposalUpdate.proposal_page_hints = proposalPageHints;
        if (proposalPdfFile) {
          const fileRecord = await uploadProjectFile(projectId, proposalPdfFile);
          proposalUpdate.proposal_pdf_url = fileRecord.url;
        }
        if (gdocUrl) {
          await addExternalLink(projectId, gdocUrl, gdocName || 'Google Doc');
        }
        if (proposalText || proposalPdfFile || proposalPageHints) {
          await upsertProject({ ...savedProj, ...proposalUpdate });
        }
        // Merge proposal fields into the project we'll put in state
        Object.assign(savedProj, proposalUpdate);
      } catch (proposalErr) {
        console.warn('Proposal reference not saved (run DB migrations):', proposalErr.message);
      }

      setProjects(prev => prev.map(p => p.id === savedProj.id ? savedProj : p));

      if (fromCard) {
        // Refresh card tasks
        const ts = await fetchProjectTasks(projectId);
        setAllTasks(prev => ({ ...prev, [projectId]: ts }));
        setShowImporterForProject(null);
        // Also update the card's project data so proposal fields are available
        setProjects(prev => prev.map(p => p.id === savedProj.id ? savedProj : p));
      } else {
        // Re-fetch project so we get proposal_text / proposal_pdf_url fields
        const freshProjects = await fetchProjects();
        const freshProj = freshProjects.find(p => p.id === savedProj.id) || savedProj;
        setProjects(freshProjects);
        setActiveProject(freshProj);
        await refreshDetail(savedProj.id);
        setShowImporter(false);
      }
    } catch (e) {
      console.error('Import failed:', e);
      if (fromCard) setShowImporterForProject(null);
      else setShowImporter(false);
    }
  };

  // ── File uploads ──────────────────────────────────────────────────────────
  const triggerFileUpload = (projectId, milestoneId = null, e = null, taskId = null) => {
    if (e) e.stopPropagation();
    pendingUpload.current = { projectId, milestoneId, taskId };
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { projectId, milestoneId, taskId } = pendingUpload.current;
    setUploadingFor(taskId || milestoneId || projectId);
    try {
      const saved = await uploadProjectFile(projectId, file, milestoneId, taskId);
      if (activeProject?.id === projectId) {
        setProjectFiles(prev => [saved, ...prev]);
      }
      setCardFiles(prev => ({ ...prev, [projectId]: [saved, ...(prev[projectId] || [])] }));
    } catch (err) {
      console.error('Upload failed:', err.message);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingFor(null);
    }
  };

  const handleDeleteFile = async (file) => {
    await deleteProjectFile(file.id, file.storage_path);
    setProjectFiles(prev => prev.filter(f => f.id !== file.id));
    setCardFiles(prev => ({
      ...prev,
      [file.project_id]: (prev[file.project_id] || []).filter(f => f.id !== file.id),
    }));
  };

  const openLinkModal = (projectId, milestoneId = null, taskId = null) => {
    setShowLinkModal({ projectId, milestoneId, taskId });
    setLinkUrl('');
    setLinkName('');
  };

  const handleAddLink = async () => {
    if (!linkUrl.trim()) return;
    const { projectId, milestoneId, taskId } = showLinkModal;
    const name = linkName.trim() || parseLinkName(linkUrl.trim());
    const saved = await addExternalLink(projectId, linkUrl.trim(), name, milestoneId, taskId);
    setProjectFiles(prev => [saved, ...prev]);
    setCardFiles(prev => ({ ...prev, [projectId]: [saved, ...(prev[projectId] || [])] }));
    setShowLinkModal(null);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeCount    = projects.filter(p => p.status === 'active').length;
  const completedCount = projects.filter(p => p.status === 'completed').length;
  const totalTasks     = Object.values(allTasks).flat();
  const doneTasks      = totalTasks.filter(t => t.completed).length;

  // ═════════════════════════════════════════════════════════════════════════
  // ── ASSIGNED VIEW ────────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════
  if (view === 'assigned') {
    const today = new Date().toISOString().slice(0, 10);
    const completedCount2 = assignedTasks.filter(t => t.completed).length;
    const overdueCount    = assignedTasks.filter(t => !t.completed && t.due_date && t.due_date < today).length;

    return (
      <>
        <div className="page-header">
          <div className="page-header-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => setView('list')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0', fontWeight: 600 }}
              >← Projects</button>
              <h2 style={{ margin: 0 }}>👤 Team Tasks</h2>
              <select
                value={assignedOwner}
                onChange={e => { setAssignedOwner(e.target.value); loadAssigned(e.target.value); }}
                style={{ fontSize: 14, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
              >
                {owners.map(o => <option key={o} value={o}>{o}</option>)}
                <option value="__unassigned__">Unassigned</option>
              </select>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              {assignedTasks.length} tasks · {completedCount2} completed{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
            </p>
          </div>
          <div className="page-header-actions">
            <button
              onClick={() => loadAssigned(assignedOwner)}
              disabled={loadingAssigned}
              style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}
            >{loadingAssigned ? '⏳' : '↺ Refresh'}</button>
          </div>
        </div>

        <div className="page-body">
          {loadingAssigned ? (
            <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading tasks…</p></div>
          ) : assignedTasks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✅</div>
              <h3>No tasks {assignedOwner === '__unassigned__' ? 'without an owner' : `assigned to ${assignedOwner}`}</h3>
              <p>{assignedOwner === '__unassigned__' ? 'Unassigned tasks will appear here sorted by due date.' : `Tasks assigned to ${assignedOwner} will appear here sorted by due date.`}</p>
            </div>
          ) : (() => {
            const activeTasks    = assignedTasks.filter(t => !t.completed);
            const completedTasks = assignedTasks.filter(t => t.completed);
            const allSorted      = [...activeTasks, ...completedTasks];
            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {allSorted.map((task, idx) => {
                const isEditingThis  = editingTask === task.id;
                const pendingDelete  = confirmDeleteTask === task.id;
                const taskFiles      = assignedFiles[task.id] || [];
                const isOverdue      = !task.completed && task.due_date && task.due_date < today;
                const msColor2       = task._milestone ? msColor(task._milestone.status) : 'var(--border)';
                const isFirstDone    = task.completed && (idx === 0 || !allSorted[idx - 1].completed);

                return (
                  <div key={task.id}>
                  {isFirstDone && activeTasks.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>Completed · {completedTasks.length}</span>
                    </div>
                  )}
                  <div
                    style={{
                      borderBottom: idx < allSorted.length - 1 && !(allSorted[idx + 1]?.completed && !task.completed) ? '1px solid var(--border-light)' : 'none',
                      background: task.completed ? 'var(--surface)' : 'var(--bg)',
                    }}
                  >
                    {isEditingThis ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 16px', alignItems: 'center', background: 'var(--bg)', borderLeft: '3px solid var(--accent)' }}>
                        <input
                          type="text"
                          autoFocus
                          value={editTaskDraft.title}
                          onChange={e => setEditTaskDraft(d => ({ ...d, title: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { handleSaveAssignedTaskEdit(task); setEditingTask(null); } if (e.key === 'Escape') setEditingTask(null); }}
                          onBlur={() => { handleSaveAssignedTaskEdit(task); setEditingTask(null); }}
                          style={{ flex: '1 1 180px', fontSize: 13, padding: '5px 10px', fontWeight: 600 }}
                          placeholder="Task title"
                        />
                        <div>
                          <Lbl>Due date</Lbl>
                          <input type="date" value={editTaskDraft.due_date} onChange={e => {
                            const val = e.target.value;
                            setEditTaskDraft(d => ({ ...d, due_date: val }));
                            handleSaveAssignedTaskEdit(task, { due_date: val });
                            setEditingTask(null);
                          }} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
                        </div>
                        <div>
                          <Lbl>Assigned to</Lbl>
                          <select value={editTaskDraft.assigned_to} onChange={e => {
                            const val = e.target.value;
                            setEditTaskDraft(d => ({ ...d, assigned_to: val }));
                            handleSaveAssignedTaskEdit(task, { assigned_to: val });
                            setEditingTask(null);
                          }} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}>
                            <option value="">—</option>
                            {owners.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
                        <input
                          type="checkbox"
                          checked={task.completed}
                          onChange={() => handleToggleAssignedTask(task)}
                          style={{ width: 15, height: 15, accentColor: msColor2, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                            <span
                              style={{ fontSize: 13, fontWeight: 600, color: task.completed ? 'var(--text-faint)' : 'var(--text)', textDecoration: task.completed ? 'line-through' : 'none', textDecorationColor: '#ef4444', cursor: 'text' }}
                              onDoubleClick={() => startEditTask(task)}
                              title="Double-click to edit"
                            >{task.title}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                              onClick={() => { openProject(task._project); }}
                            >{task._project?.name}</span>
                            {task._milestone && (
                              <>
                                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>›</span>
                                <span style={{ fontSize: 11, color: msColor2, fontWeight: 600 }}>{task._milestone.title}</span>
                              </>
                            )}
                            {task._inherited && (
                              <span style={{ fontSize: 10, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px dashed var(--border)', padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                                via milestone
                              </span>
                            )}
                          </div>
                        </div>
                        {task.due_date && (
                          <span style={{ fontSize: 11, color: isOverdue ? '#ef4444' : 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: isOverdue ? 700 : 400 }}>
                            {isOverdue ? '⚠ ' : ''}{fmtDate(task.due_date)}
                          </span>
                        )}
                        <button onClick={() => startEditTask(task)} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}>✏️</button>
                        <button
                          onClick={e => { e.stopPropagation(); triggerFileUpload(task.project_id, null, null, task.id); }}
                          disabled={uploadingFor === task.id}
                          title="Attach file"
                          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                        >{uploadingFor === task.id ? '⏳' : '📎'}</button>
                        <button
                          onClick={e => { e.stopPropagation(); openLinkModal(task.project_id, null, task.id); }}
                          title="Add link"
                          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                        >🔗</button>
                        <button
                          onClick={() => {
                            if (pendingDelete) { handleDeleteAssignedTask(task.id); setConfirmDeleteTask(null); }
                            else setConfirmDeleteTask(task.id);
                          }}
                          style={{
                            background: pendingDelete ? '#fef2f2' : 'none',
                            border: pendingDelete ? '1px solid #fecaca' : 'none',
                            color: pendingDelete ? '#ef4444' : 'var(--text-faint)',
                            cursor: 'pointer', fontSize: pendingDelete ? 11 : 13,
                            padding: pendingDelete ? '2px 7px' : '2px 4px',
                            borderRadius: 4, fontWeight: pendingDelete ? 700 : 400,
                            flexShrink: 0, whiteSpace: 'nowrap', transition: 'all .15s',
                          }}
                        >{pendingDelete ? 'Delete?' : '✕'}</button>
                      </div>
                    )}
                    {taskFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 16px 8px 41px' }}>
                        {taskFiles.map(f => (
                          <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border-light)', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                            <span>{fileIcon(f.mime_type)}</span>
                            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); handleDeleteFile(f); }} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '0 0 0 2px', fontSize: 11 }}>✕</button>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>
                );
              })}
            </div>
            );
          })()}
        </div>

        {/* Shared modals (link modal + file input are rendered at component root) */}
        <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }} onChange={handleFileSelected} />
        {showLinkModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setShowLinkModal(null)} />
            <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 12, padding: 24, width: 420, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Add Link</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><Lbl>URL</Lbl><input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" autoFocus /></div>
                <div><Lbl>Display name (optional)</Lbl><input type="text" value={linkName} onChange={e => setLinkName(e.target.value)} placeholder="Auto-detected from URL" /></div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowLinkModal(null)} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleAddLink} disabled={!linkUrl.trim()}>Add Link</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ── LIST VIEW ────────────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════
  if (view === 'list') return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>🗂️ Projects</h2>
          <p>{activeCount} active · {projects.length} total</p>
        </div>
        <div className="page-header-actions">
          <button
            onClick={() => { setView('assigned'); loadAssigned(assignedOwner); }}
            style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}
          >👤 Team Tasks</button>
          <button className="btn btn-primary" onClick={() => setShowNewProject(true)}>+ New Project</button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-row cols-3" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-val" style={{ color: '#10b981' }}>{activeCount}</div>
            <div className="stat-label">Active Projects</div>
            <div className="stat-sub">{projects.length} total</div>
          </div>
          <div className="stat-card">
            <div className="stat-val">{totalTasks.length}</div>
            <div className="stat-label">Total Tasks</div>
            <div className="stat-sub">{doneTasks} completed</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: '#6b7280' }}>{completedCount}</div>
            <div className="stat-label">Completed</div>
            <div className="stat-sub">Projects delivered</div>
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading projects…</p></div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗂️</div>
            <h3>No projects yet</h3>
            <p>Create a project and import a proposal to generate your first timeline.</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowNewProject(true)}>+ New Project</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {projects.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  tasks={allTasks[p.id] || []}
                  files={cardFiles[p.id] || []}
                  onClick={() => openProject(p)}
                  onUpload={triggerFileUpload}
                  onImport={id => setShowImporterForProject(id)}
                  uploading={uploadingFor === p.id}
                />
              ))}
            </div>

            {/* Archived projects */}
            <div style={{ marginTop: 32, borderTop: '1px solid var(--border-light)', paddingTop: 20 }}>
              <button
                onClick={() => {
                  const next = !showArchived;
                  setShowArchived(next);
                  if (next && archivedProjects.length === 0) handleLoadArchived();
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', padding: 0 }}
              >
                <span>📦 Archived projects</span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{showArchived ? '▲' : '▼'}</span>
              </button>

              {showArchived && (
                <div style={{ marginTop: 14 }}>
                  {loadingArchived ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-faint)', fontSize: 13 }}>
                      <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading…
                    </div>
                  ) : archivedProjects.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No archived projects.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {archivedProjects.map(p => (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '12px 16px', borderRadius: 8,
                          border: '1px solid var(--border)', background: 'var(--surface)',
                          opacity: 0.75,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                            {p.client_name && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.client_name}</div>}
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                              Archived {new Date(p.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRestoreProject(p)}
                            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#10b981', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            ↩ Restore
                          </button>
                          {confirmHardDelete?.item?.id === p.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <span style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>Delete?</span>
                              <button onClick={() => handleHardDeleteProject(p)} style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid #ef4444', background: '#ef444418', cursor: 'pointer', color: '#ef4444' }}>Yes</button>
                              <button onClick={() => setConfirmHardDelete(null)} style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)' }}>No</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmHardDelete({ type: 'project', item: p })}
                              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 14, color: '#ef4444', flexShrink: 0 }}
                              title="Permanently delete"
                            >🗑</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Global file input */}
      <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }} onChange={handleFileSelected} />

      {/* Proposal importer from card */}
      {showImporterForProject && (
        <ProposalImporter
          projectId={showImporterForProject}
          projectStart={projects.find(p => p.id === showImporterForProject)?.start_date}
          onImported={(payload) => handleImported(payload, showImporterForProject)}
          onClose={() => setShowImporterForProject(null)}
        />
      )}

      {/* New project modal */}
      {showNewProject && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setShowNewProject(false)} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 12, padding: 28, width: 480, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 20 }}>New Project</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Lbl>Project Name</Lbl>
                <input type="text" value={newProj.name} onChange={e => setNewProj(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Rebrand & Website Redesign" autoFocus />
              </div>
              {wonDeals.length > 0 && (
                <div>
                  <Lbl>Client (from won deals)</Lbl>
                  <select
                    defaultValue=""
                    onChange={e => {
                      const d = wonDeals.find(x => x.id === e.target.value);
                      if (d) setNewProj(p => ({ ...p, client_name: d.company_name || '', contact_name: d.contact_name || '' }));
                    }}
                  >
                    <option value="">Select client…</option>
                    {wonDeals.map(d => <option key={d.id} value={d.id}>{d.company_name}{d.contact_name ? ` — ${d.contact_name}` : ''}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <Lbl>Client name</Lbl>
                  <input type="text" value={newProj.client_name} onChange={e => setNewProj(p => ({ ...p, client_name: e.target.value }))} placeholder="Company" />
                </div>
                <div>
                  <Lbl>Start date</Lbl>
                  <input type="date" value={newProj.start_date} onChange={e => setNewProj(p => ({ ...p, start_date: e.target.value }))} />
                </div>
              </div>
              {projError && (
                <p style={{ fontSize: 12, color: '#ef4444', margin: 0, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>
                  ⚠️ {projError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => { setShowNewProject(false); setProjError(''); }} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateProject} disabled={savingProj || !newProj.name.trim()}>
                  {savingProj ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ═════════════════════════════════════════════════════════════════════════
  // ── DETAIL VIEW ──────────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════
  const pct        = projectProgress(tasks);
  const pColor     = projColor(activeProject.status);
  // Pre-group tasks by milestone once — O(T) — instead of O(M×T) per render
  const tasksByMs  = tasks.reduce((acc, t) => {
    if (!acc[t.milestone_id]) acc[t.milestone_id] = [];
    acc[t.milestone_id].push(t);
    return acc;
  }, {});
  const msForTasks = id => tasksByMs[id] || [];

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2 style={{ marginBottom: 2 }}>
            <input
              type="text"
              value={activeProject.name}
              onChange={e => setActiveProject(p => ({ ...p, name: e.target.value }))}
              onBlur={handleSaveProject}
              style={{ fontSize: 22, fontWeight: 800, border: 'none', outline: 'none', background: 'transparent', padding: 0, width: '100%' }}
            />
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {activeProject.client_name && <span>{activeProject.client_name} · </span>}
            {activeProject.start_date && <span>{fmtDate(activeProject.start_date)}</span>}
            {activeProject.end_date   && <span> → {fmtDate(activeProject.end_date)}</span>}
          </p>
        </div>
        <div className="page-header-actions" style={{ gap: 8 }}>
          <button className="btn" style={{ fontSize: 13 }} onClick={() => triggerFileUpload(activeProject.id)}>📎 Upload File</button>
          <button className="btn" style={{ fontSize: 13 }} onClick={() => openLinkModal(activeProject.id)}>🔗 Add Link</button>
          <button className="btn" style={{ fontSize: 13 }} onClick={() => setShowImporter(true)}>📋 Import Proposal</button>
          <button className="btn btn-primary" onClick={handleAddMilestone}>+ Milestone</button>
        </div>
      </div>

      <div className="page-body">

        {/* Project meta bar */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Progress</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: pColor }}>{pct}%</span>
            </div>
            <ProgressBar pct={pct} color={pColor} height={8} />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              {tasks.filter(t => t.completed).length} / {tasks.length} tasks complete
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <Lbl>Status</Lbl>
              <select
                value={activeProject.status}
                onChange={e => { const u = { ...activeProject, status: e.target.value }; setActiveProject(u); upsertProject(u); }}
                style={{ fontSize: 12, padding: '4px 8px', width: 'auto', color: pColor, fontWeight: 700 }}
              >
                {PROJECT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <Lbl>Start</Lbl>
              <input type="date" value={activeProject.start_date || ''} onChange={e => setActiveProject(p => ({ ...p, start_date: e.target.value }))} onBlur={handleSaveProject} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
            </div>
            <div>
              <Lbl>End</Lbl>
              <input type="date" value={activeProject.end_date || ''} onChange={e => setActiveProject(p => ({ ...p, end_date: e.target.value }))} onBlur={handleSaveProject} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
            </div>
            <div>
              <Lbl>Client</Lbl>
              <input type="text" value={activeProject.client_name || ''} onChange={e => setActiveProject(p => ({ ...p, client_name: e.target.value }))} onBlur={handleSaveProject} placeholder="Client name" style={{ fontSize: 12, padding: '4px 8px', width: 140 }} />
            </div>
            <div>
              <Lbl>View by</Lbl>
              <select
                value={projectOwnerFilter}
                onChange={e => setProjectOwnerFilter(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', width: 'auto', fontWeight: projectOwnerFilter ? 700 : 400, color: projectOwnerFilter ? 'var(--accent)' : 'var(--text)' }}
              >
                <option value="">All Team</option>
                {owners.map(o => <option key={o} value={o}>{o}</option>)}
                <option value="__unassigned__">Unassigned</option>
              </select>
            </div>

            <button
              onClick={handleArchiveProject}
              style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: `1px solid ${confirmDeleteProj ? '#ef4444' : 'var(--border)'}`, background: confirmDeleteProj ? '#fef2f2' : 'transparent', color: confirmDeleteProj ? '#ef4444' : 'var(--text-muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer', transition: 'all .15s' }}
            >
              {confirmDeleteProj ? '⚠️ Confirm archive' : '📦 Archive project'}
            </button>
          </div>
        </div>

        {loadingDetail ? (
          <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading timeline…</p></div>
        ) : milestones.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <h3>No milestones yet</h3>
            <p>Import a proposal to auto-generate a timeline, or add milestones manually.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button className="btn" onClick={() => setShowImporter(true)}>📋 Import Proposal</button>
              <button className="btn btn-primary" onClick={handleAddMilestone}>+ Add Milestone</button>
            </div>
          </div>
        ) : (<>

          {/* ── Gantt ─────────────────────────────────────────────────── */}
          {activeProject.start_date && activeProject.end_date && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 14 }}>Timeline</div>
              <GanttChart
                milestones={milestones}
                projectStart={activeProject.start_date}
                projectEnd={activeProject.end_date}
                onMilestoneClick={id => {
                  // Expand the milestone and scroll to it
                  setExpanded(prev => ({ ...prev, [id]: true }));
                  setTimeout(() => {
                    document.getElementById(`ms-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 50);
                }}
              />
            </div>
          )}

          {/* ── Project Files ─────────────────────────────────────── */}
          {(() => {
            const generalFiles = projectFiles.filter(f => !f.milestone_id && !f.task_id);
            if (!generalFiles.length) return null;
            return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Project Documents</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {generalFiles.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                    <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>
                    <button onClick={() => handleDeleteFile(f)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }} title="Remove file">✕</button>
                  </div>
                ))}
              </div>
            </div>
            );
          })()}

          {/* ── Milestones & Tasks ─────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {milestones.map((ms) => {
              const msTasks   = msForTasks(ms.id);
              const msPct     = projectProgress(msTasks);
              const isOpen    = expanded[ms.id];
              const isEditing = editingMs === ms.id;
              const color     = msColor(ms.status);

              return (
                <div key={ms.id} id={`ms-${ms.id}`} style={{ border: `1px solid var(--border)`, borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>

                  {/* Milestone header */}
                  <div
                    style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 0, alignItems: 'stretch', cursor: 'pointer', borderBottom: isOpen ? '1px solid var(--border-light)' : 'none' }}
                    onClick={() => setExpanded(e => ({ ...e, [ms.id]: !e[ms.id] }))}
                  >
                    {/* Color strip */}
                    <div style={{ background: color, opacity: 0.8 }} />

                    {/* Content */}
                    <div style={{ padding: '12px 16px', minWidth: 0 }}>
                      {isEditing ? (
                        <input
                          type="text"
                          value={ms.title}
                          autoFocus
                          onClick={e => e.stopPropagation()}
                          onChange={e => setMilestones(prev => prev.map(m => m.id === ms.id ? { ...m, title: e.target.value } : m))}
                          onBlur={() => handleSaveMilestone(ms)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveMilestone(ms); if (e.key === 'Escape') setEditingMs(null); }}
                          style={{ fontSize: 14, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', width: '100%', padding: 0 }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{ms.title}</span>
                          <Badge label={msLabel(ms.status)} color={color} small />
                          {ms.assigned_to && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>· {ms.assigned_to}</span>}
                          {ms.due_date && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>{fmtDate(ms.start_date)} – {fmtDate(ms.due_date)}</span>}
                        </div>
                      )}
                      {!isEditing && msTasks.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ProgressBar pct={msPct} color={color} height={4} />
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{msTasks.filter(t => t.completed).length}/{msTasks.length}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setEditingMs(isEditing ? null : ms.id)}
                        style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4 }}
                        title="Edit milestone"
                      >✏️</button>
                      <button
                        onClick={() => handleArchiveMilestone(ms)}
                        style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4 }}
                        title="Archive milestone"
                      >🗑</button>
                      <span style={{ fontSize: 14, color: 'var(--text-faint)', userSelect: 'none' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Expanded: inline edit fields + tasks */}
                  {isOpen && (
                    <div>
                      {/* Row 1 – Description */}
                      {ms.description && (
                        <div style={{ padding: '10px 16px 10px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                          <Lbl>Description</Lbl>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{ms.description}</div>
                        </div>
                      )}

                      {/* Row 2 – Assigned to · Start · Due */}
                      <div style={{ display: 'flex', gap: 16, padding: '10px 16px 10px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <Lbl>Assigned to</Lbl>
                          <select value={ms.assigned_to || ''} onChange={e => { const u = { ...ms, assigned_to: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }}>
                            <option value="">Unassigned</option>
                            {owners.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <Lbl>Start</Lbl>
                          <input type="date" value={ms.start_date || ''} onChange={e => { const u = { ...ms, start_date: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }} />
                        </div>
                        <div>
                          <Lbl>Due</Lbl>
                          <input type="date" value={ms.due_date || ''} onChange={e => { const u = { ...ms, due_date: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }} />
                        </div>
                      </div>

                      {/* Row 3 – Status buttons */}
                      <div style={{ display: 'flex', gap: 6, padding: '8px 16px 8px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Lbl>Status</Lbl>
                        {MILESTONE_STATUSES.map(s => {
                          const active = ms.status === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => { const u = { ...ms, status: s.id }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }}
                              style={{
                                fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                                border: `1.5px solid ${s.color}`,
                                background: active ? s.color : 'transparent',
                                color: active ? '#fff' : s.color,
                                transition: 'all .15s',
                              }}
                            >{s.label}</button>
                          );
                        })}
                      </div>

                      {/* Milestone Files */}
                      {projectFiles.filter(f => f.milestone_id === ms.id && !f.task_id).map(f => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px 7px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                          <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>
                          <button onClick={() => handleDeleteFile(f)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}

                      {/* Tasks */}
                      {msTasks.filter(task => {
                        if (!projectOwnerFilter) return true;
                        // Effective owner: task's own assigned_to, falling back to the milestone owner
                        const effective = task.assigned_to || ms.assigned_to || '';
                        if (projectOwnerFilter === '__unassigned__') return !effective;
                        return effective === projectOwnerFilter;
                      }).map(task => {
                        const taskFiles     = projectFiles.filter(f => f.task_id === task.id);
                        const pendingDelete = confirmDeleteTask === task.id;
                        const isEditingThis = editingTask === task.id;

                        return (
                          <div key={task.id} style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--surface)' }}>

                            {isEditingThis ? (
                              /* ── Edit mode ───────────────────────────────── */
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 16px 10px 48px', alignItems: 'center', background: 'var(--bg)', borderLeft: '3px solid var(--accent)' }}>
                                <input
                                  type="text"
                                  autoFocus
                                  value={editTaskDraft.title}
                                  onChange={e => setEditTaskDraft(d => ({ ...d, title: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') { handleSaveTaskEdit(task); setEditingTask(null); } if (e.key === 'Escape') setEditingTask(null); }}
                                  onBlur={() => { handleSaveTaskEdit(task); setEditingTask(null); }}
                                  style={{ flex: '1 1 180px', fontSize: 13, padding: '5px 10px', fontWeight: 600 }}
                                  placeholder="Task title"
                                />
                                <div>
                                  <Lbl>Due date</Lbl>
                                  <input
                                    type="date"
                                    value={editTaskDraft.due_date}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setEditTaskDraft(d => ({ ...d, due_date: val }));
                                      handleSaveTaskEdit(task, { due_date: val });
                                      setEditingTask(null);
                                    }}
                                    style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                                  />
                                </div>
                                <div>
                                  <Lbl>Assigned to</Lbl>
                                  <select
                                    value={editTaskDraft.assigned_to}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setEditTaskDraft(d => ({ ...d, assigned_to: val }));
                                      handleSaveTaskEdit(task, { assigned_to: val });
                                      setEditingTask(null);
                                    }}
                                    style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                                  >
                                    <option value="">—</option>
                                    {owners.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <Lbl>Est. hrs</Lbl>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={editTaskDraft.estimated_hours}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setEditTaskDraft(d => ({ ...d, estimated_hours: val }));
                                    }}
                                    onBlur={e => {
                                      const val = e.target.value;
                                      handleSaveTaskEdit(task, { estimated_hours: val });
                                      setEditingTask(null);
                                    }}
                                    placeholder="—"
                                    style={{ fontSize: 12, padding: '4px 8px', width: 70 }}
                                  />
                                </div>
                              </div>
                            ) : (
                              /* ── Normal view mode ────────────────────────── */
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 48px' }}>
                                <input
                                  type="checkbox"
                                  checked={task.completed}
                                  onChange={() => handleToggleTask(task)}
                                  style={{ width: 15, height: 15, accentColor: color, cursor: 'pointer', flexShrink: 0 }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span
                                    style={{
                                      fontSize: 13,
                                      color: 'var(--text)',
                                      textDecoration: task.completed ? 'line-through' : 'none',
                                      textDecorationColor: '#ef4444',
                                      cursor: 'text',
                                    }}
                                    onDoubleClick={() => startEditTask(task)}
                                    title="Double-click to edit"
                                  >
                                    {task.title}
                                  </span>
                                  {task.completed && task.completed_at && (
                                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                                      ✓ Completed {fmtDate(task.completed_at)}
                                    </div>
                                  )}
                                </div>
                                {task.assigned_to && (
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>{task.assigned_to}</span>
                                )}
                                {task.estimated_hours != null && task.estimated_hours !== '' && (
                                  <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
                                    {task.estimated_hours}h
                                  </span>
                                )}
                                {task.due_date && (
                                  <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtDate(task.due_date)}</span>
                                )}
                                {/* Edit task */}
                                <button
                                  onClick={() => startEditTask(task)}
                                  title="Edit task"
                                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                                >✏️</button>
                                {/* See in proposal */}
                                {(activeProject.proposal_text || activeProject.proposal_pdf_url) && (
                                  <button
                                    onClick={() => setProposalPanel({ task })}
                                    title="See in proposal"
                                    style={{
                                      background: 'none', border: '1px solid var(--border)',
                                      color: 'var(--text-faint)', cursor: 'pointer',
                                      fontSize: 10, fontWeight: 700, padding: '2px 7px',
                                      borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap',
                                      letterSpacing: '.02em',
                                    }}
                                  >📄 proposal</button>
                                )}
                                {/* Attach file to task */}
                                <button
                                  onClick={e => { e.stopPropagation(); triggerFileUpload(activeProject.id, null, null, task.id); }}
                                  disabled={uploadingFor === task.id}
                                  title="Attach file"
                                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                                >
                                  {uploadingFor === task.id ? '⏳' : '📎'}
                                </button>
                                {/* Add link to task */}
                                <button
                                  onClick={e => { e.stopPropagation(); openLinkModal(activeProject.id, null, task.id); }}
                                  title="Add link"
                                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                                >🔗</button>
                                {/* Delete with confirmation */}
                                <button
                                  onClick={() => {
                                    if (pendingDelete) {
                                      handleDeleteTask(task.id);
                                      setConfirmDeleteTask(null);
                                    } else {
                                      setConfirmDeleteTask(task.id);
                                    }
                                  }}
                                  style={{
                                    background: pendingDelete ? '#fef2f2' : 'none',
                                    border: pendingDelete ? '1px solid #fecaca' : 'none',
                                    color: pendingDelete ? '#ef4444' : 'var(--text-faint)',
                                    cursor: 'pointer', fontSize: pendingDelete ? 11 : 13,
                                    padding: pendingDelete ? '2px 7px' : '2px 4px',
                                    borderRadius: 4, fontWeight: pendingDelete ? 700 : 400,
                                    flexShrink: 0, whiteSpace: 'nowrap',
                                    transition: 'all .15s',
                                  }}
                                >
                                  {pendingDelete ? 'Delete?' : '✕'}
                                </button>
                              </div>
                            )}

                            {/* Task-level attached files */}
                            {taskFiles.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 16px 8px 64px' }}>
                                {taskFiles.map(f => (
                                  <a
                                    key={f.id}
                                    href={f.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border-light)', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
                                  >
                                    <span>{fileIcon(f.mime_type)}</span>
                                    <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    <button
                                      onClick={e => { e.preventDefault(); e.stopPropagation(); handleDeleteFile(f); }}
                                      style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '0 0 0 2px', fontSize: 11, lineHeight: 1 }}
                                    >✕</button>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Add task row */}
                      {newTaskMs === ms.id ? (
                        <div style={{ display: 'flex', gap: 8, padding: '8px 16px 8px 48px', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={newTaskTitle}
                            onChange={e => setNewTaskTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddTask(ms.id); if (e.key === 'Escape') { setNewTaskMs(null); setNewTaskTitle(''); } }}
                            placeholder="Task name… (Enter to add)"
                            autoFocus
                            style={{ flex: 1, fontSize: 13, padding: '5px 10px' }}
                          />
                          <button className="btn btn-primary" onClick={() => handleAddTask(ms.id)} style={{ fontSize: 12 }}>Add</button>
                          <button onClick={() => { setNewTaskMs(null); setNewTaskTitle(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}>✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setNewTaskMs(ms.id); setNewTaskTitle(''); setEditingTask(null); setConfirmDeleteTask(null); }}
                          style={{ width: '100%', padding: '8px 16px 8px 48px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left' }}
                        >
                          + Add task
                        </button>
                      )}

                      {/* Attach file to milestone */}
                      <button
                        onClick={() => triggerFileUpload(activeProject.id, ms.id)}
                        disabled={uploadingFor === ms.id}
                        style={{ width: '100%', padding: '7px 16px 7px 48px', background: 'none', border: 'none', borderTop: '1px solid var(--border-light)', cursor: uploadingFor === ms.id ? 'default' : 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left', transition: 'color .15s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                      >
                        {uploadingFor === ms.id ? '⏳ Uploading…' : '📎 Attach file to milestone'}
                      </button>
                      <button
                        onClick={() => openLinkModal(activeProject.id, ms.id)}
                        style={{ width: '100%', padding: '7px 16px 7px 48px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left', transition: 'color .15s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                      >
                        🔗 Add link to milestone
                      </button>

                      {/* Archived tasks toggle */}
                      {(deletedTasks[ms.id] || []).length > 0 && (
                        <div>
                          <button
                            onClick={() => setShowArchivedMs(p => ({ ...p, [ms.id]: !p[ms.id] }))}
                            style={{ width: '100%', padding: '7px 16px 7px 48px', background: 'none', border: 'none', borderTop: '1px solid var(--border-light)', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <span>📦</span>
                            <span>{(deletedTasks[ms.id] || []).length} archived task{(deletedTasks[ms.id] || []).length !== 1 ? 's' : ''}</span>
                            <span style={{ marginLeft: 'auto' }}>{showArchivedMs[ms.id] ? '▲' : '▼'}</span>
                          </button>
                          {showArchivedMs[ms.id] && (
                            <div style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-light)' }}>
                              {(deletedTasks[ms.id] || []).map(task => (
                                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 8px 48px', borderBottom: '1px solid var(--border-light)' }}>
                                  <span style={{ fontSize: 13, color: 'var(--text-faint)', flex: 1, textDecoration: 'line-through', textDecorationColor: 'var(--text-faint)' }}>
                                    {task.title}
                                  </span>
                                  <button
                                    onClick={() => handleRestoreTask(task)}
                                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: '#10b981', whiteSpace: 'nowrap' }}
                                  >
                                    ↩ Restore
                                  </button>
                                  {confirmHardDelete?.item?.id === task.id ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>Delete?</span>
                                      <button onClick={() => handleHardDeleteTask(task)} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid #ef4444', background: '#ef444418', cursor: 'pointer', color: '#ef4444' }}>Yes</button>
                                      <button onClick={() => setConfirmHardDelete(null)} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)' }}>No</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmHardDelete({ type: 'task', item: task })}
                                      style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: '#ef4444' }}
                                      title="Permanently delete"
                                    >🗑</button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Archived milestones */}
            {(archivedMilestones.length > 0 || showArchivedMilestones) && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
                <button
                  onClick={async () => {
                    const next = !showArchivedMilestones;
                    setShowArchivedMilestones(next);
                    if (next && archivedMilestones.length === 0) {
                      const data = await fetchArchivedMilestones(activeProject.id);
                      setArchivedMilestones(data);
                    }
                  }}
                  style={{ width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left' }}
                >
                  <span>📦 Archived milestones</span>
                  {archivedMilestones.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>{archivedMilestones.length} milestone{archivedMilestones.length !== 1 ? 's' : ''}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>{showArchivedMilestones ? '▲' : '▼'}</span>
                </button>
                {showArchivedMilestones && (
                  <div style={{ borderTop: '1px solid var(--border-light)' }}>
                    {archivedMilestones.length === 0 ? (
                      <p style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>No archived milestones.</p>
                    ) : archivedMilestones.map(ms => (
                      <div key={ms.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border-light)', opacity: 0.7 }}>
                        <div style={{ width: 6, height: 32, borderRadius: 3, background: msColor(ms.status), flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, textDecoration: 'line-through', color: 'var(--text-muted)' }}>{ms.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                            Archived {new Date(ms.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            {ms.due_date ? ` · Due ${fmtDate(ms.due_date)}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRestoreMilestone(ms)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#10b981', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >↩ Restore</button>
                        {confirmHardDelete?.item?.id === ms.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <span style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>Delete?</span>
                            <button onClick={() => handleHardDeleteMilestone(ms)} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid #ef4444', background: '#ef444418', cursor: 'pointer', color: '#ef4444' }}>Yes</button>
                            <button onClick={() => setConfirmHardDelete(null)} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)' }}>No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmHardDelete({ type: 'milestone', item: ms })}
                            style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 13, color: '#ef4444', flexShrink: 0 }}
                            title="Permanently delete"
                          >🗑</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Project Estimate ──────────────────────────────────────── */}
            {tasks.length > 0 && (
              <ProjectForecast
                tasks={tasks}
                teamMembers={teamMembers}
                open={showEstimate}
                onToggle={() => setShowEstimate(o => !o)}
              />
            )}

            {/* Add milestone footer */}
            <button
              onClick={handleAddMilestone}
              style={{ padding: '12px', border: '2px dashed var(--border)', borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-faint)', transition: 'border-color .15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              + Add Milestone
            </button>
          </div>
        </>)}
      </div>

      {/* Global file input */}
      <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }} onChange={handleFileSelected} />

      {/* Proposal side drawer */}
      {proposalPanel && (() => {
        const proposalText   = activeProject.proposal_text       || '';
        const proposalPdfUrl = activeProject.proposal_pdf_url    || '';
        const hints          = activeProject.proposal_page_hints;
        const isPdf          = !!proposalPdfUrl;
        const paras          = proposalText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        const highlightIdx   = findRelevantParaIndex(proposalText, proposalPanel.task.title);

        // Resolve page number:
        // • New format: hints is an object { "Task title": pageNum } — direct lookup
        // • Legacy format: hints is a paraPages array — use highlight index
        const hintsAreIndexed = hints && !Array.isArray(hints) && typeof hints === 'object';
        let pageNum = null;
        if (hintsAreIndexed) {
          pageNum = hints[proposalPanel.task.title]
            ?? findPageHint(hints, proposalPanel.task.title)
            ?? null;
        } else if (Array.isArray(hints) && highlightIdx >= 0) {
          pageNum = hints[highlightIdx] || null;
        }

        const searchParam = pdfSearchParam(proposalPanel.task.title);

        return (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 850, background: 'rgba(0,0,0,0.2)' }}
              onClick={() => setProposalPanel(null)}
            />
            {/* Drawer */}
            <div style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 860,
              width: isPdf ? 600 : 440, maxWidth: '92vw',
              background: 'var(--bg)',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column',
              borderLeft: '1px solid var(--border)',
              transition: 'width .25s',
            }}>
              {/* Header */}
              <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 4 }}>
                      Proposal Reference {isPdf && '· PDF'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>{proposalPanel.task.title}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {isPdf && (
                      <button
                        onClick={handleReindexPages}
                        disabled={reindexing}
                        title="Re-index page positions using AI"
                        style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', padding: '4px 10px', border: '1px solid #8b5cf6', borderRadius: 5, background: 'none', cursor: reindexing ? 'default' : 'pointer', opacity: reindexing ? 0.6 : 1, whiteSpace: 'nowrap' }}
                      >
                        {reindexing ? '⏳ Indexing…' : '✦ Fix pages'}
                      </button>
                    )}
                    {isPdf && (
                      <a
                        href={`${proposalPdfUrl}#page=${pageNum || 1}&search=${searchParam}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: 5 }}
                      >
                        ↗ Open PDF{pageNum ? ` (p.${pageNum})` : ''}
                      </a>
                    )}
                    <button
                      onClick={() => setProposalPanel(null)}
                      style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px', lineHeight: 1 }}
                    >✕</button>
                  </div>
                </div>
                {isPdf && pageNum && (
                  <div style={{ marginTop: 10, padding: '7px 10px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                    📄 Jumping to page {pageNum}
                  </div>
                )}
                {!isPdf && highlightIdx >= 0 && (
                  <div style={{ marginTop: 10, padding: '7px 10px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                    ✨ Most relevant section highlighted below
                  </div>
                )}
              </div>

              {/* Body */}
              {isPdf ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* PDF embed — jumps to page if we have a hint */}
                  <embed
                    key={`${proposalPanel.task.id}-p${pageNum}`}
                    src={`${proposalPdfUrl}#page=${pageNum || 1}&search=${searchParam}&toolbar=1&navpanes=0`}
                    type="application/pdf"
                    style={{ flex: paras.length ? '0 0 55%' : 1, width: '100%', border: 'none' }}
                  />
                  {/* Text excerpt below PDF when extracted text is available */}
                  {paras.length > 0 && highlightIdx >= 0 && (
                    <div style={{ borderTop: '2px solid #fde68a', background: '#fffbeb', flexShrink: 0, maxHeight: '45%', overflowY: 'auto', padding: '10px 16px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#92400e', marginBottom: 8 }}>
                        ✨ Most relevant excerpt
                      </div>
                      {[
                        highlightIdx > 0   && paras[highlightIdx - 1],
                        paras[highlightIdx],
                        highlightIdx < paras.length - 1 && paras[highlightIdx + 1],
                      ].filter(Boolean).map((para, i) => (
                        <p key={i} style={{
                          fontSize: 12, lineHeight: 1.65, marginBottom: 8,
                          padding: i === 1 || (highlightIdx === 0 && i === 0) ? '8px 10px' : '0',
                          borderRadius: 5,
                          background: (i === 1 || (highlightIdx === 0 && i === 0)) ? '#fef9c3' : 'transparent',
                          border: (i === 1 || (highlightIdx === 0 && i === 0)) ? '1px solid #fde68a' : 'none',
                          whiteSpace: 'pre-wrap', color: 'var(--text)',
                        }}>{para}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Scrollable text — keyed on task id so it remounts (and re-scrolls) when task changes */
                <div key={proposalPanel.task.id} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                  {paras.length === 0 ? (
                    <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No proposal text available.</p>
                  ) : (
                    paras.map((para, i) => (
                      <p
                        key={i}
                        ref={i === highlightIdx ? el => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                        style={{
                          fontSize: 13, lineHeight: 1.7, marginBottom: 14,
                          padding: i === highlightIdx ? '10px 12px' : '0',
                          borderRadius: i === highlightIdx ? 6 : 0,
                          background: i === highlightIdx ? '#fef9c3' : 'transparent',
                          border: i === highlightIdx ? '1px solid #fde68a' : 'none',
                          color: 'var(--text)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {para}
                      </p>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* Add link modal */}
      {showLinkModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setShowLinkModal(null)} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 12, padding: 28, width: 460, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.18)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 18 }}>🔗 Add Link</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Lbl>URL</Lbl>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  placeholder="https://www.dropbox.com/…"
                  autoFocus
                  style={{ width: '100%' }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddLink(); if (e.key === 'Escape') setShowLinkModal(null); }}
                />
              </div>
              <div>
                <Lbl>Label (optional)</Lbl>
                <input
                  type="text"
                  value={linkName}
                  onChange={e => setLinkName(e.target.value)}
                  placeholder={linkUrl ? parseLinkName(linkUrl) : 'Auto-detected from URL'}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setShowLinkModal(null)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAddLink} disabled={!linkUrl.trim()}>Add Link</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Proposal importer modal */}
      {showImporter && (
        <ProposalImporter
          projectId={activeProject.id}
          projectStart={activeProject.start_date}
          onImported={handleImported}
          onClose={() => setShowImporter(false)}
        />
      )}
    </>
  );
}

// ── Project Estimate ──────────────────────────────────────────────────────────

function ProjectForecast({ tasks, teamMembers, open, onToggle }) {
  const [activeTab, setActiveTab] = useState('estimate'); // 'estimate' | 'profitability'
  const memberMap = Object.fromEntries((teamMembers || []).map(m => [m.name, m]));

  // Build per-person rollup
  const byPerson = {};
  let unestimated = 0;

  tasks.forEach(task => {
    if (task.deleted_at) return;
    const hrs = task.estimated_hours;
    if (!hrs) { unestimated++; return; }
    const name = task.assigned_to || '(Unassigned)';
    const member = memberMap[name] || {};
    if (!byPerson[name]) byPerson[name] = {
      name,
      tasks:    0,
      hours:    0,
      billRate: parseFloat(member.hourlyRate) || 0,
      costRate: parseFloat(member.costRate)   || 0,
    };
    byPerson[name].tasks++;
    byPerson[name].hours += parseFloat(hrs);
  });

  const rows         = Object.values(byPerson).sort((a, b) => b.hours - a.hours);
  const totalHours   = rows.reduce((s, r) => s + r.hours, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.hours * r.billRate, 0);
  const totalCost    = rows.reduce((s, r) => s + r.hours * r.costRate, 0);
  const totalProfit  = totalRevenue - totalCost;
  const margin       = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : null;

  const hasBillRates = rows.some(r => r.billRate > 0);
  const hasCostRates = rows.some(r => r.costRate > 0);
  const hasProfit    = hasBillRates && hasCostRates;

  const fmt$   = n => n >= 0 ? `$${Math.round(n).toLocaleString('en-US')}` : `-$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  const fmtHrs = n => `${parseFloat(n.toFixed(1))}h`;
  const marginColor = m => m == null ? 'var(--text-faint)' : m >= 50 ? '#10b981' : m >= 25 ? '#f59e0b' : '#ef4444';

  // Collapsed header summary
  const summary = totalHours > 0
    ? [
        `${fmtHrs(totalHours)}`,
        hasBillRates && totalRevenue > 0 ? `${fmt$(totalRevenue)} revenue` : null,
        hasCostRates && totalCost > 0    ? `${fmt$(totalCost)} cost`    : null,
        hasProfit && margin != null      ? `${Math.round(margin)}% margin` : null,
        unestimated > 0                  ? `${unestimated} task${unestimated !== 1 ? 's' : ''} unestimated` : null,
      ].filter(Boolean).join(' · ')
    : 'No hours estimated — edit tasks to add estimates';

  const ColHdr = ({ children, align = 'left' }) => (
    <div style={{ padding: '7px 16px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', textAlign: align }}>
      {children}
    </div>
  );

  const Cell = ({ children, bold, color, align = 'left', muted }) => (
    <div style={{ padding: '10px 16px', fontSize: 13, fontWeight: bold ? 700 : 400, color: color || (muted ? 'var(--text-muted)' : 'var(--text)'), display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      {children}
    </div>
  );

  const Avatar = ({ name, role }) => (
    <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
        {role && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{role}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>

      {/* ── Collapsed header ── */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 16 }}>💰</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Project Forecast</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{summary}</div>
        </div>
        {/* Quick-glance margin pill when collapsed */}
        {!open && hasProfit && margin != null && (
          <div style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: marginColor(margin) + '18', color: marginColor(margin), border: `1px solid ${marginColor(margin)}33` }}>
            {Math.round(margin)}% margin
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>

          {rows.length === 0 ? (
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text-muted)' }}>
              Edit any task and set "Est. hrs" to start building the forecast.
            </div>
          ) : (
            <>
              {/* ── Tab toggle ── */}
              <div style={{ display: 'flex', gap: 4, padding: '12px 18px 0', borderBottom: '1px solid var(--border-light)' }}>
                {[
                  { id: 'estimate',      label: '📋 Estimate' },
                  { id: 'profitability', label: '📊 Profitability', disabled: !hasProfit },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => !tab.disabled && setActiveTab(tab.id)}
                    disabled={tab.disabled}
                    style={{
                      padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: '6px 6px 0 0',
                      border: '1px solid var(--border-light)', borderBottom: activeTab === tab.id ? '1px solid var(--surface)' : '1px solid var(--border-light)',
                      background: activeTab === tab.id ? 'var(--surface)' : 'var(--bg)',
                      color: tab.disabled ? 'var(--text-faint)' : activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: tab.disabled ? 'default' : 'pointer',
                      marginBottom: -1,
                    }}
                    title={tab.disabled ? 'Set billing & cost rates in ICP Settings → Team & Billing Rates to enable' : undefined}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── ESTIMATE TAB ── */}
              {activeTab === 'estimate' && (() => {
                const cols = hasBillRates
                  ? '1fr 60px 70px 80px 90px'
                  : '1fr 60px 70px';
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--border-light)' }}>
                      <ColHdr>Team Member</ColHdr>
                      <ColHdr align="right">Tasks</ColHdr>
                      <ColHdr align="right">Hours</ColHdr>
                      {hasBillRates && <ColHdr align="right">Rate</ColHdr>}
                      {hasBillRates && <ColHdr align="right">Revenue</ColHdr>}
                    </div>
                    {rows.map((r, i) => (
                      <div key={r.name} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: i < rows.length - 1 ? '1px solid var(--border-light)' : 'none', background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)' }}>
                        <Avatar name={r.name} role={memberMap[r.name]?.role} />
                        <Cell muted align="right">{r.tasks}</Cell>
                        <Cell bold align="right">{fmtHrs(r.hours)}</Cell>
                        {hasBillRates && <Cell muted align="right">{r.billRate > 0 ? `$${r.billRate}/hr` : '—'}</Cell>}
                        {hasBillRates && <Cell bold color={r.billRate > 0 ? '#10b981' : 'var(--text-faint)'} align="right">{r.billRate > 0 ? fmt$(r.hours * r.billRate) : '—'}</Cell>}
                      </div>
                    ))}
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                      <Cell bold>Total</Cell>
                      <Cell bold align="right">{rows.reduce((s, r) => s + r.tasks, 0)}</Cell>
                      <Cell bold align="right">{fmtHrs(totalHours)}</Cell>
                      {hasBillRates && <div />}
                      {hasBillRates && <Cell bold color="#10b981" align="right">{fmt$(totalRevenue)}</Cell>}
                    </div>
                  </>
                );
              })()}

              {/* ── PROFITABILITY TAB ── */}
              {activeTab === 'profitability' && hasProfit && (() => {
                const cols = '1fr 70px 80px 80px 80px 80px 80px';
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--border-light)' }}>
                      <ColHdr>Team Member</ColHdr>
                      <ColHdr align="right">Hours</ColHdr>
                      <ColHdr align="right">Bill Rate</ColHdr>
                      <ColHdr align="right">Revenue</ColHdr>
                      <ColHdr align="right">Cost Rate</ColHdr>
                      <ColHdr align="right">Cost</ColHdr>
                      <ColHdr align="right">Profit</ColHdr>
                    </div>
                    {rows.map((r, i) => {
                      const rev    = r.hours * r.billRate;
                      const cost   = r.hours * r.costRate;
                      const profit = rev - cost;
                      const m      = rev > 0 ? (profit / rev) * 100 : null;
                      return (
                        <div key={r.name} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: i < rows.length - 1 ? '1px solid var(--border-light)' : 'none', background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)' }}>
                          <Avatar name={r.name} role={memberMap[r.name]?.role} />
                          <Cell bold align="right">{fmtHrs(r.hours)}</Cell>
                          <Cell muted align="right">{r.billRate > 0 ? `$${r.billRate}` : '—'}</Cell>
                          <Cell align="right" color="#10b981">{r.billRate > 0 ? fmt$(rev) : '—'}</Cell>
                          <Cell muted align="right">{r.costRate > 0 ? `$${r.costRate}` : '—'}</Cell>
                          <Cell align="right" color="#ef4444">{r.costRate > 0 ? fmt$(cost) : '—'}</Cell>
                          <Cell bold align="right" color={profit >= 0 ? '#10b981' : '#ef4444'}>
                            {(r.billRate > 0 || r.costRate > 0) ? fmt$(profit) : '—'}
                            {m != null && <span style={{ fontSize: 10, marginLeft: 4, color: marginColor(m), fontWeight: 600 }}>({Math.round(m)}%)</span>}
                          </Cell>
                        </div>
                      );
                    })}

                    {/* Totals row */}
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                      <Cell bold>Total</Cell>
                      <Cell bold align="right">{fmtHrs(totalHours)}</Cell>
                      <div />
                      <Cell bold color="#10b981" align="right">{fmt$(totalRevenue)}</Cell>
                      <div />
                      <Cell bold color="#ef4444" align="right">{fmt$(totalCost)}</Cell>
                      <Cell bold color={totalProfit >= 0 ? '#10b981' : '#ef4444'} align="right">{fmt$(totalProfit)}</Cell>
                    </div>

                    {/* P&L summary bar */}
                    <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border-light)', background: 'var(--bg)', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                      {[
                        { label: 'Revenue',  value: fmt$(totalRevenue), color: '#10b981' },
                        { label: 'Cost',     value: fmt$(totalCost),    color: '#ef4444' },
                        { label: 'Profit',   value: fmt$(totalProfit),  color: totalProfit >= 0 ? '#10b981' : '#ef4444' },
                        { label: 'Margin',   value: margin != null ? `${Math.round(margin)}%` : '—', color: marginColor(margin) },
                      ].map(stat => (
                        <div key={stat.label}>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 2 }}>{stat.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}

              {/* Unestimated tasks note */}
              {unestimated > 0 && (
                <div style={{ padding: '9px 18px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                  ⚠️ {unestimated} task{unestimated !== 1 ? 's' : ''} {unestimated !== 1 ? 'have' : 'has'} no hours estimate and {unestimated !== 1 ? 'are' : 'is'} excluded from totals.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
