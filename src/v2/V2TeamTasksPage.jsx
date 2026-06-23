import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchAllTasksByOwner,
    fetchMilestones,
    fetchProjectFiles,
    fmtDate,
    msColor,
    msLabel,
    loadTeamMembers,
    DEFAULT_TEAM_MEMBERS,
} from './safe-data.js';
import { toggleTask } from './write-data.js';

/* ============================================
   V2 TEAM TASKS

   Per-owner task triage. Mirrors Mike's legacy
   `view === 'assigned'` block:
     • Owner picker (+ Unassigned)
     • Refresh button
     • Three groups (sticky labels):
         - Changes Requested (rejected_at)
         - Active (not completed)
         - Completed
     • Per task: title, project crumb, milestone
       chip, due date (overdue red), file count,
       owner pill (when inherited from milestone)
     • Checkbox toggle complete (write)
     • Edit / approve / reject stay in legacy via
       "Open in legacy" link per row.
============================================ */

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function ownersListFromTeam(team) {
    return team.length ? team.map((m) => m.name) : DEFAULT_TEAM_MEMBERS.map((m) => m.name);
}

export default function V2TeamTasksPage({ onSelectProject }) {
    const [team, setTeam] = useState(DEFAULT_TEAM_MEMBERS);
    const owners = useMemo(() => ownersListFromTeam(team), [team]);

    const [owner, setOwner] = useState(owners[0] || 'Mike');
    const [tasks, setTasks] = useState([]);
    const [filesByTask, setFilesByTask] = useState({});
    const [projects, setProjects] = useState([]);
    const [milestones, setMilestones] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState(null);

    // Load the team once
    useEffect(() => {
        loadTeamMembers().then((tm) => {
            setTeam(tm);
            const names = ownersListFromTeam(tm);
            // Default to first member if our current pick isn't in the new list
            if (names.length && !names.includes(owner) && owner !== '__unassigned__') {
                setOwner(names[0]);
            }
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load projects once (needed for project crumb)
    useEffect(() => {
        fetchProjects().then(setProjects).catch(() => {});
    }, []);

    // Load tasks (re-runs on owner change)
    const load = useCallback(async (which) => {
        try {
            setLoading(true);
            setError(null);
            const raw = await fetchAllTasksByOwner(which);

            // Pull milestones + task-attached files for every project these tasks belong to.
            const projectIds = [...new Set(raw.map((t) => t.project_id).filter(Boolean))];
            const msMap = {};
            const fileMap = {};
            await Promise.all(projectIds.map(async (pid) => {
                const [ms, files] = await Promise.all([
                    fetchMilestones(pid).catch(() => []),
                    fetchProjectFiles(pid).catch(() => []),
                ]);
                ms.forEach((m) => { msMap[m.id] = m; });
                files.filter((f) => f.task_id).forEach((f) => {
                    if (!fileMap[f.task_id]) fileMap[f.task_id] = [];
                    fileMap[f.task_id].push(f);
                });
            }));

            setMilestones(msMap);
            setFilesByTask(fileMap);
            setTasks(raw);
        } catch (err) {
            setError(err.message || 'Failed to load tasks');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(owner); }, [owner, load]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const handleToggle = useCallback(async (task) => {
        const prev = task.completed;
        const next = !prev;
        // Optimistic
        setTasks((s) => s.map((t) => t.id === task.id ? { ...t, completed: next } : t));
        try {
            await toggleTask(task.id, next);
        } catch (err) {
            setTasks((s) => s.map((t) => t.id === task.id ? { ...t, completed: prev } : t));
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t update task' });
        }
    }, []);

    const projectById = useMemo(() => {
        const m = new Map();
        for (const p of projects) m.set(p.id, p);
        return m;
    }, [projects]);

    const today = todayISO();
    const grouped = useMemo(() => {
        const rejected  = tasks.filter((t) => t.completed && t.rejected_at);
        const active    = tasks.filter((t) => !t.completed);
        const completed = tasks.filter((t) => t.completed && !t.rejected_at);
        // Active sorted by due date asc, undated last
        active.sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return a.due_date.localeCompare(b.due_date);
        });
        return { rejected, active, completed };
    }, [tasks]);

    const stats = useMemo(() => {
        const completedCount = tasks.filter((t) => t.completed).length;
        const overdueCount = tasks.filter((t) =>
            !t.completed && t.due_date && t.due_date < today
        ).length;
        return { completedCount, overdueCount };
    }, [tasks, today]);

    const isUnassigned = owner === '__unassigned__';

    return (
        <>
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">your work</div>
                    <h1 className="v2-page-title">
                        Team Tasks
                        <span className="v2-page-title__count">
                            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                            {stats.completedCount > 0 && ` · ${stats.completedCount} done`}
                            {stats.overdueCount > 0 && ` · ${stats.overdueCount} overdue`}
                        </span>
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading
                            ? 'Loading from Supabase…'
                            : isUnassigned
                                ? 'Tasks without an owner, sorted by due date'
                                : `Assigned to ${owner}, sorted by due date`}
                    </p>
                </div>
                <div className="v2-page-header__actions">
                    <div className="v2-select-wrap">
                        <select
                            className="v2-select"
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                        >
                            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                            <option value="__unassigned__">Unassigned</option>
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                    <button
                        type="button"
                        className="v2-btn"
                        onClick={() => load(owner)}
                        disabled={loading}
                        title="Refresh"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        Refresh
                    </button>
                </div>
            </div>

            {error && <div className="v2-error">{error}</div>}

            {loading && (
                <div className="v2-empty"><strong>Loading…</strong>Pulling tasks from Supabase.</div>
            )}

            {!loading && tasks.length === 0 && (
                <div className="v2-empty">
                    <strong>
                        {isUnassigned
                            ? 'No unassigned tasks'
                            : `No tasks assigned to ${owner}`}
                    </strong>
                    {isUnassigned
                        ? 'Tasks without an owner will appear here sorted by due date.'
                        : 'New tasks assigned to them will land here.'}
                </div>
            )}

            {!loading && tasks.length > 0 && (
                <div className="v2-tt-list">
                    {grouped.rejected.length > 0 && (
                        <>
                            <div className="v2-tt-divider v2-tt-divider--rejected">
                                <span className="v2-tt-divider__icon">●</span>
                                Changes requested · {grouped.rejected.length}
                            </div>
                            {grouped.rejected.map((task) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    project={projectById.get(task.project_id)}
                                    milestone={task.milestone_id ? milestones[task.milestone_id] : null}
                                    files={filesByTask[task.id] || []}
                                    today={today}
                                    variant="rejected"
                                    onToggle={() => handleToggle(task)}
                                    onOpenProject={onSelectProject}
                                />
                            ))}
                        </>
                    )}

                    {grouped.active.length > 0 && (
                        <>
                            {(grouped.rejected.length > 0 || grouped.completed.length > 0) && (
                                <div className="v2-tt-divider">Active · {grouped.active.length}</div>
                            )}
                            {grouped.active.map((task) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    project={projectById.get(task.project_id)}
                                    milestone={task.milestone_id ? milestones[task.milestone_id] : null}
                                    files={filesByTask[task.id] || []}
                                    today={today}
                                    variant="active"
                                    onToggle={() => handleToggle(task)}
                                    onOpenProject={onSelectProject}
                                />
                            ))}
                        </>
                    )}

                    {grouped.completed.length > 0 && (
                        <>
                            <div className="v2-tt-divider v2-tt-divider--done">Completed · {grouped.completed.length}</div>
                            {grouped.completed.map((task) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    project={projectById.get(task.project_id)}
                                    milestone={task.milestone_id ? milestones[task.milestone_id] : null}
                                    files={filesByTask[task.id] || []}
                                    today={today}
                                    variant="completed"
                                    onToggle={() => handleToggle(task)}
                                    onOpenProject={onSelectProject}
                                />
                            ))}
                        </>
                    )}
                </div>
            )}

            {toast && (
                <div className={`v2-toast v2-toast--${toast.kind}`}>
                    <span className="v2-toast__icon">{toast.kind === 'win' ? '✓' : toast.kind === 'warn' ? '!' : '·'}</span>
                    <span>{toast.text}</span>
                </div>
            )}
        </>
    );
}

