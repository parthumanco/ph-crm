import { useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchMilestones,
    fetchProjectTasks,
    fetchProjectFiles,
    fmtDate,
} from './safe-data.js';

/* ============================================
   V2 PROJECT DETAIL

   Renders a single project's hero + Gantt
   timeline + milestones-with-tasks + side panel.
   Wired to lib/projects.js read functions. The
   parent passes the projectId (V2App tracks
   navigation state). If no id is provided, we
   fall back to the first active project so the
   page is always demoable.
============================================ */

function daysFromNow(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
}

function milestoneStatusClass(status) {
    if (status === 'completed')   return 'v2-ms-status v2-ms-status--done';
    if (status === 'in_progress') return 'v2-ms-status v2-ms-status--current';
    if (status === 'blocked')     return 'v2-ms-status v2-ms-status--current';
    return 'v2-ms-status v2-ms-status--upcoming';
}

function milestoneStatusLabel(status) {
    switch (status) {
        case 'completed':   return 'Complete';
        case 'in_progress': return 'In progress';
        case 'blocked':     return 'Blocked';
        default:            return 'Upcoming';
    }
}

function progressFillClass(status, dueSoon, progress) {
    if (status === 'completed') return 'v2-progress__fill--gray';
    if (dueSoon && progress < 50) return 'v2-progress__fill--orange';
    return '';
}

