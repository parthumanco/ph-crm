import { useState, useEffect } from 'react';
import { fetchProjectByToken, approveMilestone, fetchMilestones, fetchProjectTasks, fetchProjectFiles } from '../lib/projects';

const ACCENT = '#E8541E';

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime) {
  if (!mime) return '📎';
  if (mime === 'link') return '🔗';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  return '📎';
}

const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Complete',
  blocked: 'Blocked',
};

const STATUS_COLORS = {
  not_started: '#94a3b8',
  in_progress: '#f59e0b',
  completed: '#10b981',
  blocked: '#ef4444',
};

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#94a3b8';
  const label = STATUS_LABELS[status] || status;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
      background: color + '20', color, border: `1px solid ${color}40`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function ProgressBar({ pct, color = ACCENT, height = 6 }) {
  return (
    <div style={{ height, background: '#e5e7eb', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: height, transition: 'width .4s' }} />
    </div>
  );
}

// ── Password Gate ─────────────────────────────────────────────────────────────

function PasswordGate({ token, password, onSuccess }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = () => {
    if (input === password) {
      sessionStorage.setItem(`portal_pw_${token}`, '1');
      onSuccess();
    } else {
      setError(true);
      setInput('');
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#f9fafb',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, sans-serif', padding: 20,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px', maxWidth: 400, width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: '"Playfair Display", serif', fontWeight: 700,
          fontSize: 24, color: ACCENT, marginBottom: 24, letterSpacing: '-0.02em',
        }}>Part Human</div>

        <div style={{ fontSize: 36, marginBottom: 16 }}>🔒</div>

        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          This project requires a password
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 28 }}>
          Enter the password provided by your project team.
        </div>

        <input
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter password"
          autoFocus
          style={{
            width: '100%', padding: '11px 14px', fontSize: 15, borderRadius: 8,
            border: `1.5px solid ${error ? '#ef4444' : '#d1d5db'}`,
            outline: 'none', marginBottom: 12, boxSizing: 'border-box',
            fontFamily: 'Inter, sans-serif',
          }}
        />

        {error && (
          <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 12, fontWeight: 600 }}>
            Incorrect password. Please try again.
          </div>
        )}

        <button
          onClick={handleSubmit}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: ACCENT, color: '#fff', fontSize: 15, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          }}
        >Enter</button>
      </div>
    </div>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────

