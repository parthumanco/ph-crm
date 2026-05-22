import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchProjects, upsertProject, deleteProject,
  fetchMilestones, upsertMilestone, deleteMilestone,
  fetchProjectTasks, upsertProjectTask, toggleTask, deleteProjectTask,
  fetchProjectFiles, uploadProjectFile, deleteProjectFile,
  bulkInsertMilestones, bulkInsertTasks,
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
  if (mime.includes('pdf'))                                        return '📄';
  if (mime.includes('image'))                                      return '🖼️';
  if (mime.includes('word') || mime.includes('document'))         return '📝';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📊';
  return '📎';
}

function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Gantt chart ───────────────────────────────────────────────────────────────

const LABEL_W = 190;

function GanttChart({ milestones, projectStart, projectEnd }) {
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

            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, height: 30 }}>
                {/* Label */}
                <div style={{
                  width: LABEL_W, flexShrink: 0, paddingRight: 12,
                  fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={m.title}>{m.title}</div>

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

export default function ProjectsPage() {
  const [view, setView]             = useState('list');   // 'list' | 'detail'
  const [projects, setProjects]     = useState([]);
  const [allTasks, setAllTasks]     = useState({});       // { projectId: tasks[] }
  const [loading, setLoading]       = useState(true);
  const [wonDeals, setWonDeals]     = useState([]);

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

  // File state
  const [projectFiles, setProjectFiles]         = useState([]);
  const [cardFiles, setCardFiles]               = useState({});   // { projectId: files[] } for list view
  const [uploadingFor, setUploadingFor]         = useState(null);
  const [showImporterForProject, setShowImporterForProject] = useState(null); // projectId | null
  const fileInputRef                             = useRef(null);
  const pendingUpload                            = useRef({ projectId: null, milestoneId: null });

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
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Open project detail
  const openProject = async (project) => {
    setActiveProject(project);
    setView('detail');
    setLoadingDetail(true);
    setExpanded({});
    setEditingMs(null);
    setProjectFiles([]);
    try {
      const [ms, ts, files] = await Promise.all([
        fetchMilestones(project.id),
        fetchProjectTasks(project.id),
        fetchProjectFiles(project.id),
      ]);
      setMilestones(ms);
      setTasks(ts);
      setProjectFiles(files);
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshDetail = async (projId) => {
    const [ms, ts, files] = await Promise.all([
      fetchMilestones(projId),
      fetchProjectTasks(projId),
      fetchProjectFiles(projId),
    ]);
    setMilestones(ms);
    setTasks(ts);
    setProjectFiles(files);
    setAllTasks(prev => ({ ...prev, [projId]: ts }));
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

  // ── Delete project ────────────────────────────────────────────────────────
  const handleDeleteProject = async () => {
    if (!confirmDeleteProj) { setConfirmDeleteProj(true); return; }
    await deleteProject(activeProject.id);
    setProjects(prev => prev.filter(p => p.id !== activeProject.id));
    setView('list');
  };

  // ── Milestone edits ───────────────────────────────────────────────────────
  const handleSaveMilestone = async (ms) => {
    const saved = await upsertMilestone(ms);
    setMilestones(prev => prev.map(m => m.id === saved.id ? saved : m));
    setEditingMs(null);
  };

  const handleDeleteMilestone = async (id) => {
    await deleteMilestone(id);
    setMilestones(prev => prev.filter(m => m.id !== id));
    setTasks(prev => prev.filter(t => t.milestone_id !== id));
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
  const handleToggleTask = async (task) => {
    await toggleTask(task.id, !task.completed);
    const updated = tasks.map(t => t.id === task.id ? { ...t, completed: !t.completed } : t);
    setTasks(updated);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
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
    await deleteProjectTask(id);
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
  };

  // ── Proposal import callback (works from card OR detail view) ────────────
  const handleImported = async ({ startDate, projectName, milestones: msParsed }, fromProjectId) => {
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
      const savedProj = await upsertProject(updatedProj);
      await bulkInsertMilestones(msRows);
      await bulkInsertTasks(tRows);

      setProjects(prev => prev.map(p => p.id === savedProj.id ? savedProj : p));

      if (fromCard) {
        // Refresh card tasks
        const ts = await fetchProjectTasks(projectId);
        setAllTasks(prev => ({ ...prev, [projectId]: ts }));
        setShowImporterForProject(null);
      } else {
        setActiveProject(savedProj);
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
  const triggerFileUpload = (projectId, milestoneId = null, e) => {
    if (e) e.stopPropagation();
    pendingUpload.current = { projectId, milestoneId };
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { projectId, milestoneId } = pendingUpload.current;
    setUploadingFor(milestoneId || projectId);
    try {
      const saved = await uploadProjectFile(projectId, file, milestoneId);
      if (activeProject?.id === projectId) {
        setProjectFiles(prev => [saved, ...prev]);
      }
      // Always update card-level files map so it shows on the card
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
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeCount    = projects.filter(p => p.status === 'active').length;
  const completedCount = projects.filter(p => p.status === 'completed').length;
  const totalTasks     = Object.values(allTasks).flat();
  const doneTasks      = totalTasks.filter(t => t.completed).length;

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
  const msForTasks = id => tasks.filter(t => t.milestone_id === id);

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <button
            onClick={() => { setView('list'); setConfirmDeleteProj(false); }}
            style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', padding: 0, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}
          >← All Projects</button>
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
                onChange={e => { setActiveProject(p => ({ ...p, status: e.target.value })); setTimeout(handleSaveProject, 50); }}
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

            <button
              onClick={handleDeleteProject}
              style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: 'none', background: confirmDeleteProj ? '#ef4444' : 'var(--surface-2)', color: confirmDeleteProj ? '#fff' : '#ef4444', fontWeight: 700, fontSize: 11, cursor: 'pointer', transition: 'all .15s' }}
            >
              {confirmDeleteProj ? 'Confirm delete' : 'Delete project'}
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
              />
            </div>
          )}

          {/* ── Project Files ─────────────────────────────────────── */}
          {projectFiles.filter(f => !f.milestone_id).length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Project Documents</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {projectFiles.filter(f => !f.milestone_id).map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                    <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>
                    <button onClick={() => handleDeleteFile(f)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }} title="Remove file">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Milestones & Tasks ─────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {milestones.map((ms, msi) => {
              const msTasks   = msForTasks(ms.id);
              const msPct     = projectProgress(msTasks);
              const isOpen    = expanded[ms.id];
              const isEditing = editingMs === ms.id;
              const color     = msColor(ms.status);

              return (
                <div key={ms.id} style={{ border: `1px solid var(--border)`, borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>

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
                        onClick={() => handleDeleteMilestone(ms.id)}
                        style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--text-faint)', padding: '4px 6px', borderRadius: 4 }}
                        title="Delete milestone"
                      >🗑</button>
                      <span style={{ fontSize: 14, color: 'var(--text-faint)', userSelect: 'none' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Expanded: inline edit fields + tasks */}
                  {isOpen && (
                    <div>
                      {/* Edit fields row */}
                      <div style={{ display: 'flex', gap: 12, padding: '10px 16px 10px 48px', borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap', background: 'var(--bg)' }}>
                        <div>
                          <Lbl>Status</Lbl>
                          <select value={ms.status} onChange={e => { const u = { ...ms, status: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }}>
                            {MILESTONE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <Lbl>Assigned to</Lbl>
                          <select value={ms.assigned_to || ''} onChange={e => { const u = { ...ms, assigned_to: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }}>
                            <option value="">Unassigned</option>
                            {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
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
                        {ms.description && (
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <Lbl>Description</Lbl>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 6 }}>{ms.description}</div>
                          </div>
                        )}
                      </div>

                      {/* Milestone Files */}
                      {projectFiles.filter(f => f.milestone_id === ms.id).map(f => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px 7px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                          <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>
                          <button onClick={() => handleDeleteFile(f)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}

                      {/* Tasks */}
                      {msTasks.map(task => (
                        <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 48px', borderBottom: '1px solid var(--border-light)', background: task.completed ? 'var(--surface-2)' : 'var(--surface)' }}>
                          <input
                            type="checkbox"
                            checked={task.completed}
                            onChange={() => handleToggleTask(task)}
                            style={{ width: 15, height: 15, accentColor: color, cursor: 'pointer', flexShrink: 0 }}
                          />
                          <span style={{ flex: 1, fontSize: 13, color: task.completed ? 'var(--text-faint)' : 'var(--text)', textDecoration: task.completed ? 'line-through' : 'none' }}>
                            {task.title}
                          </span>
                          <select
                            value={task.assigned_to || ''}
                            onChange={e => { const u = { ...task, assigned_to: e.target.value }; setTasks(p => p.map(t => t.id === task.id ? u : t)); upsertProjectTask(u); }}
                            onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, padding: '2px 6px', width: 'auto', color: 'var(--text-muted)' }}
                          >
                            <option value="">—</option>
                            {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                          {task.due_date && <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{fmtDate(task.due_date)}</span>}
                          <button onClick={() => handleDeleteTask(task.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}

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
                          onClick={() => { setNewTaskMs(ms.id); setNewTaskTitle(''); }}
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
                    </div>
                  )}
                </div>
              );
            })}

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