export default function V2ProjectPage({ projectId, onBack }) {
    const [project, setProject] = useState(null);
    const [milestones, setMilestones] = useState([]);
    const [tasksByMs, setTasksByMs] = useState({});
    const [files, setFiles] = useState([]);
    const [expandedMs, setExpandedMs] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const projects = await fetchProjects();
                if (cancelled) return;
                const target = projectId
                    ? projects.find((p) => p.id === projectId)
                    : projects[0];
                if (!target) {
                    setError('Project not found');
                    return;
                }
                setProject(target);

                const [ms, fs] = await Promise.all([
                    fetchMilestones(target.id),
                    fetchProjectFiles(target.id).catch(() => []),
                ]);
                if (cancelled) return;
                setMilestones(ms);
                setFiles(fs);

                // Tasks per milestone, parallel
                const tasksEntries = await Promise.all(
                    ms.map(async (m) => {
                        try {
                            const t = await fetchProjectTasks(target.id);
                            return [m.id, t.filter((tk) => tk.milestone_id === m.id)];
                        } catch {
                            return [m.id, []];
                        }
                    })
                );
                if (cancelled) return;
                setTasksByMs(Object.fromEntries(tasksEntries));

                // Auto-expand the current in-progress milestone
                const current = ms.find((m) => m.status === 'in_progress');
                if (current) setExpandedMs(current.id);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load project');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [projectId]);

    const stats = useMemo(() => {
        if (!milestones.length) return { progress: 0, total: 0, done: 0, daysLeft: null };
        let total = 0, done = 0;
        for (const m of milestones) {
            const t = tasksByMs[m.id] || [];
            total += t.length;
            done += t.filter((x) => x.completed).length;
        }
        const progress = total ? Math.round((done / total) * 100) : 0;
        const daysLeft = project?.end_date ? daysFromNow(project.end_date) : null;
        return { progress, total, done, daysLeft };
    }, [milestones, tasksByMs, project]);

    if (loading) {
        return (
            <>
                <div className="v2-page-header">
                    <div>
                        <div className="v2-page-header__eyebrow">loading project</div>
                        <h1 className="v2-page-title">Project detail</h1>
                    </div>
                </div>
                <div className="v2-empty"><strong>Loading…</strong>Pulling from Supabase.</div>
            </>
        );
    }

    if (error || !project) {
        return (
            <>
                <div className="v2-error">{error || 'Project not found'}</div>
                <button type="button" className="v2-btn" onClick={onBack}>← Back to projects</button>
            </>
        );
    }

    return (
        <>
            {/* HERO */}
            <section className="v2-project-hero">
                <div className="v2-project-hero__top">
                    <div className="v2-project-mark">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                    </div>
                    <div className="v2-project-header">
                        <div className="v2-project-eyebrow">
                            {project.client_name && <span>{project.client_name}</span>}
                            <span>·</span>
                            <span>Project</span>
                        </div>
                        <h1 className="v2-project-name">{project.name}</h1>
                        <div className="v2-project-meta">
                            <span className="v2-project-status">
                                <span className="v2-project-status__dot" />
                                {project.status || 'Active'}
                            </span>
                            {project.start_date && (
                                <span className="v2-project-meta__item">Started {fmtDate(project.start_date)}</span>
                            )}
                            {project.end_date && (
                                <span className="v2-project-meta__item">Due {fmtDate(project.end_date)}</span>
                            )}
                            {project.contact_name && (
                                <span className="v2-project-meta__item">Contact: {project.contact_name}</span>
                            )}
                        </div>
                    </div>
                    <div className="v2-project-actions">
                        <button type="button" className="v2-btn" onClick={onBack}>← All projects</button>
                    </div>
                </div>

                <div className="v2-project-stats">
                    <div className="v2-project-stat">
                        <div className="v2-project-stat__label">Progress</div>
                        <div className="v2-project-stat__row">
                            <span className="v2-project-stat__value">{stats.progress}</span>
                            <span className="v2-project-stat__unit">% complete</span>
                        </div>
                        <div className="v2-project-stat__bar">
                            <span className="v2-project-stat__bar-fill" style={{ width: `${stats.progress}%` }} />
                        </div>
                    </div>
                    <div className="v2-project-stat">
                        <div className="v2-project-stat__label">Tasks</div>
                        <div className="v2-project-stat__row">
                            <span className="v2-project-stat__value">{stats.done}</span>
                            <span className="v2-project-stat__unit">of {stats.total} done</span>
                        </div>
                    </div>
                    <div className="v2-project-stat">
                        <div className="v2-project-stat__label">Milestones</div>
                        <div className="v2-project-stat__row">
                            <span className="v2-project-stat__value">{milestones.length}</span>
                            <span className="v2-project-stat__unit">phases</span>
                        </div>
                    </div>
                    <div className="v2-project-stat">
                        <div className="v2-project-stat__label">Files</div>
                        <div className="v2-project-stat__row">
                            <span className="v2-project-stat__value">{files.length}</span>
                            <span className="v2-project-stat__unit">deliverables</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* MILESTONES (Gantt is left for a later port; static prototype shows the visual target) */}
            <div className="v2-section v2-section--milestones">
                <div className="v2-section__header">
                    <div className="v2-section__title-block">
                        <div className="v2-section__eyebrow">the work</div>
                        <h2 className="v2-section__title">
                            Milestones
                            {milestones.length > 0 && (
                                <span className="v2-section__count">
                                    {milestones.length} {milestones.length === 1 ? 'phase' : 'phases'}
                                </span>
                            )}
                        </h2>
                    </div>
                </div>
                <div className="v2-section__card">
                    <div className="v2-milestone-list">
                        {milestones.length === 0 && (
                            <div className="v2-empty">
                                <strong>No milestones yet</strong>
                                Add phases from the legacy app · they'll appear here read-only.
                            </div>
                        )}
                        {milestones.map((m, i) => {
                            const tasks = tasksByMs[m.id] || [];
                            const done = tasks.filter((t) => t.completed).length;
                            const total = tasks.length;
                            const progress = total ? Math.round((done / total) * 100) : 0;
                            const expanded = expandedMs === m.id;
                            const daysLeft = m.due_date ? daysFromNow(m.due_date) : null;
                            const dueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
                            return (
                                <div key={m.id} className={`v2-milestone-row ${expanded ? 'is-expanded' : ''}`}>
                                    <button
                                        type="button"
                                        className="v2-milestone-row__head"
                                        onClick={() => setExpandedMs(expanded ? null : m.id)}
                                    >
                                        <div className="v2-milestone-row__num">{String(i + 1).padStart(2, '0')}</div>
                                        <div className="v2-milestone-row__title-block">
                                            <div className="v2-milestone-row__title">{m.name}</div>
                                            <div className="v2-milestone-row__dates">
                                                {m.start_date && fmtDate(m.start_date)}
                                                {m.due_date && ` – ${fmtDate(m.due_date)}`}
                                                {dueSoon && <span style={{ color: 'var(--v2-orange)', fontWeight: 600 }}>{' · '}{daysLeft} days left</span>}
                                            </div>
                                        </div>
                                        <div>
                                            <span className={milestoneStatusClass(m.status)}>{milestoneStatusLabel(m.status)}</span>
                                        </div>
                                        <div className="v2-milestone-row__progress">
                                            <div className="v2-milestone-row__progress-bar">
                                                <span
                                                    className={`v2-milestone-row__progress-fill ${progressFillClass(m.status, dueSoon, progress)}`}
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                            <span className="v2-milestone-row__progress-label">{done} / {total}</span>
                                        </div>
                                    </button>
                                    {expanded && (
                                        <div className="v2-milestone-row__body">
                                            {tasks.length === 0 ? (
                                                <div className="v2-empty" style={{ padding: '14px 8px' }}>
                                                    No tasks on this milestone.
                                                </div>
                                            ) : tasks.map((t) => (
                                                <div key={t.id} className={`v2-task ${t.completed ? 'v2-task--done' : ''}`}>
                                                    <span className="v2-task__checkbox">
                                                        {t.completed && (
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                        )}
                                                    </span>
                                                    <span className="v2-task__title">{t.title}</span>
                                                    {t.due_date && <span className="v2-task__due">{fmtDate(t.due_date)}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* FILES */}
            {files.length > 0 && (
                <div className="v2-section v2-section--files">
                    <div className="v2-section__header">
                        <div className="v2-section__title-block">
                            <div className="v2-section__eyebrow">deliverables</div>
                            <h2 className="v2-section__title">
                                Files
                                <span className="v2-section__count">{files.length}</span>
                            </h2>
                        </div>
                    </div>
                    <div className="v2-section__card">
                        <div>
                            {files.map((f) => (
                                <div key={f.id} className="v2-file-row">
                                    <div className="v2-file-row__icon">📄</div>
                                    <div className="v2-file-row__body">
                                        <div className="v2-file-row__name">{f.name || f.file_name || f.url || 'File'}</div>
                                        {f.uploaded_at && <div className="v2-file-row__meta">{fmtDate(f.uploaded_at)}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