function TaskRow({ task, project, milestone, files, today, variant, onToggle, onOpenProject }) {
    const isOverdue = !task.completed && task.due_date && task.due_date < today;
    const projectName = project?.name || 'Unknown project';
    const projectStatus = project?.status;
    const msStatusLabel = milestone ? msLabel(milestone.status) : null;
    const msStatusColor = milestone ? msColor(milestone.status) : null;
    const inheritedOwner = !task.assigned_to && milestone?.assigned_to;

    return (
        <div className={`v2-tt-row v2-tt-row--${variant} ${isOverdue ? 'is-overdue' : ''}`}>
            <button
                type="button"
                className={`v2-tt-row__check ${task.completed ? 'is-checked' : ''}`}
                onClick={onToggle}
                aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                title={task.completed ? 'Mark incomplete' : 'Mark complete'}
            >
                {task.completed && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                )}
            </button>

            <div className="v2-tt-row__body">
                <div className="v2-tt-row__title-line">
                    <span className={`v2-tt-row__title ${task.completed ? 'is-done' : ''}`}>
                        {task.title || 'Untitled task'}
                    </span>
                    {variant === 'rejected' && (
                        <span className="v2-tt-row__rejected-chip">Changes requested</span>
                    )}
                    {inheritedOwner && (
                        <span className="v2-tt-row__inherited">via {milestone.assigned_to}</span>
                    )}
                </div>

                <div className="v2-tt-row__meta">
                    {project && (
                        <button
                            type="button"
                            className="v2-tt-row__crumb"
                            onClick={() => onOpenProject?.(project.id)}
                            title="Open project"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                            {projectName}
                            {projectStatus && projectStatus !== 'active' && (
                                <span className="v2-tt-row__crumb-status">· {projectStatus}</span>
                            )}
                        </button>
                    )}
                    {milestone && (
                        <span
                            className="v2-tt-row__ms"
                            style={{ '--ms-accent': msStatusColor }}
                            title={`Milestone status: ${msStatusLabel}`}
                        >
                            {milestone.name}
                        </span>
                    )}
                    {files.length > 0 && (
                        <span className="v2-tt-row__files">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/><path d="M17 3l4 4-9 9H8v-4z"/></svg>
                            {files.length}
                        </span>
                    )}
                    {task.rejection_notes && (
                        <span className="v2-tt-row__reason" title={task.rejection_notes}>
                            "{task.rejection_notes.length > 60 ? task.rejection_notes.slice(0, 60) + '…' : task.rejection_notes}"
                        </span>
                    )}
                </div>
            </div>

            <div className="v2-tt-row__right">
                {task.due_date ? (
                    <span className={`v2-tt-row__due ${isOverdue ? 'is-overdue' : ''}`}>
                        {fmtDate(task.due_date)}
                    </span>
                ) : (
                    <span className="v2-tt-row__due v2-tt-row__due--none">no due</span>
                )}
                <a
                    href="/legacy"
                    onClick={(e) => { e.preventDefault(); window.location.href = '/legacy'; }}
                    className="v2-tt-row__legacy"
                    title="Edit / approve / reject in legacy"
                >
                    edit ↗
                </a>
            </div>
        </div>
    );
}