export default function ClientPortalPage({ token }) {
  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    async function load() {
      try {
        const proj = await fetchProjectByToken(token);
        setProject(proj);

        // Check password gate
        if (proj.portal_password) {
          const stored = sessionStorage.getItem(`portal_pw_${token}`);
          if (stored === '1') setAuthed(true);
          // else: stay unauthenticated until password entered
        } else {
          setAuthed(true);
        }

        // Load all data regardless (so it's ready after auth)
        const [ms, ts, fs] = await Promise.all([
          fetchMilestones(proj.id),
          fetchProjectTasks(proj.id),
          fetchProjectFiles(proj.id).catch(() => []),
        ]);
        setMilestones(ms);
        setTasks(ts);
        setFiles(fs);
      } catch (e) {
        setError(e.message || 'Project not found');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleApprove = async (ms) => {
    try {
      await approveMilestone(ms.id, 'Client');
      setMilestones(prev => prev.map(m =>
        m.id === ms.id ? { ...m, approved_at: new Date().toISOString(), approved_by: 'Client' } : m
      ));
    } catch (e) {
      console.error('Approve failed:', e.message);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: `3px solid #e5e7eb`, borderTopColor: ACCENT,
            borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Loading project…</div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: 20 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 8 }}>Project Not Found</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>
            This link may be invalid or the project may no longer be available.
          </div>
        </div>
      </div>
    );
  }

  // ── Password gate ─────────────────────────────────────────────────────────

  if (project.portal_password && !authed) {
    return (
      <PasswordGate
        token={token}
        password={project.portal_password}
        onSuccess={() => setAuthed(true)}
      />
    );
  }

  // ── Compute progress ──────────────────────────────────────────────────────

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.completed).length;
  const pct = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0;

  // ── Tasks grouped by milestone ────────────────────────────────────────────

  const tasksByMs = tasks.reduce((acc, t) => {
    if (!acc[t.milestone_id]) acc[t.milestone_id] = [];
    acc[t.milestone_id].push(t);
    return acc;
  }, {});

  // ── Files grouped ─────────────────────────────────────────────────────────

  const generalFiles = files.filter(f => !f.milestone_id && !f.task_id);
  const milestoneFiles = (msId) => files.filter(f => f.milestone_id === msId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'Inter, sans-serif', color: '#111827' }}>

      {/* Top bar */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '0 32px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{
          fontFamily: '"Playfair Display", serif', fontWeight: 700,
          fontSize: 20, color: ACCENT, letterSpacing: '-0.02em',
        }}>Part Human</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>
          {project.name}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* Project header card */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: '28px 32px', marginBottom: 28,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb',
        }}>
          {project.client_name && (
            <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
              {project.client_name}
            </div>
          )}
          <div style={{ fontSize: 16, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>
            {project.name}
          </div>

          {(project.start_date || project.end_date) && (
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>📅</span>
              {project.start_date && <span>{fmtDate(project.start_date)}</span>}
              {project.start_date && project.end_date && <span>→</span>}
              {project.end_date && <span>{fmtDate(project.end_date)}</span>}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Overall Progress</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>{pct}%</span>
          </div>
          <ProgressBar pct={pct} color={ACCENT} height={8} />
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
            {doneTasks} of {totalTasks} tasks complete
          </div>
        </div>

        {/* Milestones */}
        {milestones.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 14 }}>
              Project Timeline
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {milestones.map(ms => {
                const msTasks = (tasksByMs[ms.id] || [])
                  .slice()
                  .sort((a, b) => {
                    if (a.order_index != null && b.order_index != null) return a.order_index - b.order_index;
                    if (!a.due_date && !b.due_date) return 0;
                    if (!a.due_date) return 1;
                    if (!b.due_date) return -1;
                    return a.due_date.localeCompare(b.due_date);
                  });
                const msColor = STATUS_COLORS[ms.status] || '#94a3b8';
                const isOpen = expanded[ms.id];
                const isComplete = ms.status === 'completed';
                const msFiles = milestoneFiles(ms.id);

                return (
                  <div key={ms.id} style={{
                    background: '#fff', borderRadius: 12, overflow: 'hidden',
                    border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                  }}>
                    {/* Milestone header */}
                    <div
                      onClick={() => setExpanded(e => ({ ...e, [ms.id]: !e[ms.id] }))}
                      style={{
                        display: 'grid', gridTemplateColumns: '4px 1fr auto', gap: 0,
                        alignItems: 'stretch', cursor: 'pointer',
                        borderBottom: isOpen ? '1px solid #f3f4f6' : 'none',
                      }}
                    >
                      {/* Color strip */}
                      <div style={{ background: msColor, opacity: 0.8 }} />

                      {/* Content */}
                      <div style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{ms.title}</span>
                          <StatusBadge status={ms.status} />
                          {ms.due_date && (
                            <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
                              {ms.start_date ? `${fmtDate(ms.start_date)} – ` : ''}{fmtDate(ms.due_date)}
                            </span>
                          )}
                        </div>
                        {msTasks.length > 0 && (
                          <div style={{ fontSize: 12, color: '#9ca3af' }}>
                            {msTasks.filter(t => t.completed).length}/{msTasks.length} tasks
                          </div>
                        )}
                      </div>

                      {/* Chevron */}
                      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', color: '#9ca3af', fontSize: 13 }}>
                        {isOpen ? '▲' : '▼'}
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isOpen && (
                      <div>
                        {/* Tasks */}
                        {msTasks.map(task => (
                          <div key={task.id} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 18px 10px 22px',
                            borderBottom: '1px solid #f9fafb',
                          }}>
                            <span style={{
                              fontSize: 16, flexShrink: 0, color: task.completed ? '#10b981' : '#d1d5db',
                            }}>
                              {task.completed ? '✓' : '□'}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{
                                fontSize: 14, color: task.completed ? '#9ca3af' : '#374151',
                                fontWeight: task.completed ? 400 : 500,
                                textDecoration: task.completed ? 'line-through' : 'none',
                                textDecorationColor: '#9ca3af',
                              }}>
                                {task.title}
                              </span>
                            </div>
                            {task.due_date && (
                              <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                {fmtDate(task.due_date)}
                              </span>
                            )}
                          </div>
                        ))}

                        {/* Milestone files */}
                        {msFiles.length > 0 && msFiles.map(f => (
                          <div key={f.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 18px 9px 22px', borderBottom: '1px solid #f9fafb',
                            background: '#fafafa',
                          }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                            <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                              flex: 1, fontSize: 13, fontWeight: 600, color: ACCENT,
                              textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{f.name}</a>
                            {f.size && <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>}
                          </div>
                        ))}

                        {/* Approve section */}
                        {isComplete && (
                          <div style={{
                            padding: '14px 18px', background: '#f0fdf4', borderTop: '1px solid #dcfce7',
                            display: 'flex', alignItems: 'center', gap: 12,
                          }}>
                            {ms.approved_at ? (
                              <span style={{
                                fontSize: 13, fontWeight: 700, color: '#10b981',
                                display: 'flex', alignItems: 'center', gap: 6,
                              }}>
                                <span>✓</span> Approved on {fmtDate(ms.approved_at)}
                              </span>
                            ) : (
                              <>
                                <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>
                                  This phase is complete. Ready to sign off?
                                </span>
                                <button
                                  onClick={() => handleApprove(ms)}
                                  style={{
                                    padding: '8px 18px', borderRadius: 8, border: 'none',
                                    background: ACCENT, color: '#fff', fontSize: 13, fontWeight: 700,
                                    cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
                                  }}
                                >
                                  Approve this phase →
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files section */}
        {files.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 14 }}>
              Project Files
            </div>
            <div style={{
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            }}>
              {generalFiles.length > 0 && (
                <>
                  {generalFiles.length < files.length && (
                    <div style={{ padding: '8px 18px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                      General
                    </div>
                  )}
                  {generalFiles.map((f, i) => (
                    <div key={f.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                      borderBottom: i < files.length - 1 ? '1px solid #f3f4f6' : 'none',
                    }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                        flex: 1, fontSize: 14, fontWeight: 600, color: ACCENT,
                        textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{f.name}</a>
                      {f.size && <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>}
                    </div>
                  ))}
                </>
              )}

              {/* Per-milestone files */}
              {milestones.map(ms => {
                const msFs = milestoneFiles(ms.id);
                if (!msFs.length) return null;
                return msFs.map((f, i) => (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                    borderBottom: '1px solid #f3f4f6',
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 14, fontWeight: 600, color: ACCENT,
                        textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                      }}>{f.name}</a>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{ms.title}</div>
                    </div>
                    {f.size && <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>}
                  </div>
                ));
              })}
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '24px 20px', fontSize: 12, color: '#9ca3af' }}>
        Powered by <a href="https://parthuman.com" target="_blank" rel="noopener noreferrer" style={{ color: '#9ca3af', textDecoration: 'none', fontWeight: 600 }}>Part Human</a> · parthuman.com
      </div>
    </div>
  );
}
