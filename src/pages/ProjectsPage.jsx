import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { generateProjectSummary, generateSummaryFromActivity, generateRejectionResponse } from '../lib/anthropic';
import {
  fetchProjects, fetchArchivedProjects, upsertProject, archiveProject, restoreProject, deleteProject,
  fetchMilestones, fetchArchivedMilestones, upsertMilestone, archiveMilestone, restoreMilestone, deleteMilestone,
  fetchProjectTasks, upsertProjectTask, toggleTask, deleteProjectTask, rejectTask, approveTask, saveRejectionResponse, addToReviewChain, clearRejectionFields,
  fetchProjectFiles, fetchArchivedProjectFiles, uploadProjectFile, deleteProjectFile, archiveProjectFile, restoreProjectFile, addExternalLink,
  restoreProjectTask, fetchAllTasksByOwner, saveTaskPortalContact,
  bulkInsertMilestones, bulkInsertTasks, parseProposalWithAI, extractPdfTextAndPages,
  fetchProjectMeetings, deleteProjectMeeting,
  PROJECT_STATUSES, MILESTONE_STATUSES, OWNERS,
  projColor, projLabel, msColor, msLabel,
  daysBetween, addDays, projectProgress, fmtDate,
} from '../lib/projects';
import { fetchDeals, fetchActivities, addActivity, fetchTasks, ACTIVITY_TYPES } from '../lib/deals';
import { fetchCompanyIntel, silentRefreshThesis, fetchClients, findOrCreateClient, upsertClientContacts } from '../lib/clients';
import ProposalImporter from '../components/ProposalImporter';
import TranscriptImporter from '../components/TranscriptImporter';
import CompanyIntelPanel from '../components/CompanyIntelPanel';
import ContactsPanel from '../components/ContactsPanel';

async function sendPortalNotification(toEmail, subject, bodyHtml, ccEmails = []) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  const res = await fetch(`${supabaseUrl}/functions/v1/project-notification`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to: toEmail, cc: ccEmails, subject, html: bodyHtml }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Send failed');
  return data;
}
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
        <div style={{ display: 'flex', marginBottom: 4 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={{ flex: 1, position: 'relative', height: 16 }}>
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
                  display: 'flex', alignItems: 'center', marginBottom: 4, height: 22,
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
                  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
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

function ProjectCard({ project, tasks, files, onClick }) {
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

      {/* File count badge */}
      {files?.length > 0 && (
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600 }}>
            📎 {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

// ── MeetingCard ───────────────────────────────────────────────────────────────

function MeetingCard({ mtg, tasks, isExpanded, onToggleExpanded, onEdit, onDelete, onActionItemClick, innerBg = 'var(--surface)' }) {
  return (
    <>
      {/* Header row — always visible */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{mtg.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            {mtg.meeting_date && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {new Date(mtg.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            {mtg.meeting_time && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>· {mtg.meeting_time}</span>}
            {mtg.attendees?.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>· {mtg.attendees.join(', ')}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={onEdit}
            style={{ fontSize: 10, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}
            title="Edit meeting"
          >✏</button>
          <button
            onClick={onDelete}
            style={{ fontSize: 10, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}
            title="Delete meeting"
          >🗑</button>
          {mtg.transcript && (
            <span
              onClick={onToggleExpanded}
              style={{ fontSize: 11, color: 'var(--text-faint)', padding: '2px 4px', cursor: 'pointer' }}
              title={isExpanded ? 'Hide transcript' : 'View transcript'}
            >{isExpanded ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {/* Always-visible: full summary + task pills */}
      {mtg.summary && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 8 }}>
          {mtg.summary}
        </div>
      )}
      {mtg.action_items?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {mtg.action_items.map((ai, ai_i) => {
            const alreadyTask = tasks.some(t => t.title?.toLowerCase().trim() === ai.title?.toLowerCase().trim());
            return alreadyTask ? (
              <span
                key={ai_i}
                title="Already added as a task"
                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ fontSize: 10 }}>✓</span>
                {ai.owner && <span style={{ fontWeight: 700, marginRight: 2 }}>{ai.owner}</span>}
                {ai.title}
              </span>
            ) : (
              <span
                key={ai_i}
                onClick={() => onActionItemClick(ai)}
                title="Click to add as task"
                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: innerBg, border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', transition: 'background .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-light, #ede9fe)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = innerBg; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                {ai.owner && <span style={{ fontWeight: 700, color: 'var(--accent)', marginRight: 4 }}>{ai.owner}</span>}
                {ai.title}
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded: full transcript */}
      {isExpanded && mtg.transcript && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: innerBg, border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>
          {mtg.transcript}
        </div>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectsPage({ goHomeRef, refreshKey = 0, teamMembers = [], targetProjectId = null, onTargetProjectConsumed }) {
  // Dynamic owner list from Settings — falls back to hardcoded OWNERS if not configured
  const owners = teamMembers.length ? teamMembers.map(m => m.name) : OWNERS;
  const [view, setView]             = useState('list');   // 'list' | 'detail'
  const [projects, setProjects]     = useState([]);
  const consumedProjectIdRef        = useRef(null); // deep-link: avoid re-opening same project repeatedly
  const [allTasks, setAllTasks]     = useState({});       // { projectId: tasks[] }
  const [loading, setLoading]       = useState(true);
  const [allDeals, setAllDeals]     = useState([]);   // every pipeline deal, any stage
  const [allClients, setAllClients] = useState([]);   // clients table rows
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
  const [editingProjectName, setEditingProjectName] = useState(false); // click-to-edit project title
  const [showImporter, setShowImporter]     = useState(false);
  const [newTaskMs, setNewTaskMs]           = useState(null);        // ms id for new task row
  const [newTaskTitle, setNewTaskTitle]     = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProj, setNewProj]               = useState({ name: '', client_name: '', contact_name: '', status: 'active', start_date: new Date().toISOString().slice(0, 10), end_date: '', description: '', source_deal_id: '' });
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
  const [taskCompleteEmail, setTaskCompleteEmail] = useState(null); // { task, project }
  const [meetingSummaryEmail, setMeetingSummaryEmail] = useState(null); // { meeting, savedTasks, project }
  const [sendingEmail, setSendingEmail]           = useState(false);
  const [emailSentFor, setEmailSentFor]           = useState(null); // task.id
  const [extraRecipients, setExtraRecipients]     = useState([]);   // [{ name, email }]
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [showShareModal, setShowShareModal]       = useState(false);
  const [projectCompany, setProjectCompany]       = useState(null);
  const [clientRecord, setClientRecord]           = useState(null); // clients row — canonical contacts list, shared with ClientsPage
  // Client contacts available in task assignment dropdowns (deduped against internal team)
  const clientTaskContacts = (clientRecord?.contacts || [])
    .filter(c => c.name?.trim() && !owners.some(o => o.toLowerCase() === c.name.trim().toLowerCase()))
    .map(c => c.name.trim())
    .filter((n, i, arr) => arr.indexOf(n) === i);
  const [addingContact, setAddingContact]         = useState(false);
  const [newContactDraft, setNewContactDraft]     = useState({ name: '', title: '', email: '' });
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [summaryOpen, setSummaryOpen]             = useState(false);
  const [summaryHovered, setSummaryHovered]       = useState(false);
  const [summaryDragOver, setSummaryDragOver]     = useState(false);
  const [summaryClearConfirm, setSummaryClearConfirm] = useState(false);
  const summaryTextareaRef                        = useRef(null);
  const generateFromActivityRef                   = useRef(null);
  const [expandedRejections, setExpandedRejections] = useState(new Set());
  const [expandedCoC, setExpandedCoC]               = useState(new Set()); // manual expand after approval
  const [expandedTranscripts, setExpandedTranscripts] = useState(new Set()); // meeting ids with full transcript open in mentions panel

  // Background thesis auto-refresh — fires after any add (file/link/note/meeting/task)
  // so the client's AI thesis stays current, mirroring the deal-card behavior.
  const autoRefreshingThesisRef = useRef(false);
  const triggerProjectThesisRefresh = (overrides = {}) => {
    if (!activeProject?.client_name || autoRefreshingThesisRef.current) return;
    autoRefreshingThesisRef.current = true;
    const detail = {
      projects: [activeProject],
      meetings,
      items: (projectNotes || []).map(n => ({ type: 'note', body: n.text })),
      files: projectFiles,
      ...overrides,
    };
    silentRefreshThesis(activeProject.client_name, detail, activeProject.client_id || null)
      .then(updated => { if (updated) setProjectCompany(prev => prev ? { ...prev, ...updated } : prev); })
      .catch(e => console.warn('[ProjectsPage] thesis auto-refresh failed:', e.message))
      .finally(() => { autoRefreshingThesisRef.current = false; });
  };
  const [transcriptHighlight, setTranscriptHighlight] = useState({});       // { meetingId: searchTerm } for per-meeting highlight phrase
  const [generatingResponse, setGeneratingResponse] = useState(null); // taskId
  const [resendEmail, setResendEmail]             = useState(null);   // { task, project }
  const [meetings, setMeetings]                   = useState([]);     // project meetings log
  const [meetingsExpanded, setMeetingsExpanded]   = useState(false);
  const [showTranscript, setShowTranscript]       = useState(null);   // meeting id
  const [expandedMeetings, setExpandedMeetings]   = useState(new Set()); // expanded meeting ids
  const [editingMeeting, setEditingMeeting]       = useState(null);   // meeting id being edited
  const [editMeetingDraft, setEditMeetingDraft]   = useState({});     // { title, meeting_date, summary }
  const [savingMeeting, setSavingMeeting]         = useState(false);
  // Action-item → Task push
  const [actionItemDraft, setActionItemDraft]     = useState(null); // { title, assigned_to, estimated_hours, milestone_id } | null
  const [pushingActionItem, setPushingActionItem] = useState(false);
  // Task mentions history panel
  const [mentionsPanel, setMentionsPanel]         = useState(null); // task | null
  // Suggested task updates from AI (from transcript import)
  const [pendingUpdates, setPendingUpdates]       = useState([]);   // [{ existing_task_title, field, suggested_value, reason, accepted }]
  const [nearDupeWarning, setNearDupeWarning]     = useState([]);   // task titles that may overlap
  // Structured project notes — stored as JSON array in internal_notes
  const [projectNotes, setProjectNotes]           = useState([]);     // [{ id, text, created_at }]
  const [addingNote, setAddingNote]               = useState(false);
  const [newNoteText, setNewNoteText]             = useState('');
  const [editingNoteId, setEditingNoteId]         = useState(null);
  const [editNoteText, setEditNoteText]           = useState('');
  const [showTranscriptImporter, setShowTranscriptImporter] = useState(false);
  const [transcriptDefaultMs, setTranscriptDefaultMs]       = useState(null); // ms id for per-milestone entry
  const [meetingsInitialTranscript, setMeetingsInitialTranscript] = useState('');
  const [dragOverMeetingsTab, setDragOverMeetingsTab]        = useState(false);
  const [forecastPin, setForecastPin]       = useState('');
  const [forecastUnlocked, setForecastUnlocked] = useState(false);
  const [forecastPinInput, setForecastPinInput] = useState('');
  const [forecastPinError, setForecastPinError] = useState(false);
  const [summaryError, setSummaryError]           = useState(null);
  const [shareToken, setShareToken]               = useState('');
  const [sharePassword, setSharePassword]         = useState('');
  const [shareClientEmail, setShareClientEmail]   = useState('');
  const [shareSaving, setShareSaving]             = useState(false);
  const [shareSaved, setShareSaved]               = useState(false);
  const [shareCopied, setShareCopied]             = useState(false);
  const [portalEmailDraft, setPortalEmailDraft]   = useState(null); // { to, subject, body, htmlBody, gmailUrl }
  const [portalShareLog, setPortalShareLog]       = useState([]);   // [{ email, sharedAt }]
  const [editingTask, setEditingTask]             = useState(null); // task id
  const [editTaskDraft, setEditTaskDraft]         = useState({});   // { title, due_date, assigned_to, estimated_hours }
  const editTaskDraftRef                          = useRef({});     // always-current mirror of editTaskDraft (avoids stale closures)
  const setEditDraft = (updater) => {
    // Update ref synchronously so save callbacks always read the latest value
    editTaskDraftRef.current = typeof updater === 'function' ? updater(editTaskDraftRef.current) : updater;
    setEditTaskDraft(editTaskDraftRef.current);
  };
  const [showEstimate, setShowEstimate]           = useState(false);
  const [proposalPanel, setProposalPanel]         = useState(null); // { task } | null

  // Deal-context tabs state
  const [projectTab, setProjectTab]               = useState('timeline');
  const [dealActivities, setDealActivities]       = useState([]);
  const [dealTasks, setDealTasks]                 = useState([]);
  const [dealCompanyIntel, setDealCompanyIntel]   = useState(null);
  const [addingDealAct, setAddingDealAct]         = useState(false);
  const [dealActForm, setDealActForm]             = useState({ type: 'call', summary: '', activity_date: new Date().toISOString().slice(0,10), assigned_to: 'Mike' });
  const [savingDealAct, setSavingDealAct]         = useState(false);

  // File state
  const [projectFiles, setProjectFiles]         = useState([]);
  const [archivedFiles, setArchivedFiles]       = useState([]);
  const [archivedFilesOpen, setArchivedFilesOpen] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(null); // file id
  const [cardFiles, setCardFiles]               = useState({});   // { projectId: files[] } for list view
  const [uploadingFor, setUploadingFor]         = useState(null);
  const [dragOverTask, setDragOverTask]         = useState(null); // taskId being hovered over
  const [draggedTaskId, setDraggedTaskId]       = useState(null); // task currently being dragged between milestones
  const [dragOverMsId, setDragOverMsId]         = useState(null); // milestone id (or '__unassigned__') being dragged over
  const [dragOverFilesZone, setDragOverFilesZone] = useState(false);
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
      const [ps, deals, clientsList] = await Promise.all([fetchProjects(), fetchDeals(), fetchClients()]);
      setProjects(ps);
      setAllDeals(deals);
      setAllClients(clientsList);
      const taskMap = {};
      const fileMap = {};
      await Promise.all(ps.map(async p => {
        const [tasks, milestones, files] = await Promise.all([
          fetchProjectTasks(p.id),
          fetchMilestones(p.id),
          fetchProjectFiles(p.id),
        ]);
        // Apply the same active-milestone filter used in openProject so the
        // card progress bar ignores tasks that belong to archived milestones
        const activeMsIds = new Set(milestones.map(m => m.id));
        taskMap[p.id] = tasks.filter(t => !t.milestone_id || activeMsIds.has(t.milestone_id));
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
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'forecast_pin').single()
      .then(({ data }) => setForecastPin(data?.value || ''));
  }, []);

  // Auto-expand chain of custody for any task with an open rejection
  useEffect(() => {
    const rejectedIds = tasks.filter(t => t.rejected_at).map(t => t.id);
    if (rejectedIds.length) {
      setExpandedRejections(prev => {
        const next = new Set(prev);
        rejectedIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [tasks]);

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
    setSummaryOpen(false);
    setSummaryHovered(false);
    setForecastUnlocked(false);
    setForecastPinInput('');
    setForecastPinError(false);
    setProjectOwnerFilter('');
    setProposalPanel(null);
    setDeletedTasks({});
    setShowArchivedMs({});
    setArchivedMilestones([]);
    setShowArchivedMilestones(false);
    setEditingMeeting(null);
    setEditMeetingDraft({});
    setExpandedMeetings(new Set());
    setNearDupeWarning([]);
    setPendingUpdates([]);
    setAddingNote(false);
    setNewNoteText('');
    setEditingNoteId(null);
    setEditNoteText('');
    // Parse structured notes from internal_notes JSON (or wrap legacy plain text)
    try {
      const raw = project.internal_notes;
      if (!raw) { setProjectNotes([]); }
      else if (raw.trim().startsWith('[')) { setProjectNotes(JSON.parse(raw)); }
      else { setProjectNotes([{ id: crypto.randomUUID(), text: raw, created_at: new Date().toISOString() }]); }
    } catch { setProjectNotes([]); }
    setMilestones([]);
    setTasks([]);
    setProjectFiles([]);
    setArchivedFiles([]);
    setArchivedFilesOpen(false);
    setConfirmDeleteFile(null);
    setMeetings([]);
    setMeetingsExpanded(false);
    setShowTranscript(null);
    setProjectTab('timeline');
    setDealActivities([]);
    setDealTasks([]);
    setDealCompanyIntel(null);
    setAddingDealAct(false);
    setShareToken(project.share_token || '');
    setSharePassword(project.portal_password || '');
    setShareClientEmail(project.client_email || '');
    setProjectCompany(null);
    setClientRecord(null);
    setAddingContact(false);
    // Load matching company by client_name
    if (project.client_name) {
      supabase.from('companies').select('*').ilike('name', project.client_name).limit(1).then(({ data }) => {
        if (data?.[0]) setProjectCompany(data[0]);
      });
      // Resolve (or create) the clients row — same canonical contacts list ContactsPanel uses on ClientsPage
      findOrCreateClient(project.client_name).then(setClientRecord).catch(() => setClientRecord(null));
    }
    try {
      const [ms, ts, files, archivedF, mtgs] = await Promise.all([
        fetchMilestones(project.id),
        fetchProjectTasks(project.id),
        fetchProjectFiles(project.id).catch(() => []),
        fetchArchivedProjectFiles(project.id).catch(() => []),
        fetchProjectMeetings(project.id).catch(() => []),
      ]);
      // Fix milestone statuses: if any task has an open rejection, milestone
      // should be in_progress regardless of what's stored in the DB.
      // Only keep tasks whose milestone is still active (not archived).
      // Tasks for archived milestones are left in DB but hidden from the UI
      // so the progress bar doesn't count them.
      const activeMsIds = new Set(ms.map(m => m.id));
      const visibleTs = ts.filter(t => !t.milestone_id || activeMsIds.has(t.milestone_id));

      const rejectedMsIds = new Set(visibleTs.filter(t => t.rejected_at).map(t => t.milestone_id).filter(Boolean));
      const fixedMs = rejectedMsIds.size > 0
        ? ms.map(m => rejectedMsIds.has(m.id) && m.status === 'completed' ? { ...m, status: 'in_progress' } : m)
        : ms;
      setMilestones(fixedMs);
      setTasks(visibleTs);
      setAllTasks(prev => ({ ...prev, [project.id]: visibleTs }));
      setProjectFiles(files);
      setArchivedFiles(archivedF);
      setMeetings(mtgs);
      // Load deal context if linked
      if (project.source_deal_id) {
        Promise.all([
          fetchActivities(project.source_deal_id),
          fetchTasks(project.source_deal_id),
        ]).then(([acts, tsks]) => {
          setDealActivities(acts || []);
          setDealTasks(tsks || []);
        }).catch(() => {});
      }
      // Load company intel by name (works with or without source_deal_id)
      if (project.client_name) {
        fetchCompanyIntel(project.client_name).then(intel => {
          if (intel) setDealCompanyIntel(intel);
        }).catch(() => {});
      }
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

  // Deep-link: open a specific project when targetProjectId is set — fire once per id
  useEffect(() => {
    if (!targetProjectId || !projects.length) return;
    if (consumedProjectIdRef.current === targetProjectId) return; // already handled
    const proj = projects.find(p => p.id === targetProjectId);
    if (proj) {
      consumedProjectIdRef.current = targetProjectId;
      openProject(proj);
      onTargetProjectConsumed?.();
    }
  }, [targetProjectId, projects]);

  const refreshDetail = async (projId) => {
    try {
      const [ms, ts, files] = await Promise.all([
        fetchMilestones(projId),
        fetchProjectTasks(projId),
        fetchProjectFiles(projId).catch(() => []),
      ]);
      const activeMsIds = new Set(ms.map(m => m.id));
      const visibleTs = ts.filter(t => !t.milestone_id || activeMsIds.has(t.milestone_id));
      setMilestones(ms);
      setTasks(visibleTs);
      setProjectFiles(files);
      setAllTasks(prev => ({ ...prev, [projId]: visibleTs }));
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
      setNewProj({ name: '', client_name: '', contact_name: '', status: 'active', start_date: new Date().toISOString().slice(0, 10), end_date: '', description: '', source_deal_id: '' });
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

  // ── Structured project notes ──────────────────────────────────────────────
  const saveNotes = async (notes) => {
    const updated = { ...activeProject, internal_notes: JSON.stringify(notes) };
    setActiveProject(updated);
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
    await upsertProject(updated);
  };
  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;
    const note = { id: crypto.randomUUID(), text: newNoteText.trim(), created_at: new Date().toISOString() };
    const updated = [note, ...projectNotes];
    setProjectNotes(updated);
    setNewNoteText('');
    setAddingNote(false);
    await saveNotes(updated);
    triggerProjectThesisRefresh({ items: updated.map(n => ({ type: 'note', body: n.text })) });
  };
  const handleSaveNoteEdit = async (id) => {
    if (!editNoteText.trim()) return;
    const updated = projectNotes.map(n => n.id === id ? { ...n, text: editNoteText.trim(), updated_at: new Date().toISOString() } : n);
    setProjectNotes(updated);
    setEditingNoteId(null);
    await saveNotes(updated);
    triggerProjectThesisRefresh({ items: updated.map(n => ({ type: 'note', body: n.text })) });
  };
  const handleDeleteNote = async (id) => {
    const updated = projectNotes.filter(n => n.id !== id);
    setProjectNotes(updated);
    await saveNotes(updated);
  };

  // ── Meeting edit ──────────────────────────────────────────────────────────
  const handleSaveMeeting = async () => {
    if (!editingMeeting) return;
    setSavingMeeting(true);
    try {
      const { error } = await supabase.from('project_meetings')
        .update({ ...editMeetingDraft, updated_at: new Date().toISOString() })
        .eq('id', editingMeeting);
      if (error) throw new Error(error.message);
      const updatedMeetings = meetings.map(m => m.id === editingMeeting ? { ...m, ...editMeetingDraft } : m);
      setMeetings(updatedMeetings);
      setEditingMeeting(null);
      triggerProjectThesisRefresh({ meetings: updatedMeetings });
    } catch (e) {
      alert('Error saving meeting: ' + e.message);
    } finally {
      setSavingMeeting(false);
    }
  };

  // ── Project contacts ──────────────────────────────────────────────────────
  const handleSelectContact = async (e) => {
    const val = e.target.value;
    if (!val) return;
    e.target.value = '';
    let picked;
    try { picked = JSON.parse(val); } catch { return; }
    if (!picked?.name || !clientRecord?.id) return;
    const already = (clientRecord.contacts || []).some(c => c.name?.toLowerCase() === picked.name.toLowerCase());
    if (already) return;
    const updated = await upsertClientContacts(clientRecord.id, [{ name: picked.name, title: picked.title || '', email: picked.email || '', source: 'manual' }]);
    setClientRecord(cr => cr ? { ...cr, contacts: updated } : cr);
  };

  const handleAddNewContact = async () => {
    if (!newContactDraft.name.trim() || !clientRecord?.id) return;
    const updated = await upsertClientContacts(clientRecord.id, [{ ...newContactDraft, source: 'manual' }]);
    setClientRecord(cr => cr ? { ...cr, contacts: updated } : cr);
    // Also persist to company card if one is linked
    if (projectCompany) {
      const updatedCompanyContacts = [...(projectCompany.contacts || []), { ...newContactDraft }];
      await supabase.from('companies').update({ contacts: updatedCompanyContacts }).eq('id', projectCompany.id);
      setProjectCompany(prev => ({ ...prev, contacts: updatedCompanyContacts }));
    }
    setNewContactDraft({ name: '', title: '', email: '' });
    setAddingContact(false);
  };

  // ── AI summary from proposal ─────────────────────────────────────────────
  const handleGenerateSummary = async () => {
    if (!activeProject.proposal_text) return;
    setSummaryGenerating(true);
    setSummaryError(null);
    try {
      const summary = await generateProjectSummary(activeProject.proposal_text);
      const proj = { ...activeProject, description: summary };
      setActiveProject(proj);
      setProjects(prev => prev.map(p => p.id === proj.id ? proj : p));
      await upsertProject(proj);
    } catch (e) {
      setSummaryError(e.message || 'Failed to generate summary');
    } finally {
      setSummaryGenerating(false);
    }
  };

  const handleGenerateSummaryFromActivity = async () => {
    setSummaryGenerating(true);
    setSummaryError(null);
    try {
      const summary = await generateSummaryFromActivity({
        projectName: activeProject.name || 'this project',
        milestones,
        tasks,
        meetings,
        files: projectFiles,
      });
      const proj = { ...activeProject, description: summary };
      setActiveProject(proj);
      setProjects(prev => prev.map(p => p.id === proj.id ? proj : p));
      await upsertProject(proj);
    } catch (e) {
      setSummaryError(e.message || 'Failed to generate summary');
    } finally {
      setSummaryGenerating(false);
    }
  };

  const handleDropProposalOnSummary = async (e) => {
    e.preventDefault();
    setSummaryDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setSummaryGenerating(true);
    setSummaryError(null);
    try {
      let proposalText = '';
      if (file.type === 'application/pdf') {
        const b64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = ev => res(ev.target.result.split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const { text } = await extractPdfTextAndPages(b64);
        proposalText = text || '';
      } else {
        proposalText = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = ev => res(ev.target.result);
          reader.onerror = rej;
          reader.readAsText(file);
        });
      }
      if (!proposalText.trim()) throw new Error('Could not extract text from file');
      const withProposal = { ...activeProject, proposal_text: proposalText };
      setActiveProject(withProposal);
      await upsertProject(withProposal);
      const summary = await generateProjectSummary(proposalText);
      const final = { ...withProposal, description: summary };
      setActiveProject(final);
      setProjects(prev => prev.map(p => p.id === final.id ? final : p));
      await upsertProject(final);
    } catch (e) {
      setSummaryError(e.message || 'Failed to process proposal');
    } finally {
      setSummaryGenerating(false);
    }
  };

  // Keep ref current so midnight timer always calls latest version
  generateFromActivityRef.current = handleGenerateSummaryFromActivity;

  // ── Midnight auto-refresh of project summary ──────────────────────────────
  useEffect(() => {
    if (view !== 'detail' || !activeProject?.id) return;
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const t = setTimeout(() => generateFromActivityRef.current?.(), midnight - now);
    return () => clearTimeout(t);
  }, [activeProject?.id, view]);

  // ── Auto-size summary textarea ────────────────────────────────────────────
  useEffect(() => {
    if (!summaryTextareaRef.current || !summaryOpen) return;
    const el = summaryTextareaRef.current;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [activeProject?.description, summaryOpen]);

  // Auto-open note input when switching to Meetings tab
  useEffect(() => {
    if (projectTab === 'activity') {
      setAddingNote(true);
      setNewNoteText('');
    }
  }, [projectTab]);

  // ── Pre-fill portal email from primary contact when modal opens ──────────
  useEffect(() => {
    if (!showShareModal) return;
    if (shareClientEmail) return; // already set (saved value)
    const primary = (clientRecord?.contacts || []).find(c => c.is_primary) || (clientRecord?.contacts || [])[0];
    if (primary?.email) setShareClientEmail(primary.email);
  }, [showShareModal, clientRecord]);

  // ── Load portal share log when modal opens ────────────────────────────────
  useEffect(() => {
    if (!showShareModal || !activeProject?.id) return;
    supabase.from('app_settings').select('value').eq('key', `portal_shares_${activeProject.id}`).single()
      .then(({ data }) => setPortalShareLog(data?.value ? JSON.parse(data.value) : []))
      .catch(() => setPortalShareLog([]));
  }, [showShareModal, activeProject?.id]);

  // ── Save share / portal settings ─────────────────────────────────────────
  const handleSaveShare = async () => {
    setShareSaving(true);
    try {
      const token = shareToken || crypto.randomUUID().replace(/-/g, '');
      if (!shareToken) setShareToken(token);
      const updated = { ...activeProject, share_token: token, portal_password: sharePassword || null, client_email: shareClientEmail || null };
      await upsertProject(updated);
      setActiveProject(updated);
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
      setShareSaved(true);
      setTimeout(() => setShareSaved(false), 2500);

      if (shareClientEmail) {
        const newEntry = { email: shareClientEmail, sharedAt: new Date().toISOString() };
        const updatedLog = [...portalShareLog, newEntry];
        setPortalShareLog(updatedLog);
        supabase.from('app_settings').upsert({ key: `portal_shares_${updated.id}`, value: JSON.stringify(updatedLog) }, { onConflict: 'key' }).catch(() => {});
      }

      if (shareClientEmail) {
        const portalUrl = `${window.location.origin}/portal/${token}`;
        const contactName = (clientRecord?.contacts || []).find(c => c.email === shareClientEmail)?.name || '';
        const firstName = contactName ? contactName.split(' ')[0] : 'there';
        const companyLabel = updated.client_name || updated.name;
        const subject = `Your project portal — ${updated.name}`;
        const passwordLine = sharePassword ? `\nUse the password "${sharePassword}" to access your portal.` : '';
        const body = `Hi ${firstName},\n\nYour client portal for ${updated.name} is ready. You can view your project timeline, milestones, tasks, and files at the link below.${passwordLine}\n\nBest,\nPart Human`;
        const htmlBody = [
          `<p style="font-family:sans-serif;font-size:14px;">Hi ${firstName},</p>`,
          `<p style="font-family:sans-serif;font-size:14px;">Your client portal for <strong>${updated.name}</strong> is ready. You can view your project timeline, milestones, tasks, and files at the link below.</p>`,
          `<p><a href="${portalUrl}" style="display:inline-flex;align-items:center;gap:6px;background:#fbbf24;color:#111;font-weight:800;font-size:12px;padding:5px 12px;border-radius:20px;text-decoration:none;"><span style="font-weight:900;font-size:13px;">PH</span><span>×</span><span>${companyLabel}</span></a></p>`,
          sharePassword ? `<p style="font-family:sans-serif;font-size:14px;">Use the password <strong>${sharePassword}</strong> to access your portal.</p>` : '',
          `<p style="font-family:sans-serif;font-size:14px;">Best,<br/>Part Human</p>`,
        ].join('');
        const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(shareClientEmail)}&su=${encodeURIComponent(subject)}`;
        setPortalEmailDraft({ to: shareClientEmail, contactName, subject, body, htmlBody, gmailUrl });
      }
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setShareSaving(false); }
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
    const prevMs = milestones.find(m => m.id === ms.id);
    const saved = await upsertMilestone(ms);
    setMilestones(prev => prev.map(m => m.id === saved.id ? saved : m));
    setEditingMs(null);
    // Notify client if milestone just became complete
    if (saved.status === 'completed' && prevMs?.status !== 'completed' && activeProject?.client_email) {
      sendPortalNotification(
        activeProject.client_email,
        `Phase complete: ${saved.title}`,
        `<p>Hi,</p><p>The phase <strong>${saved.title}</strong> has been marked complete on your project <strong>${activeProject.name}</strong>.</p><p>View your project portal to review and approve this phase.</p>`,
      ).catch(e => console.warn('Milestone notify failed:', e.message));
    }
  };

  const handleArchiveMilestone = async (ms) => {
    await archiveMilestone(ms.id);
    setMilestones(prev => prev.filter(m => m.id !== ms.id));
    setArchivedMilestones(prev => [{ ...ms, archived_at: new Date().toISOString() }, ...prev]);
    setShowArchivedMilestones(true);
    // Remove the milestone's tasks from state so progress bar stays accurate
    setTasks(prev => prev.filter(t => t.milestone_id !== ms.id));
    setAllTasks(prev => ({
      ...prev,
      [activeProject.id]: (prev[activeProject.id] || []).filter(t => t.milestone_id !== ms.id),
    }));
  };

  const handleRestoreMilestone = async (ms) => {
    await restoreMilestone(ms.id);
    setArchivedMilestones(prev => prev.filter(m => m.id !== ms.id));
    // Re-fetch both milestones and tasks so restored milestone's tasks come back
    const [fresh, freshTasks] = await Promise.all([
      fetchMilestones(activeProject.id),
      fetchProjectTasks(activeProject.id),
    ]);
    // Filter tasks to only those whose milestone is active (same guard as loadProjectDetail)
    const activeMsIds = new Set(fresh.map(m => m.id));
    const visibleTasks = freshTasks.filter(t => !t.milestone_id || activeMsIds.has(t.milestone_id));
    setMilestones(fresh);
    setTasks(visibleTasks);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: visibleTasks }));
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
    // Also purge from allTasks so the project card progress bar stays accurate
    setAllTasks(prev => ({
      ...prev,
      [activeProject.id]: (prev[activeProject.id] || []).filter(t => t.id !== task.id),
    }));
    setTasks(prev => prev.filter(t => t.id !== task.id));
    setConfirmHardDelete(null);
  };

  const handleHardDeleteMilestone = async (ms) => {
    await deleteMilestone(ms.id);
    setArchivedMilestones(prev => prev.filter(m => m.id !== ms.id));
    setConfirmHardDelete(null);
    // Remove the milestone's tasks from state (DB cascade removes them too)
    setTasks(prev => prev.filter(t => t.milestone_id !== ms.id));
    setAllTasks(prev => ({
      ...prev,
      [activeProject.id]: (prev[activeProject.id] || []).filter(t => t.milestone_id !== ms.id),
    }));
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

  // ── Scroll-stable milestone toggle ───────────────────────────────────────
  // Capture the clicked header's viewport position before the state flip, then
  // after React commits + the browser paints, scroll back by the difference so
  // the header stays exactly where the user clicked it.
  const handleToggleMilestone = useCallback((e, msId) => {
    const el = e.currentTarget;
    const prevTop = el.getBoundingClientRect().top;
    setExpanded(prev => ({ ...prev, [msId]: !prev[msId] }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const delta = el.getBoundingClientRect().top - prevTop;
      if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' });
    }));
  }, []);

  // Auto-update milestone status based on task completion:
  //   any rejected (open change request) → in_progress
  //   0 done       → not_started
  //   some done    → in_progress
  //   all done (no rejections) → completed
  const syncMilestoneStatus = async (milestoneId, allProjectTasks) => {
    const msTasks = allProjectTasks.filter(t => t.milestone_id === milestoneId);
    if (!msTasks.length) return;
    const hasRejected = msTasks.some(t => t.rejected_at);
    const doneCount   = msTasks.filter(t => t.completed && !t.rejected_at).length;
    const newStatus   = hasRejected || doneCount < msTasks.length
                        ? (doneCount > 0 || hasRejected ? 'in_progress' : 'not_started')
                        : 'completed';
    const ms = milestones.find(m => m.id === milestoneId);
    if (!ms || ms.status === newStatus) return;
    const newMs = { ...ms, status: newStatus };
    await upsertMilestone(newMs);
    setMilestones(prev => prev.map(m => m.id === milestoneId ? newMs : m));
  };

  const handleToggleTask = async (task) => {
    const nowComplete = !task.completed;
    try {
      await toggleTask(task.id, nowComplete);
    } catch (e) {
      console.error('toggleTask failed:', e);
    }
    const patch = t => t.id === task.id ? {
      ...t, completed: nowComplete,
      ...(nowComplete ? {} : { approved_at: null, approved_by: null, rejected_at: null, rejected_by: null, rejection_notes: null, rejection_response: null }),
    } : t;
    const updated = tasks.map(patch);
    setTasks(updated);
    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
    setAssignedTasks(prev => prev.map(patch));
    if (task.milestone_id) await syncMilestoneStatus(task.milestone_id, updated);
    if (nowComplete) {
      // If no client portal or no contact email, auto-approve internally — no review needed
      const primaryContact = (activeProject.contacts || []).find(c => c.is_primary) || (activeProject.contacts || [])[0];
      const toEmail = primaryContact?.email || activeProject.client_email || '';
      if (!activeProject.share_token || !toEmail) {
        try {
          await approveTask(task.id, 'Internal');
          const now = new Date().toISOString();
          const approvePatch = t => t.id === task.id ? { ...t, approved_at: now, approved_by: 'Internal' } : t;
          setTasks(prev => prev.map(approvePatch));
          setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(approvePatch) }));
          setAssignedTasks(prev => prev.map(approvePatch));
        } catch (e) { console.error('Auto-approve failed:', e); }
      }
      // If portal + email exist, the inline "Notify client" button on the task row handles next step
    }
  };

  const handleGenerateResponse = async (task) => {
    setGeneratingResponse(task.id);
    try {
      const projectName = activeProject?.name || task._project?.name || '';
      const response = await generateRejectionResponse(task.title, projectName, task.rejection_notes);
      await saveRejectionResponse(task.id, response);
      const patch = t => t.id === task.id ? { ...t, rejection_response: response } : t;
      setTasks(prev => prev.map(patch));
      setAllTasks(prev => {
        const pid = activeProject?.id;
        if (!pid) return prev;
        return { ...prev, [pid]: (prev[pid] || []).map(patch) };
      });
      setAssignedTasks(prev => prev.map(patch));
      return response;
    } catch (e) {
      console.error('Generate response failed:', e.message);
    } finally {
      setGeneratingResponse(null);
    }
  };

  // Opens Send Revision modal and always regenerates AI response from the
  // latest rejection notes so stale responses from prior cycles are never reused.
  const openResendModal = async (task, project, milestone = null) => {
    setExtraRecipients([]);
    setResendEmail({ task, project, ms: milestone });
    // Get the latest rejection notes — prefer the flat field, fall back to
    // the most recent 'rejected' event in the chain (in case flat field was cleared).
    const latestNotes = task.rejection_notes
      || [...(task.review_chain || [])].reverse().find(e => e.type === 'rejected')?.notes
      || '';
    if (!latestNotes) return;
    setGeneratingResponse(task.id);
    try {
      const projectName = project?.name || '';
      const response = await generateRejectionResponse(task.title, projectName, latestNotes);
      await saveRejectionResponse(task.id, response);
      const patch = t => t.id === task.id ? { ...t, rejection_response: response } : t;
      setTasks(prev => prev.map(patch));
      setAllTasks(prev => {
        const pid = project?.id;
        if (!pid) return prev;
        return { ...prev, [pid]: (prev[pid] || []).map(patch) };
      });
      setAssignedTasks(prev => prev.map(patch));
      // Update the modal's task reference so the email body reflects the fresh response
      setResendEmail({ task: { ...task, rejection_response: response, rejection_notes: latestNotes }, project, ms: milestone });
    } catch (e) {
      console.error('Auto-generate response failed:', e.message);
    } finally {
      setGeneratingResponse(null);
    }
  };

  // Returns existing tasks whose titles are ≥50% word-overlap with newTitle.
  // Ignores short filler words (< 3 chars) so "and", "the", "a" don't drive matches.
  const findSimilarTasks = (newTitle, existingTasks = tasks) => {
    const sig = str => str.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 3);
    const newWords = new Set(sig(newTitle));
    if (newWords.size === 0) return [];
    return existingTasks.filter(t => {
      if (!t.title || t.title.toLowerCase().trim() === newTitle.toLowerCase().trim()) return false;
      const exWords = sig(t.title);
      const overlap = exWords.filter(w => newWords.has(w)).length;
      const minLen = Math.min(newWords.size, exWords.length);
      return minLen > 0 && overlap / minLen >= 0.5;
    });
  };

  const handleAddTask = async (milestoneId) => {
    if (!newTaskTitle.trim()) return;
    const similar = findSimilarTasks(newTaskTitle.trim());
    if (similar.length > 0) {
      const names = similar.map(t => `• ${t.title}`).join('\n');
      const ok = window.confirm(
        `This task looks similar to ${similar.length} existing task${similar.length > 1 ? 's' : ''}:\n\n${names}\n\nAdd it anyway?`
      );
      if (!ok) return;
    }
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

  // Drag-and-drop a task between milestones (or into/out of Unassigned Tasks).
  // newMilestoneId is null to unassign.
  const handleMoveTaskToMilestone = async (taskId, newMilestoneId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || (task.milestone_id || null) === (newMilestoneId || null)) return;
    const updated = { ...task, milestone_id: newMilestoneId };
    setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
    setAllTasks(prev => ({
      ...prev,
      [activeProject.id]: (prev[activeProject.id] || []).map(t => t.id === taskId ? updated : t),
    }));
    if (newMilestoneId) setExpanded(prev => ({ ...prev, [newMilestoneId]: true }));
    try {
      await upsertProjectTask(updated);
    } catch (e) {
      console.error('Failed to move task:', e.message);
      // Roll back on failure
      setTasks(prev => prev.map(t => t.id === taskId ? task : t));
      setAllTasks(prev => ({
        ...prev,
        [activeProject.id]: (prev[activeProject.id] || []).map(t => t.id === taskId ? task : t),
      }));
    }
  };

  const handleDeleteTask = async (id) => {
    const task = tasks.find(t => t.id === id);
    // Optimistically remove from UI immediately so the row disappears on click
    setTasks(prev => prev.filter(t => t.id !== id));
    setAllTasks(prev => ({
      ...prev,
      [activeProject.id]: (prev[activeProject.id] || []).filter(t => t.id !== id),
    }));
    try {
      await deleteProjectTask(id);
      // Re-fetch from DB to guarantee the timeline reflects the actual DB state
      // (handles both soft-delete and hard-delete fallback paths).
      // Apply the same activeMsIds filter used at load time so archived-milestone
      // tasks don't sneak back into state.
      const updated = await fetchProjectTasks(activeProject.id);
      const activeMsIds = new Set(milestones.map(m => m.id));
      const visibleUpdated = updated.filter(t => !t.milestone_id || activeMsIds.has(t.milestone_id));
      setTasks(visibleUpdated);
      setAllTasks(prev => ({ ...prev, [activeProject.id]: visibleUpdated }));
      // Stash for in-session restore
      if (task) {
        setDeletedTasks(prev => ({
          ...prev,
          [task.milestone_id]: [{ ...task, deleted_at: new Date().toISOString() }, ...(prev[task.milestone_id] || [])],
        }));
      }
    } catch (e) {
      // Restore the task in state if the DB delete failed
      setTasks(prev => {
        if (prev.some(t => t.id === id)) return prev; // already there
        return task ? [...prev, task].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)) : prev;
      });
      setAllTasks(prev => {
        const list = prev[activeProject.id] || [];
        if (list.some(t => t.id === id)) return prev;
        return { ...prev, [activeProject.id]: task ? [...list, task].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)) : list };
      });
      alert(`Could not delete task: ${e.message}`);
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
    setEditDraft({ title: task.title, due_date: task.due_date || '', assigned_to: task.assigned_to || '', estimated_hours: task.estimated_hours ?? '' });
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
    const draft = { ...editTaskDraftRef.current, ...overrides };
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
    const nowComplete = !task.completed;
    await toggleTask(task.id, nowComplete);
    const patch = t => t.id === task.id ? {
      ...t, completed: nowComplete,
      completed_at: nowComplete ? new Date().toISOString() : null,
      ...(nowComplete ? {} : { approved_at: null, approved_by: null, rejected_at: null, rejected_by: null, rejection_notes: null, rejection_response: null }),
    } : t;
    setAssignedTasks(prev => prev.map(patch));
    if (task.project_id) {
      setAllTasks(prev => ({
        ...prev,
        [task.project_id]: (prev[task.project_id] || []).map(patch),
      }));
    }
    if (task.milestone_id && task.project_id) {
      const projectTasks = (allTasks[task.project_id] || []).map(patch);
      await syncMilestoneStatus(task.milestone_id, projectTasks);
    }
  };

  const handleSaveAssignedTaskEdit = async (task, overrides = {}) => {
    const draft = { ...editTaskDraftRef.current, ...overrides };
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
  const handleImported = async ({ startDate, projectName, budget: importedBudget, milestones: msParsed, proposalText, proposalPdfFile, proposalPageHints, gdocUrl, gdocName }, fromProjectId) => {
    const projectId = fromProjectId || activeProject?.id;
    const baseProj  = projects.find(p => p.id === projectId) || activeProject;
    const fromCard  = !!fromProjectId;
    try {
      const updatedProj = {
        ...baseProj,
        name:       baseProj.name || projectName || baseProj.name,
        start_date: startDate,
        // Pre-fill budget from proposal if not already set
        ...(importedBudget && !baseProj.budget ? { budget: importedBudget } : {}),
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

        // Track proposal in proposals array
        if (proposalText || proposalPdfFile) {
          const newProposalEntry = {
            id: crypto.randomUUID(),
            name: `Proposal — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
            created_at: new Date().toISOString(),
            text_excerpt: proposalText ? proposalText.slice(0, 120) + (proposalText.length > 120 ? '…' : '') : '',
            pdf_url: proposalUpdate.proposal_pdf_url || null,
            primary: !(savedProj.proposals?.length),
          };
          const existingProposals = savedProj.proposals || [];
          savedProj.proposals = [...existingProposals, newProposalEntry];
          try {
            await upsertProject({ id: savedProj.id, proposals: savedProj.proposals });
          } catch (e) {
            console.warn('Could not save proposals array (run migration 17):', e.message);
          }
        }
      } catch (proposalErr) {
        console.warn('Proposal reference not saved (run DB migrations):', proposalErr.message);
      }

      setProjects(prev => prev.map(p => p.id === savedProj.id ? savedProj : p));

      if (fromCard) {
        // Refresh card tasks
        const ts = await fetchProjectTasks(projectId);
        setAllTasks(prev => ({ ...prev, [projectId]: ts }));
        setShowImporter(false);
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
      if (fromCard) setShowImporter(false);
      else setShowImporter(false);
    }
  };

  // ── Transcript import ─────────────────────────────────────────────────────
  const handleTranscriptImported = async ({ meeting, tasks: newTasks, suggestedUpdates = [] }) => {
    setShowTranscriptImporter(false);
    setTranscriptDefaultMs(null);

    // Re-fetch meetings from DB so we always show what's actually saved
    try {
      const updatedMeetings = await fetchProjectMeetings(activeProject.id);
      setMeetings(updatedMeetings);
      if (updatedMeetings.length > 0) setMeetingsExpanded(true);
      triggerProjectThesisRefresh({ meetings: updatedMeetings });
    } catch {
      // Fallback to optimistic insert
      if (meeting) {
        const fallbackMeetings = [meeting, ...meetings];
        setMeetings(fallbackMeetings);
        setMeetingsExpanded(true);
        triggerProjectThesisRefresh({ meetings: fallbackMeetings });
      }
    }

    // Queue suggested updates for review (if any)
    if (suggestedUpdates.length > 0) {
      setPendingUpdates(suggestedUpdates.map(u => ({ ...u, accepted: true })));
    }

    if (!newTasks?.length) return;

    // Auto-create or find a milestone named after the meeting
    let meetingMilestoneId = null;
    if (meeting?.title) {
      const existing = milestones.find(m => m.title?.toLowerCase().trim() === meeting.title.toLowerCase().trim());
      if (existing) {
        meetingMilestoneId = existing.id;
      } else {
        try {
          const baseDate = meeting.meeting_date || new Date().toISOString().slice(0, 10);
          const dueDate  = new Date(baseDate + 'T12:00:00');
          dueDate.setDate(dueDate.getDate() + 14);
          const newMs = await upsertMilestone({
            project_id:  activeProject.id,
            title:       meeting.title,
            start_date:  baseDate,
            due_date:    dueDate.toISOString().slice(0, 10),
            status:      'in_progress',
            order_index: milestones.length,
            created_at:  new Date().toISOString(),
          });
          meetingMilestoneId = newMs.id;
          setMilestones(prev => [...prev, newMs]);
          setExpanded(prev => ({ ...prev, [newMs.id]: true }));
        } catch (e) {
          console.error('Failed to auto-create meeting milestone:', e.message);
        }
      }
    }

    // Insert tasks into DB — skip exact-title duplicates, warn on fuzzy near-dupes
    try {
      const existingTitles = new Set(tasks.map(t => t.title?.toLowerCase().trim()).filter(Boolean));
      const uniqueTasks = newTasks
        .filter(t => !existingTitles.has(t.title?.toLowerCase().trim()))
        .map(t => ({ ...t, milestone_id: meetingMilestoneId || t.milestone_id || null }));
      const skippedCount = newTasks.length - uniqueTasks.length;
      if (!uniqueTasks.length) {
        if (skippedCount > 0) alert(`All ${skippedCount} task${skippedCount !== 1 ? 's' : ''} from this meeting already exist — none added.`);
        return;
      }
      // Fuzzy check: flag any new tasks that are ≥50% word-overlap with an existing task
      // Single pass: compute similar matches once per task (avoids double findSimilarTasks call)
      const nearDupeResults = uniqueTasks
        .map(t => ({ t, similar: findSimilarTasks(t.title || '', tasks) }))
        .filter(r => r.similar.length > 0);
      const { data: inserted, error } = await supabase
        .from('project_tasks')
        .insert(uniqueTasks)
        .select();
      if (error) throw error;
      const savedTasks = inserted || uniqueTasks;
      if (nearDupeResults.length > 0) setNearDupeWarning(nearDupeResults.map(r => ({ newTitle: r.t.title, similar: r.similar.map(s => s.title) })));
      const parts = [];
      if (savedTasks.length) parts.push(`${savedTasks.length} task${savedTasks.length !== 1 ? 's' : ''} added`);
      if (skippedCount > 0) parts.push(`${skippedCount} exact duplicate${skippedCount !== 1 ? 's' : ''} skipped`);
      if (meetingMilestoneId && !milestones.find(m => m.id === meetingMilestoneId)) parts.push(`📋 New milestone created: "${meeting.title}"`);
      if (savedTasks.length) setMeetingSummaryEmail({ meeting, savedTasks, project: activeProject, importNote: parts.join(' · ') });
      setTasks(prev => [...prev, ...savedTasks]);
      setAllTasks(prev => ({
        ...prev,
        [activeProject.id]: [...(prev[activeProject.id] || []), ...savedTasks],
      }));
      // Auto-expand any milestones that received new tasks
      const newMsIds = new Set(savedTasks.map(t => t.milestone_id).filter(Boolean));
      if (newMsIds.size > 0) {
        setExpanded(prev => {
          const next = { ...prev };
          newMsIds.forEach(id => { next[id] = true; });
          return next;
        });
      }
    } catch (e) {
      alert('Failed to save tasks from transcript: ' + e.message);
    }
  };

  // ── Meetings tab drag-and-drop ────────────────────────────────────────────
  const handleDropOnMeetingsTab = async (e) => {
    e.preventDefault();
    setDragOverMeetingsTab(false);
    const file = e.dataTransfer?.files?.[0];
    let text = '';
    if (file) {
      if (file.type !== 'application/pdf') {
        text = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = ev => resolve(ev.target.result || '');
          reader.onerror = () => resolve('');
          reader.readAsText(file);
        });
      }
    } else {
      text = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text') || '';
    }
    setMeetingsInitialTranscript(text);
    setTranscriptDefaultMs(null);
    setShowTranscriptImporter(true);
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
        triggerProjectThesisRefresh({ files: [saved, ...projectFiles] });
      }
      setCardFiles(prev => ({ ...prev, [projectId]: [saved, ...(prev[projectId] || [])] }));
      // Notify client if email is set
      if (activeProject?.id === projectId && activeProject?.client_email) {
        sendPortalNotification(
          activeProject.client_email,
          `New file added: ${file.name}`,
          `<p>Hi,</p><p>A new file <strong>${file.name}</strong> has been added to your project <strong>${activeProject.name}</strong>.</p><p>Visit your project portal to view it.</p>`,
        ).catch(e => console.warn('File notify failed:', e.message));
      }
    } catch (err) {
      console.error('Upload failed:', err.message);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingFor(null);
    }
  };

  const handleDropOnTask = async (e, task) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTask(null);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    setUploadingFor(task.id);
    try {
      const saved = await Promise.all(
        files.map(f => uploadProjectFile(activeProject.id, f, task.milestone_id || null, task.id))
      );
      setProjectFiles(prev => [...saved, ...prev]);
      setCardFiles(prev => ({ ...prev, [activeProject.id]: [...saved, ...(prev[activeProject.id] || [])] }));
      triggerProjectThesisRefresh({ files: [...saved, ...projectFiles] });
    } catch (err) {
      console.error('Drop upload failed:', err.message);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingFor(null);
    }
  };

  const handleDropOnFilesZone = async (e) => {
    e.preventDefault();
    setDragOverFilesZone(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    setUploadingFor('__files_zone__');
    try {
      const saved = await Promise.all(
        files.map(f => uploadProjectFile(activeProject.id, f, null, null))
      );
      setProjectFiles(prev => [...saved, ...prev]);
      setCardFiles(prev => ({ ...prev, [activeProject.id]: [...saved, ...(prev[activeProject.id] || [])] }));
      triggerProjectThesisRefresh({ files: [...saved, ...projectFiles] });
    } catch (err) {
      console.error('Drop upload failed:', err.message);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingFor(null);
    }
  };

  const handleDeleteFile = async (file) => {
    await deleteProjectFile(file.id, file.storage_path);
    setProjectFiles(prev => prev.filter(f => f.id !== file.id));
    setArchivedFiles(prev => prev.filter(f => f.id !== file.id));
    setCardFiles(prev => ({
      ...prev,
      [file.project_id]: (prev[file.project_id] || []).filter(f => f.id !== file.id),
    }));
    setConfirmDeleteFile(null);
  };

  const handleArchiveFile = async (file) => {
    await archiveProjectFile(file.id);
    setProjectFiles(prev => prev.filter(f => f.id !== file.id));
    setArchivedFiles(prev => [{ ...file, archived_at: new Date().toISOString() }, ...prev]);
    setCardFiles(prev => ({
      ...prev,
      [file.project_id]: (prev[file.project_id] || []).filter(f => f.id !== file.id),
    }));
    setConfirmDeleteFile(null);
  };

  const handleRestoreFile = async (file) => {
    await restoreProjectFile(file.id);
    setArchivedFiles(prev => prev.filter(f => f.id !== file.id));
    setProjectFiles(prev => [{ ...file, archived_at: null }, ...prev]);
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
    if (activeProject?.id === projectId) triggerProjectThesisRefresh({ files: [saved, ...projectFiles] });
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeCount    = projects.filter(p => p.status === 'active').length;
  const completedCount = projects.filter(p => p.status === 'completed').length;
  const totalTasks     = Object.values(allTasks).flat();
  const doneTasks      = totalTasks.filter(t => t.completed).length;

  // Unified "client" picker for the New Project modal — any company from
  // Pipeline (deals, any stage), Clients, or existing Projects, deduped by name.
  const clientOptions = useMemo(() => {
    const map = new Map(); // lowercased name → option
    allDeals.forEach(d => {
      if (!d.company_name?.trim()) return;
      const key = d.company_name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { name: d.company_name.trim(), contact_name: d.contact_name || '', source_deal_id: d.id });
    });
    allClients.forEach(c => {
      if (!c.name?.trim()) return;
      const key = c.name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { name: c.name.trim(), contact_name: '', source_deal_id: '' });
    });
    projects.forEach(p => {
      if (!p.client_name?.trim()) return;
      const key = p.client_name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { name: p.client_name.trim(), contact_name: p.contact_name || '', source_deal_id: p.source_deal_id || '' });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allDeals, allClients, projects]);

  // Pre-compute per-task mention presence once (not on every row render).
  // Must be declared here — before any early returns — to satisfy Rules of Hooks.
  const taskMentionsMap = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      const tl = t.title?.toLowerCase() || '';
      if (!tl) return;
      map[t.id] = meetings.some(m =>
        [m.title, m.summary, m.transcript, ...(m.action_items || []).map(ai => ai.title)]
          .some(f => f?.toLowerCase().includes(tl))
      );
    });
    return map;
  }, [tasks, meetings]);

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
            const rejectedTasks  = assignedTasks.filter(t => t.completed && t.rejected_at);
            const activeTasks    = assignedTasks.filter(t => !t.completed);
            const completedTasks = assignedTasks.filter(t => t.completed && !t.rejected_at);
            const allSorted      = [...rejectedTasks, ...activeTasks, ...completedTasks];
            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {allSorted.map((task, idx) => {
                const isEditingThis  = editingTask === task.id;
                const pendingDelete  = confirmDeleteTask === task.id;
                const taskFiles      = assignedFiles[task.id] || [];
                const isOverdue      = !task.completed && task.due_date && task.due_date < today;
                const msColor2       = task._milestone ? msColor(task._milestone.status) : 'var(--border)';
                const isFirstDone      = task.completed && !task.rejected_at && (idx === 0 || !allSorted[idx - 1].completed || allSorted[idx - 1].rejected_at);
                const isFirstRejected  = task.rejected_at && (idx === 0 || !allSorted[idx - 1]?.rejected_at);
                const isFirstActive    = !task.completed && (idx === 0 || allSorted[idx - 1]?.rejected_at);

                return (
                  <div key={task.id}>
                  {isFirstRejected && rejectedTasks.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', background: '#fef2f2', borderBottom: '1px solid #fca5a5' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#ef4444' }}>🔴 Changes Requested · {rejectedTasks.length}</span>
                    </div>
                  )}
                  {isFirstActive && activeTasks.length > 0 && rejectedTasks.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>Active · {activeTasks.length}</span>
                    </div>
                  )}
                  {isFirstDone && activeTasks.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>Completed · {completedTasks.length}</span>
                    </div>
                  )}
                  <div
                    style={{
                      borderBottom: idx < allSorted.length - 1 && !(allSorted[idx + 1]?.completed && !task.completed) ? '1px solid var(--border-light)' : 'none',
                      background: task.rejected_at ? '#fff5f5' : task.completed ? 'var(--surface)' : 'var(--bg)',
                      borderLeft: task.rejected_at ? '3px solid #ef4444' : 'none',
                    }}
                  >
                    {isEditingThis ? (
                      <div
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 16px', alignItems: 'center', background: 'var(--bg)', borderLeft: '3px solid var(--accent)' }}
                        onBlur={e => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            const numInput = e.currentTarget.querySelector('input[type="number"]');
                            if (numInput) editTaskDraftRef.current = { ...editTaskDraftRef.current, estimated_hours: numInput.value };
                            handleSaveAssignedTaskEdit(task);
                            setEditingTask(null);
                          }
                        }}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editTaskDraft.title}
                          onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { handleSaveAssignedTaskEdit(task); setEditingTask(null); } if (e.key === 'Escape') setEditingTask(null); }}
                          style={{ flex: '1 1 180px', fontSize: 13, padding: '5px 10px', fontWeight: 600 }}
                          placeholder="Task title"
                        />
                        <div>
                          <Lbl>Due date</Lbl>
                          <input type="date" value={editTaskDraft.due_date} onChange={e => {
                            setEditDraft(d => ({ ...d, due_date: e.target.value }));
                          }} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
                        </div>
                        <div>
                          <Lbl>Assigned to</Lbl>
                          <select value={editTaskDraft.assigned_to} onChange={e => {
                            setEditDraft(d => ({ ...d, assigned_to: e.target.value }));
                          }} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}>
                            <option value="">—</option>
                            <optgroup label="Team">{owners.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>
                            {clientTaskContacts.length > 0 && <optgroup label="Client">{clientTaskContacts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
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
                            {task.rejected_at && (
                              <span style={{ fontSize: 10, fontWeight: 800, color: '#ef4444', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', letterSpacing: '.03em' }}>🔴 DUE NOW</span>
                            )}
                            <span
                              style={{ fontSize: 13, fontWeight: task.rejected_at ? 800 : 600, color: task.approved_at ? 'var(--text-faint)' : 'var(--text)', textDecoration: task.approved_at ? 'line-through' : 'none', textDecorationColor: '#ef4444', cursor: 'text' }}
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
                        {task.estimated_hours != null && task.estimated_hours !== '' && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', flexShrink: 0, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {task.estimated_hours}h
                          </span>
                        )}
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
                          onClick={() => { if (window.confirm('Delete this task?')) handleDeleteAssignedTask(task.id); }}
                          title="Delete task"
                          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                        >✕</button>
                      </div>
                    )}
                    {task.rejected_at && (
                      <div style={{ margin: '2px 16px 8px 41px' }}>
                        <button
                          onClick={() => setExpandedRejections(s => { const n = new Set(s); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; })}
                          style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        >{expandedRejections.has(task.id) ? '▲ Hide' : '▼ View'} client feedback</button>
                        {expandedRejections.has(task.id) && (
                          <div style={{ marginTop: 6, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>
                              From {task.rejected_by} · {fmtDate(task.rejected_at)}
                            </div>
                            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 10 }}>{task.rejection_notes}</div>
                            {task.rejection_response ? (
                              <>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Your response</div>
                                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{task.rejection_response}</div>
                                <button
                                  onClick={() => openResendModal(task, task._project)}
                                  style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                                >📬 Send revised update to client</button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleGenerateResponse(task)}
                                disabled={generatingResponse === task.id}
                                style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: generatingResponse === task.id ? 'var(--text-faint)' : 'var(--text)', cursor: generatingResponse === task.id ? 'default' : 'pointer' }}
                              >{generatingResponse === task.id ? '✦ Generating…' : '✦ Auto-generate response'}</button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {taskFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 16px 8px 41px' }}>
                        {taskFiles.map(f => (
                          <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border-light)', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                            <span>{fileIcon(f.mime_type)}</span>
                            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); if (window.confirm(`Delete "${f.name}"?`)) handleDeleteFile(f); }} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '0 0 0 2px', fontSize: 11 }}>✕</button>
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
              {clientOptions.length > 0 && (
                <div>
                  <Lbl>Client</Lbl>
                  <select
                    defaultValue=""
                    onChange={e => {
                      const opt = clientOptions.find(x => x.name === e.target.value);
                      if (opt) setNewProj(p => ({ ...p, client_name: opt.name, contact_name: opt.contact_name || '', source_deal_id: opt.source_deal_id || '' }));
                    }}
                  >
                    <option value="">Select client…</option>
                    {clientOptions.map(opt => <option key={opt.name} value={opt.name}>{opt.name}{opt.contact_name ? ` — ${opt.contact_name}` : ''}</option>)}
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

  // ── Unassigned task row — same look/feel as milestone task rows ──────────
  const renderUnassignedTaskRow = (task) => {
    const pendingDelete  = confirmDeleteTask === task.id;
    const isEditingThis  = editingTask === task.id;
    const hasOpenRejection = task.completed && task.rejected_at;
    const taskFiles      = projectFiles.filter(f => f.task_id === task.id);
    return (
      <div
        key={task.id}
        className="task-row"
        draggable
        onDragStart={e => { e.dataTransfer.setData('text/plain', task.id); setDraggedTaskId(task.id); }}
        onDragEnd={() => { setDraggedTaskId(null); setDragOverMsId(null); }}
        style={{
          borderBottom: '1px solid #fde68a',
          background: hasOpenRejection ? '#fffbeb' : 'var(--bg)',
          borderLeft:  hasOpenRejection ? '3px solid #f59e0b' : 'none',
          position: 'relative',
          cursor: 'grab',
        }}
      >
        {isEditingThis ? (
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 16px 10px 48px', alignItems: 'center', background: 'var(--bg)', borderLeft: '3px solid var(--accent)' }}
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                const numInput = e.currentTarget.querySelector('input[type="number"]');
                if (numInput) editTaskDraftRef.current = { ...editTaskDraftRef.current, estimated_hours: numInput.value };
                handleSaveTaskEdit(task);
                setEditingTask(null);
              }
            }}
          >
            <input type="text" autoFocus value={editTaskDraft.title} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { handleSaveTaskEdit(task); setEditingTask(null); } if (e.key === 'Escape') setEditingTask(null); }} style={{ flex: '1 1 180px', fontSize: 13, padding: '5px 10px', fontWeight: 600 }} placeholder="Task title" />
            <div><Lbl>Due date</Lbl><input type="date" value={editTaskDraft.due_date} onChange={e => setEditDraft(d => ({ ...d, due_date: e.target.value }))} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} /></div>
            <div><Lbl>Assigned to</Lbl><select value={editTaskDraft.assigned_to} onChange={e => setEditDraft(d => ({ ...d, assigned_to: e.target.value }))} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}><option value="">—</option><optgroup label="Team">{owners.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>{clientTaskContacts.length > 0 && <optgroup label="Client">{clientTaskContacts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}</select></div>
            <div><Lbl>Est. hrs</Lbl><input type="number" min="0" step="0.5" value={editTaskDraft.estimated_hours} onChange={e => setEditDraft(d => ({ ...d, estimated_hours: e.target.value }))} placeholder="—" style={{ fontSize: 12, padding: '4px 8px', width: 70 }} /></div>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button
                onMouseDown={e => { e.preventDefault(); handleSaveTaskEdit(task); setEditingTask(null); }}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >Save</button>
              <button
                onMouseDown={e => { e.preventDefault(); setEditingTask(null); }}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 48px' }}>
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => handleToggleTask(task)}
              style={{ width: 15, height: 15, accentColor: '#f59e0b', cursor: 'pointer', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{ fontSize: 13, color: task.approved_at ? 'var(--text-faint)' : 'var(--text)', textDecoration: task.approved_at ? 'line-through' : 'none', textDecorationColor: '#ef4444', cursor: 'text' }}
                onDoubleClick={() => startEditTask(task)}
                title="Double-click to edit"
              >{task.title}</span>
              {task.completed && (() => {
                const chain = task.review_chain || [];
                const lastSentEvent = [...chain].reverse().find(e => e.type === 'sent' || e.type === 'revised_sent');
                const isAwaiting = !task.approved_at && !task.rejected_at && !!lastSentEvent;
                const isUnsent   = !task.approved_at && !task.rejected_at && !lastSentEvent;
                const _contacts = clientRecord?.contacts || [];
                const portalEmail = _contacts.find(c => c.is_primary)?.email || _contacts[0]?.email || activeProject.client_email || '';
                const hasPortalEmail = !!(activeProject.share_token && portalEmail);
                return (
                  <div style={{ fontSize: 10, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {hasOpenRejection && <span style={{ color: '#f59e0b', fontWeight: 700 }}>⟳ In Progress — changes requested</span>}
                    {!hasOpenRejection && task.approved_at && <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Approved{task.approved_by ? ` by ${task.approved_by}` : ''}</span>}
                    {!hasOpenRejection && !task.approved_at && !isAwaiting && (
                      <>
                        <span style={{ color: 'var(--text-faint)' }}>✓ Completed {fmtDate(task.completed_at)}</span>
                        {isUnsent && hasPortalEmail && (
                          <button
                            onClick={() => { setExtraRecipients([]); setShowContactDropdown(false); setTaskCompleteEmail({ task, project: activeProject, ms: task._milestone || null }); }}
                            style={{ fontSize: 10, fontWeight: 800, padding: '2px 10px', borderRadius: 20, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '.02em' }}
                          >Notify client</button>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
              {!task.completed && hasOpenRejection && <div style={{ fontSize: 10, marginTop: 2, color: '#f59e0b', fontWeight: 700 }}>⟳ In Progress — changes requested</div>}
            </div>
            {/* Inline assign */}
            <select
              value={task.assigned_to || ''}
              onChange={async e => {
                const updated = { ...task, assigned_to: e.target.value };
                await upsertProjectTask(updated);
                const patch = t => t.id === task.id ? updated : t;
                setTasks(prev => prev.map(patch));
                setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patch) }));
              }}
              style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: task.assigned_to ? 'var(--text)' : 'var(--text-faint)', flexShrink: 0, maxWidth: 110 }}
            >
              <option value="">Unassigned</option>
              <optgroup label="Team">{owners.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>
              {clientTaskContacts.length > 0 && <optgroup label="Client">{clientTaskContacts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
            </select>
            {/* Inline hours */}
            <input
              type="number" min="0" step="0.5" placeholder="hrs"
              value={task.estimated_hours ?? ''}
              onChange={e => {
                const hrs = e.target.value === '' ? null : parseFloat(e.target.value);
                const patch = t => t.id === task.id ? { ...t, estimated_hours: hrs } : t;
                setTasks(prev => prev.map(patch));
                setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patch) }));
              }}
              onBlur={async e => { const hrs = e.target.value === '' ? null : parseFloat(e.target.value); await upsertProjectTask({ ...task, estimated_hours: hrs }); }}
              style={{ fontSize: 11, padding: '2px 5px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', width: 52, flexShrink: 0, color: 'var(--text)' }}
            />
            {/* Due date with label */}
            <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 64 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>Due Date</div>
              <div style={{ fontSize: 11, color: task.due_date ? 'var(--text-muted)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>{task.due_date ? fmtDate(task.due_date) : '—'}</div>
            </div>
            {/* Mentions pill — colored if mentions exist (uses pre-computed map) */}
            <button
              onClick={() => setMentionsPanel(task)}
              style={{
                flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
                background: taskMentionsMap[task.id] ? 'var(--accent)' : 'var(--border)',
                color: taskMentionsMap[task.id] ? '#fff' : 'var(--text-faint)',
              }}
              title="View meeting mentions"
            >Mentions</button>
            {/* Action buttons */}
            <div className="task-actions" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              {milestones.length > 0 && (
                <select
                  defaultValue=""
                  onChange={async e => {
                    const msId = e.target.value;
                    if (!msId) return;
                    const updated = { ...task, milestone_id: msId };
                    await supabase.from('project_tasks').update({ milestone_id: msId }).eq('id', task.id);
                    setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
                    setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(t => t.id === task.id ? updated : t) }));
                    setExpanded(prev => ({ ...prev, [msId]: true }));
                  }}
                  style={{ fontSize: 10, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', maxWidth: 130 }}
                >
                  <option value="">Move to milestone…</option>
                  {milestones.map(ms => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
                </select>
              )}
              <button onClick={e => { e.stopPropagation(); triggerFileUpload(activeProject.id, null, null, task.id); }} title="Attach file" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7L7 12a3.5 3.5 0 01-5-5l5-5a2 2 0 012.83 2.83L5 9.5a.71.71 0 01-1-1L8.5 4"/></svg>
              </button>
              <button onClick={e => { e.stopPropagation(); openLinkModal(activeProject.id, null, task.id); }} title="Add link" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 8.5l3-3"/><path d="M8.5 5.5L10 4a2.12 2.12 0 013 3l-1.5 1.5"/><path d="M5.5 8.5L4 10a2.12 2.12 0 01-3-3l1.5-1.5"/></svg>
              </button>
              <button
                onClick={() => { if (window.confirm('Delete this task?')) handleDeleteTask(task.id); }}
                title="Delete task"
                style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 3 11 3"/><path d="M5 3V2h4v1"/><rect x="3" y="4" width="8" height="9" rx="1"/><line x1="6" y1="7" x2="6" y2="10"/><line x1="8" y1="7" x2="8" y2="10"/></svg>
              </button>
            </div>
          </div>
        )}
        {/* ── Task-level attached files ── */}
        {taskFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 16px 8px 48px' }}>
            {taskFiles.map(f => (
              <a
                key={f.id}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid #fde68a', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
              >
                <span>{fileIcon(f.mime_type)}</span>
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); if (window.confirm(`Delete "${f.name}"?`)) handleDeleteFile(f); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '0 0 0 2px', fontSize: 11, lineHeight: 1 }}
                >✕</button>
              </a>
            ))}
          </div>
        )}
        {/* ── Chain of custody ── */}
        {!isEditingThis && (() => {
          const chain = task.review_chain || [];
          const hasRejection = task.rejected_at;
          if (chain.length === 0) return null;
          if (task.approved_at && !expandedCoC.has(task.id)) {
            return (
              <div style={{ margin: '2px 16px 8px 48px' }}>
                <button
                  onClick={() => setExpandedCoC(prev => { const n = new Set(prev); n.add(task.id); return n; })}
                  style={{ fontSize: 10, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}
                >Show review history</button>
              </div>
            );
          }
          const revisionsSent = chain.filter(e => e.type === 'revised_sent').length;
          const nextRevNum    = revisionsSent + 1;
          const lastSentEvent = [...chain].reverse().find(e => e.type === 'sent' || e.type === 'revised_sent');
          const isAwaiting    = !task.approved_at && !task.rejected_at && !!lastSentEvent;
          let rn = 0;
          const displayChain = chain.map(ev => ev.type === 'revised_sent' ? { ...ev, revNum: ++rn } : ev);
          if (isAwaiting) displayChain.push({ type: 'awaiting', at: null });
          const pillFor = ev => {
            if (ev.type === 'sent')         return { label: 'Sent to client',                  color: '#6b7280', bg: '#f3f4f6' };
            if (ev.type === 'rejected')     return { label: `Not approved · ${ev.by || ''}`,   color: '#ef4444', bg: '#fef2f2' };
            if (ev.type === 'revised_sent') return { label: `Rev ${ev.revNum} sent`,            color: '#3b82f6', bg: '#eff6ff' };
            if (ev.type === 'approved')     return { label: `Approved · ${ev.by || ''}`,        color: '#10b981', bg: '#f0fdf4' };
            if (ev.type === 'awaiting')     return { label: 'Awaiting review',                  color: '#f59e0b', bg: '#fffbeb' };
            return { label: ev.type, color: '#94a3b8', bg: '#f9fafb' };
          };
          const lastRejection = hasRejection ? [...displayChain].reverse().find(e => e.type === 'rejected') : null;
          return (
            <div style={{ margin: '4px 16px 10px 48px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {displayChain.map((ev, i) => {
                  const p = pillFor(ev);
                  const isLast = i === displayChain.length - 1;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0, marginRight: 8 }}>
                        {i > 0 && <div style={{ width: 1.5, height: 5, background: 'var(--border)', flexShrink: 0 }} />}
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0, border: `2px solid ${p.color}40`, marginTop: i === 0 ? 4 : 0 }} />
                        {!isLast && <div style={{ width: 1.5, flex: 1, background: 'var(--border)', minHeight: 6 }} />}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: isLast ? 0 : 5 }}>
                        <div style={{ padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, color: p.color, background: p.bg, border: ev.type === 'awaiting' ? `1.5px dashed ${p.color}` : `1px solid ${p.color}28`, whiteSpace: 'nowrap', lineHeight: 1.5 }}>{p.label}</div>
                        {ev.at && <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{fmtDate(ev.at)} · {new Date(ev.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {lastRejection?.notes && (
                <div style={{ margin: '6px 0 6px 20px', padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, fontSize: 11, color: '#7f1d1d', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{lastRejection.notes}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {isAwaiting && (
                  <button
                    onClick={() => { setExtraRecipients([]); setShowContactDropdown(false); setTaskCompleteEmail({ task, project: activeProject, ms: task._milestone || null }); }}
                    style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >Resend to client</button>
                )}
                {hasRejection && (
                  <button
                    onClick={() => openResendModal(task, activeProject)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >Send Revision {nextRevNum} →</button>
                )}
                {task.approved_at && expandedCoC.has(task.id) && (
                  <button
                    onClick={() => setExpandedCoC(prev => { const n = new Set(prev); n.delete(task.id); return n; })}
                    style={{ fontSize: 10, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2, marginLeft: 'auto' }}
                  >Hide history</button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2 style={{ marginBottom: 2 }}>
            {editingProjectName ? (
              <input
                type="text"
                autoFocus
                value={activeProject.name}
                onChange={e => setActiveProject(p => ({ ...p, name: e.target.value }))}
                onBlur={() => { handleSaveProject(); setEditingProjectName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { handleSaveProject(); setEditingProjectName(false); } }}
                style={{ fontSize: 22, fontWeight: 800, border: 'none', outline: 'none', background: 'transparent', padding: 0, width: '100%' }}
              />
            ) : (
              <span
                onClick={() => setEditingProjectName(true)}
                title="Click to edit"
                style={{ fontSize: 22, fontWeight: 800, cursor: 'pointer', wordBreak: 'break-word', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}
              >
                {activeProject.name}
                <span style={{ fontSize: 13, color: 'var(--text-faint)', fontWeight: 600 }}>✏️</span>
              </span>
            )}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {activeProject.client_name && <span>{activeProject.client_name} · </span>}
            {activeProject.start_date && <span>{fmtDate(activeProject.start_date)}</span>}
            {activeProject.end_date   && <span> → {fmtDate(activeProject.end_date)}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
          {/* Row 1 – content actions */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {[
              { label: '+ Proposal', action: () => setShowImporter(true) },
              { label: '+ Transcript', action: () => { setTranscriptDefaultMs(null); setShowTranscriptImporter(true); } },
              { label: 'Client Portal', action: () => setShowShareModal(true) },
            ].map(({ label, action }) => (
              <button
                key={label}
                onClick={action}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'opacity .12s' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* Project meta bar */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', marginBottom: activeProject.start_date && activeProject.end_date && milestones.length ? 16 : 0 }}>
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
            </div>
          </div>

          {activeProject.start_date && activeProject.end_date && (
            <GanttChart
              milestones={milestones}
              projectStart={activeProject.start_date}
              projectEnd={activeProject.end_date}
              onMilestoneClick={id => {
                setExpanded(prev => ({ ...prev, [id]: true }));
                setTimeout(() => {
                  document.getElementById(`ms-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 50);
              }}
            />
          )}
        </div>

        {/* ── Summary ─────────────────────────────────── */}
        <div
          onMouseEnter={() => setSummaryHovered(true)}
          onMouseLeave={() => setSummaryHovered(false)}
          style={{ background: 'var(--surface)', border: `1px solid ${summaryHovered || summaryOpen ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 10, marginBottom: 16, overflow: 'hidden', transition: 'border-color .15s' }}
        >
          {/* Header + 2-line preview — click toggles open/closed */}
          <div
            onClick={() => { setSummaryOpen(v => !v); setSummaryClearConfirm(false); }}
            style={{ padding: '10px 14px', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: activeProject.description && !summaryOpen ? 6 : 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: summaryHovered || summaryOpen ? 'var(--accent)' : 'var(--text-faint)', transition: 'color .15s' }}>Project Summary</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                {summaryOpen && activeProject.description && (
                  <>
                    {activeProject.proposal_text && (
                      <button onClick={handleGenerateSummary} disabled={summaryGenerating} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>↺ from proposal</button>
                    )}
                    <button onClick={handleGenerateSummaryFromActivity} disabled={summaryGenerating} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>↺ Refresh</button>
                  </>
                )}
                {!summaryOpen && !activeProject.description && (
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {activeProject.proposal_text ? 'proposal ready — click to generate' : 'click to add'}
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-faint)', transition: 'transform .15s', display: 'inline-block', transform: summaryOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
              </div>
            </div>

            {/* 2-line preview — shown when collapsed */}
            {!summaryOpen && activeProject.description && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {activeProject.description}
              </div>
            )}
          </div>

          {/* Expanded body */}
          {summaryOpen && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-light)' }}>
              {summaryError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 6, paddingTop: 8 }}>{summaryError}</div>}

              {/* Two-path generate UI when no summary yet */}
              {!activeProject.description && !summaryGenerating && (
                <div style={{ display: 'flex', gap: 10, marginTop: 12, marginBottom: 10 }}>
                  <div
                    onDragOver={e => { e.preventDefault(); setSummaryDragOver(true); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSummaryDragOver(false); }}
                    onDrop={handleDropProposalOnSummary}
                    style={{ flex: 1, border: `2px dashed ${summaryDragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '18px 12px', textAlign: 'center', background: summaryDragOver ? 'var(--accent-light)' : 'var(--bg)', transition: 'all .15s' }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>📄</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: summaryDragOver ? 'var(--accent)' : 'var(--text-muted)' }}>Drop proposal here</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>PDF or text file</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-faint)', fontSize: 11, fontWeight: 600 }}>or</div>
                  <div
                    onClick={handleGenerateSummaryFromActivity}
                    style={{ flex: 1, border: '2px dashed var(--border)', borderRadius: 8, padding: '18px 12px', textAlign: 'center', background: 'var(--bg)', cursor: 'pointer', transition: 'all .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)'; }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>✦</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Generate from activity</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Tasks, meetings & files</div>
                  </div>
                </div>
              )}

              {summaryGenerating && (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>✦ Generating summary…</div>
              )}

              {activeProject.description && (
                <>
                  <textarea
                    ref={summaryTextareaRef}
                    autoFocus
                    value={activeProject.description}
                    onChange={e => {
                      setActiveProject(p => ({ ...p, description: e.target.value }));
                      if (summaryTextareaRef.current) {
                        summaryTextareaRef.current.style.height = 'auto';
                        summaryTextareaRef.current.style.height = summaryTextareaRef.current.scrollHeight + 'px';
                      }
                    }}
                    onBlur={handleSaveProject}
                    style={{ width: '100%', marginTop: 10, fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'none', overflow: 'hidden', lineHeight: 1.55, fontFamily: 'inherit', minHeight: 80 }}
                  />

                  {/* Clear — hidden until hover, with inline confirmation */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                    {summaryClearConfirm ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Clear this summary?</span>
                        <button
                          onClick={async () => { const u = { ...activeProject, description: null }; setActiveProject(u); await upsertProject(u); setSummaryClearConfirm(false); setSummaryOpen(false); }}
                          style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 5, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}
                        >Yes, clear</button>
                        <button onClick={() => setSummaryClearConfirm(false)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSummaryClearConfirm(true)}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: 'none', background: 'none', color: 'transparent', cursor: 'pointer', transition: 'color .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'transparent'; }}
                      >Clear summary</button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Project tabs ── */}
        <div className="tab-bar" style={{ position: 'sticky', top: 91, zIndex: 80, background: 'var(--bg)', marginBottom: 20 }}>
          {[
            { id: 'timeline', label: 'Tasks' },
            { id: 'activity', label: meetings.length > 0 ? `Meetings (${meetings.length})` : 'Meetings' },
            { id: 'files', label: projectFiles.length > 0 ? `Files (${projectFiles.length})` : 'Files' },
            { id: 'contacts', label: 'Contacts' },
          ].map(t => (
            <button
              key={t.id}
              className={`tab-btn${projectTab === t.id ? ' active' : ''}`}
              onClick={() => setProjectTab(t.id)}
            >{t.label}</button>
          ))}
          <button
            className={`tab-btn${projectTab === 'forecast' ? ' active' : ''}`}
            onClick={() => setProjectTab('forecast')}
            style={{ marginLeft: 'auto', opacity: projectTab === 'forecast' ? 1 : 0, transition: 'opacity .15s' }}
            onMouseEnter={e => { if (projectTab !== 'forecast') e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { if (projectTab !== 'forecast') e.currentTarget.style.opacity = '0'; }}
          >Forecast</button>
        </div>

        {projectTab === 'timeline' && (<>
        {nearDupeWarning.length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>⚠️ Possible task overlap from recent import</div>
                {nearDupeWarning.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>"{w.newTitle}"</span>
                    <span style={{ color: '#b45309' }}> — may overlap with: </span>
                    {w.similar.map((s, j) => <span key={j} style={{ fontStyle: 'italic' }}>"{s}"{j < w.similar.length - 1 ? ', ' : ''}</span>)}
                  </div>
                ))}
              </div>
              <button onClick={() => setNearDupeWarning([])} style={{ background: 'none', border: 'none', color: '#92400e', cursor: 'pointer', fontSize: 16, padding: '0 2px', flexShrink: 0 }}>✕</button>
            </div>
          </div>
        )}
        {loadingDetail ? (
          <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading timeline…</p></div>
        ) : milestones.length === 0 ? (
          <>
            {/* Unassigned tasks even when no milestones exist yet — always rendered so there's a place to add a standalone task */}
            {(() => {
              const unassigned = tasks.filter(t => !t.milestone_id && !t.deleted_at);
              return (
                <div style={{ border: '1px solid #fde68a', borderRadius: 10, overflow: 'hidden', background: '#fffbeb', marginBottom: 16 }}>
                  <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.04em' }}>Unassigned Tasks</span>
                    {unassigned.length > 0 && <span style={{ fontSize: 11, color: '#b45309', marginLeft: 4 }}>{unassigned.length} task{unassigned.length !== 1 ? 's' : ''} — not yet placed in a milestone</span>}
                  </div>
                  {unassigned.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {/* Column header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px 6px 48px', borderTop: '1px solid #fde68a', background: '#fef9c3' }}>
                        <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em' }}>Task</div>
                        <div style={{ width: 110, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Assigned To</div>
                        <div style={{ width: 52, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Hrs</div>
                        <div style={{ minWidth: 64, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0, textAlign: 'center' }}>Due Date</div>
                      </div>
                      {unassigned.map(task => renderUnassignedTaskRow(task))}
                    </div>
                  )}
                  {/* Add task row — creates a task with no milestone */}
                  {newTaskMs === '__standalone__' ? (
                    <div style={{ display: 'flex', gap: 8, padding: '8px 16px 8px 18px', alignItems: 'center', borderTop: '1px solid #fde68a' }}>
                      <input
                        type="text"
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddTask(null); if (e.key === 'Escape') { setNewTaskMs(null); setNewTaskTitle(''); } }}
                        placeholder="Task name… (Enter to add)"
                        autoFocus
                        style={{ flex: 1, fontSize: 13, padding: '5px 10px' }}
                      />
                      <button className="btn btn-primary" onClick={() => handleAddTask(null)} style={{ fontSize: 12 }}>Add</button>
                      <button onClick={() => { setNewTaskMs(null); setNewTaskTitle(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}>✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setNewTaskMs('__standalone__'); setNewTaskTitle(''); setEditingTask(null); setConfirmDeleteTask(null); }}
                      style={{ display: 'block', width: '100%', padding: '8px 18px', background: 'none', border: 'none', borderTop: '1px solid #fde68a', cursor: 'pointer', fontSize: 12, color: '#92400e', textAlign: 'left' }}
                    >
                      + Add task
                    </button>
                  )}
                </div>
              );
            })()}
            <div className="empty-state">
              <h3>No milestones yet</h3>
              <p>Import a proposal to auto-generate a timeline, or add milestones manually.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button className="btn" onClick={() => setShowImporter(true)} style={{ borderRadius: 20, padding: '7px 18px' }}>Import Proposal</button>
                <button className="btn btn-primary" onClick={handleAddMilestone} style={{ borderRadius: 20, padding: '7px 18px' }}>+ Add Milestone</button>
              </div>
            </div>
          </>
        ) : (<>

          {/* ── Milestones & Tasks ─────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {milestones.map((ms) => {
              const msTasks   = msForTasks(ms.id);
              const msPct     = projectProgress(msTasks);
              const isOpen    = expanded[ms.id];
              const isEditing = editingMs === ms.id;
              const color     = msColor(ms.status);

              const isDropTargetMs = dragOverMsId === ms.id;
              return (
                <div
                  key={ms.id}
                  id={`ms-${ms.id}`}
                  onDragOver={e => { if (draggedTaskId) { e.preventDefault(); setDragOverMsId(ms.id); } }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverMsId(null); }}
                  onDrop={e => {
                    if (!draggedTaskId) return;
                    e.preventDefault();
                    setDragOverMsId(null);
                    handleMoveTaskToMilestone(draggedTaskId, ms.id);
                  }}
                  onMouseEnter={e => { if (!isDropTargetMs) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)'; } }}
                  onMouseLeave={e => { if (!isDropTargetMs) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; } }}
                  style={{
                    border: `1px solid ${isDropTargetMs ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 10, overflow: 'hidden', background: 'var(--surface)',
                    boxShadow: isDropTargetMs ? '0 0 0 3px rgba(249, 115, 22, 0.15)' : 'none',
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                >

                  {/* Milestone header */}
                  <div
                    style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 0, alignItems: 'stretch', cursor: 'pointer', borderBottom: isOpen ? '1px solid var(--border-light)' : 'none' }}
                    onClick={e => handleToggleMilestone(e, ms.id)}
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

                      {/* Row 2 – Start · Due · Client contact */}
                      <div style={{ display: 'flex', gap: 16, padding: '10px 16px 10px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <Lbl>Start</Lbl>
                          <input type="date" value={ms.start_date || ''} onChange={e => { const u = { ...ms, start_date: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }} />
                        </div>
                        <div>
                          <Lbl>Due</Lbl>
                          <input type="date" value={ms.due_date || ''} onChange={e => { const u = { ...ms, due_date: e.target.value }; setMilestones(p => p.map(m => m.id === ms.id ? u : m)); upsertMilestone(u); }} style={{ fontSize: 12, padding: '3px 8px', width: 'auto' }} />
                        </div>
                        {(clientRecord?.contacts || []).length > 0 && (
                          <div>
                            <Lbl>Client contact</Lbl>
                            <select
                              value={ms.portal_contact ? JSON.stringify({ name: ms.portal_contact.name, email: ms.portal_contact.email }) : ''}
                              onChange={async e => {
                                const val = e.target.value;
                                const contact = val ? JSON.parse(val) : null;
                                const u = { ...ms, portal_contact: contact };
                                setMilestones(p => p.map(m => m.id === ms.id ? u : m));
                                try { await upsertMilestone(u); } catch { /* run migration if column missing */ }
                              }}
                              style={{ fontSize: 12, padding: '3px 8px', width: 'auto', minWidth: 160 }}
                              title="All task notifications for this milestone go to this contact by default"
                            >
                              <option value="">
                                {(() => { const p = (clientRecord?.contacts || []).find(c => c.is_primary) || (clientRecord?.contacts || [])[0]; return p ? `${p.name} (primary)` : '— Primary contact —'; })()}
                              </option>
                              {(clientRecord?.contacts || []).map(c => (
                                <option key={c.name} value={JSON.stringify({ name: c.name, email: c.email || null })}>{c.name}{!c.email ? ' (no email)' : ''}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Row 3 – Status buttons */}
                      <div style={{ display: 'flex', gap: 6, padding: '8px 16px 8px 48px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)', alignItems: 'center', flexWrap: 'wrap' }}>
                        {MILESTONE_STATUSES.filter(s => s.id !== 'blocked').map(s => {
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
                          <button onClick={() => { if (window.confirm(`Delete "${f.name}"?`)) handleDeleteFile(f); }} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}

                      {/* Tasks — column headers */}
                      {msTasks.some(t => !projectOwnerFilter || (t.assigned_to || ms.assigned_to || '') === projectOwnerFilter || (projectOwnerFilter === '__unassigned__' && !(t.assigned_to || ms.assigned_to))) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 16px 5px 48px', borderTop: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                            <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Task</div>
                          <div style={{ width: 110, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Assigned To</div>
                          <div style={{ width: 52, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Hrs</div>
                          <div style={{ width: 110, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Due Date</div>
                          <div style={{ width: 120, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Recipient</div>
                          <div style={{ width: 70, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Mentions</div>
                          <div style={{ width: 96, fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Actions</div>
                        </div>
                      )}

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

                        const hasOpenRejection = task.completed && task.rejected_at;
                        const isDroppingOnTask = dragOverTask === task.id;
                        return (
                          <div
                            key={task.id}
                            className="task-row"
                            draggable
                            onDragStart={e => { e.dataTransfer.setData('text/plain', task.id); setDraggedTaskId(task.id); }}
                            onDragEnd={() => { setDraggedTaskId(null); setDragOverMsId(null); }}
                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverTask(task.id); }}
                            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverTask(null); }}
                            onDrop={e => {
                              if (draggedTaskId && draggedTaskId !== task.id) {
                                e.preventDefault(); e.stopPropagation();
                                setDragOverTask(null);
                                handleMoveTaskToMilestone(draggedTaskId, ms.id);
                                return;
                              }
                              handleDropOnTask(e, task);
                            }}
                            style={{
                              borderBottom: '1px solid var(--border-light)',
                              background: isDroppingOnTask ? '#eff6ff' : hasOpenRejection ? '#fffbeb' : 'var(--surface)',
                              borderLeft: isDroppingOnTask ? '3px solid var(--accent)' : hasOpenRejection ? '3px solid #f59e0b' : 'none',
                              transition: 'background .1s, border-left .1s',
                              position: 'relative',
                              cursor: 'grab',
                            }}
                          >
                            {isDroppingOnTask && uploadingFor !== task.id && (
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 2 }}>
                                <div style={{ background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                                  📎 Drop to attach
                                </div>
                              </div>
                            )}
                            {uploadingFor === task.id && (
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 2, background: 'rgba(255,255,255,0.7)' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>⏳ Uploading…</div>
                              </div>
                            )}

                            {isEditingThis ? (
                              /* ── Edit mode ───────────────────────────────── */
                              <div
                                style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 16px 10px 48px', alignItems: 'center', background: 'var(--bg)', borderLeft: '3px solid var(--accent)' }}
                                onBlur={e => {
                                  if (!e.currentTarget.contains(e.relatedTarget)) {
                                    // Read number input directly from the DOM — avoids any React batching / stale-closure issues
                                    const numInput = e.currentTarget.querySelector('input[type="number"]');
                                    if (numInput) editTaskDraftRef.current = { ...editTaskDraftRef.current, estimated_hours: numInput.value };
                                    handleSaveTaskEdit(task);
                                    setEditingTask(null);
                                  }
                                }}
                              >
                                <input
                                  type="text"
                                  autoFocus
                                  value={editTaskDraft.title}
                                  onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') { handleSaveTaskEdit(task); setEditingTask(null); } if (e.key === 'Escape') setEditingTask(null); }}
                                  style={{ flex: '1 1 180px', fontSize: 13, padding: '5px 10px', fontWeight: 600 }}
                                  placeholder="Task title"
                                />
                                <div>
                                  <Lbl>Due date</Lbl>
                                  <input
                                    type="date"
                                    value={editTaskDraft.due_date}
                                    onChange={e => setEditDraft(d => ({ ...d, due_date: e.target.value }))}
                                    style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                                  />
                                </div>
                                <div>
                                  <Lbl>Assigned to</Lbl>
                                  <select
                                    value={editTaskDraft.assigned_to}
                                    onChange={e => setEditDraft(d => ({ ...d, assigned_to: e.target.value }))}
                                    style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                                  >
                                    <option value="">—</option>
                                    <optgroup label="Team">{owners.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>
                                    {clientTaskContacts.length > 0 && <optgroup label="Client">{clientTaskContacts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
                                  </select>
                                </div>
                                <div>
                                  <Lbl>Est. hrs</Lbl>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={editTaskDraft.estimated_hours}
                                    onChange={e => setEditDraft(d => ({ ...d, estimated_hours: e.target.value }))}
                                    placeholder="—"
                                    style={{ fontSize: 12, padding: '4px 8px', width: 70 }}
                                  />
                                </div>
                                <button
                                  onMouseDown={e => { e.preventDefault(); handleSaveTaskEdit(task); setEditingTask(null); }}
                                  style={{ fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'flex-end' }}
                                >Save</button>
                                <button
                                  onMouseDown={e => { e.preventDefault(); setEditingTask(null); }}
                                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', alignSelf: 'flex-end' }}
                                >Cancel</button>
                              </div>
                            ) : (
                              /* ── Normal view mode ────────────────────────── */
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 48px' }}>
                                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={task.completed}
                                    onChange={() => handleToggleTask(task)}
                                    style={{ width: 15, height: 15, accentColor: hasOpenRejection ? '#f59e0b' : color, cursor: 'pointer', flexShrink: 0 }}
                                  />
                                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                                  <span
                                    style={{
                                      fontSize: 13,
                                      color: hasOpenRejection ? '#92400e' : task.approved_at ? 'var(--text-faint)' : 'var(--text)',
                                      fontWeight: hasOpenRejection ? 600 : 400,
                                      textDecoration: task.approved_at ? 'line-through' : 'none',
                                      textDecorationColor: '#ef4444',
                                      cursor: 'text',
                                      display: 'block',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                    onDoubleClick={() => startEditTask(task)}
                                    title={task.title}
                                  >
                                    {task.title}
                                  </span>
                                  {task.completed && (() => {
                                    const chain = task.review_chain || [];
                                    const lastEvent = [...chain].reverse().find(e => e.type === 'sent' || e.type === 'revised_sent');
                                    const isAwaiting = !task.approved_at && !task.rejected_at && !!lastEvent;
                                    const isUnsent   = !task.approved_at && !task.rejected_at && !lastEvent;
                                    const _contacts2 = clientRecord?.contacts || [];
                                    const portalEmail = _contacts2.find(c => c.is_primary)?.email || _contacts2[0]?.email || activeProject.client_email || '';
                                    const hasPortalEmail = !!(activeProject.share_token && portalEmail);
                                    return (
                                      <div style={{ fontSize: 10, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        {hasOpenRejection && (
                                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>&#x27F3; In Progress — changes requested</span>
                                        )}
                                        {!hasOpenRejection && task.approved_at && (
                                          <span style={{ color: '#10b981', fontWeight: 600 }}>&#x2713; Approved{task.approved_by ? ` by ${task.approved_by}` : ''}</span>
                                        )}
                                        {!hasOpenRejection && !task.approved_at && !isAwaiting && (
                                          <>
                                            <span style={{ color: 'var(--text-faint)' }}>&#x2713; Completed {fmtDate(task.completed_at)}</span>
                                            {isUnsent && hasPortalEmail && (
                                              <button
                                                onClick={() => { setExtraRecipients([]); setShowContactDropdown(false); setTaskCompleteEmail({ task, project: activeProject, ms }); }}
                                                style={{ fontSize: 10, fontWeight: 800, padding: '2px 10px', borderRadius: 20, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '.02em' }}
                                              >Notify client</button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  </div>
                                </div>
                                {/* Inline assign + hours */}
                                <select
                                  value={task.assigned_to || ''}
                                  onChange={async e => {
                                    const updated = { ...task, assigned_to: e.target.value };
                                    await upsertProjectTask(updated);
                                    const patch = t => t.id === task.id ? updated : t;
                                    setTasks(prev => prev.map(patch));
                                    setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patch) }));
                                  }}
                                  style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: task.assigned_to ? 'var(--text)' : 'var(--text-faint)', flexShrink: 0, width: 110 }}
                                >
                                  <option value="">Unassigned</option>
                                  <optgroup label="Team">{owners.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>
                                  {clientTaskContacts.length > 0 && <optgroup label="Client">{clientTaskContacts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={task.estimated_hours ?? ''}
                                  placeholder="hrs"
                                  onChange={e => {
                                    // Update state immediately so forecast reflects change while typing
                                    const hrs = e.target.value === '' ? null : parseFloat(e.target.value);
                                    const patch = t => t.id === task.id ? { ...t, estimated_hours: hrs } : t;
                                    setTasks(prev => prev.map(patch));
                                    setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patch) }));
                                  }}
                                  onBlur={async e => {
                                    // Persist to DB only when done typing
                                    const hrs = e.target.value === '' ? null : parseFloat(e.target.value);
                                    await upsertProjectTask({ ...task, estimated_hours: hrs });
                                  }}
                                  style={{ fontSize: 11, padding: '2px 5px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', width: 52, flexShrink: 0, color: 'var(--text)' }}
                                />
                                <input
                                  type="date"
                                  value={task.due_date || ''}
                                  onChange={async e => {
                                    const due_date = e.target.value || null;
                                    const updated = { ...task, due_date };
                                    const patch = t => t.id === task.id ? updated : t;
                                    setTasks(prev => prev.map(patch));
                                    setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patch) }));
                                    await upsertProjectTask(updated);
                                    await syncMilestoneDates(updated);
                                  }}
                                  style={{ border: '1px solid var(--border)', borderRadius: 4, background: task.due_date ? 'var(--accent-light, #fff7ed)' : 'var(--surface)', flexShrink: 0, width: 110, fontSize: 11, padding: '2px 4px', color: task.due_date ? 'var(--text-muted)' : 'var(--text-faint)' }}
                                />
                                {/* Portal recipient — task contact > milestone contact > primary contact */}
                                {(() => {
                                  const primaryC = (clientRecord?.contacts || []).find(c => c.is_primary) || (clientRecord?.contacts || [])[0];
                                  const defaultC = ms.portal_contact?.name ? ms.portal_contact : primaryC;
                                  return (
                                    <select
                                      value={task.portal_contact ? JSON.stringify({ name: task.portal_contact.name, email: task.portal_contact.email }) : ''}
                                      onChange={async e => {
                                        const val = e.target.value;
                                        const contact = val ? JSON.parse(val) : null;
                                        const patch = t => t.id === task.id ? { ...t, portal_contact: contact } : t;
                                        setTasks(prev => prev.map(patch));
                                        setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patch) }));
                                        await saveTaskPortalContact(task.id, contact);
                                      }}
                                      style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', flexShrink: 0, width: 120 }}
                                      title="Assign to client portal recipient"
                                    >
                                      <option value="">{defaultC ? defaultC.name : '— No recipient —'}</option>
                                      {(clientRecord?.contacts || []).map(c => (
                                        <option key={c.name} value={JSON.stringify({ name: c.name, email: c.email || null })}>{c.name}{!c.email ? ' (no email)' : ''}</option>
                                      ))}
                                    </select>
                                  );
                                })()}
                                {/* Mentions pill — colored when task appears in meeting notes */}
                                <button
                                  onClick={() => setMentionsPanel(task)}
                                  style={{
                                    flexShrink: 0, width: 70, fontSize: 10, fontWeight: 700, padding: '3px 0', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', textAlign: 'center',
                                    background: taskMentionsMap[task.id] ? 'var(--accent)' : 'var(--border)',
                                    color: taskMentionsMap[task.id] ? '#fff' : 'var(--text-faint)',
                                  }}
                                  title="View meeting mentions"
                                >Mentions</button>
                                {/* ── Task action buttons ── */}
                                <div className="task-actions" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                                  {/* Proposal */}
                                  {(activeProject.proposal_text || activeProject.proposal_pdf_url) && (
                                    <button onClick={() => setProposalPanel({ task })} title="See in proposal" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                      <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="1" width="8" height="11" rx="1"/><path d="M5 1v3h5"/><path d="M4 7h4M4 9.5h3"/></svg>
                                    </button>
                                  )}
                                  {/* Attach file */}
                                  <button onClick={e => { e.stopPropagation(); triggerFileUpload(activeProject.id, null, null, task.id); }} disabled={uploadingFor === task.id} title="Attach file" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                    {uploadingFor === task.id
                                      ? <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 1"/></svg>
                                      : <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7L7 12a3.5 3.5 0 01-5-5l5-5a2 2 0 012.83 2.83L5 9.5a.71.71 0 01-1-1L8.5 4"/></svg>
                                    }
                                  </button>
                                  {/* Add link */}
                                  <button onClick={e => { e.stopPropagation(); openLinkModal(activeProject.id, null, task.id); }} title="Add link" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 8.5l3-3"/><path d="M8.5 5.5L10 4a2.12 2.12 0 013 3l-1.5 1.5"/><path d="M5.5 8.5L4 10a2.12 2.12 0 01-3-3l1.5-1.5"/></svg>
                                  </button>
                                  {/* Delete */}
                                  <button
                                    onClick={() => { if (window.confirm('Delete this task?')) handleDeleteTask(task.id); }}
                                    title="Delete task"
                                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                                  >
                                    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 3.5h10M5 3.5V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M5.5 6v4M8.5 6v4M3 3.5l.7 7.5a1 1 0 001 .9h4.6a1 1 0 001-.9l.7-7.5"/></svg>
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* ── Chain of custody ── */}
                            {(() => {
                              const chain = task.review_chain || [];
                              const hasRejection = task.rejected_at;
                              if (chain.length === 0) return null;
                              // Collapse CoC once approved — show a small toggle to expand history
                              if (task.approved_at && !expandedCoC.has(task.id)) {
                                return (
                                  <div style={{ margin: '2px 16px 8px 48px' }}>
                                    <button
                                      onClick={() => setExpandedCoC(prev => { const n = new Set(prev); n.add(task.id); return n; })}
                                      style={{ fontSize: 10, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}
                                    >Show review history</button>
                                  </div>
                                );
                              }

                              const revisionsSent = chain.filter(e => e.type === 'revised_sent').length;
                              const nextRevNum    = revisionsSent + 1;

                              // Determine if task is awaiting a client response
                              const lastSentEvent = [...chain].reverse().find(e => e.type === 'sent' || e.type === 'revised_sent');
                              const isAwaiting    = !task.approved_at && !task.rejected_at && !!lastSentEvent;

                              let rn = 0;
                              const displayChain = chain.map(ev => ev.type === 'revised_sent' ? { ...ev, revNum: ++rn } : ev);
                              // Append synthetic 'awaiting' pill while pending client response
                              if (isAwaiting) displayChain.push({ type: 'awaiting', at: null });

                              const pillFor = ev => {
                                if (ev.type === 'sent')         return { label: 'Sent to client',                  color: '#6b7280', bg: '#f3f4f6' };
                                if (ev.type === 'rejected')     return { label: `Not approved · ${ev.by || ''}`,   color: '#ef4444', bg: '#fef2f2' };
                                if (ev.type === 'revised_sent') return { label: `Rev ${ev.revNum} sent`,            color: '#3b82f6', bg: '#eff6ff' };
                                if (ev.type === 'approved')     return { label: `Approved · ${ev.by || ''}`,        color: '#10b981', bg: '#f0fdf4' };
                                if (ev.type === 'awaiting')     return { label: 'Awaiting review',                  color: '#f59e0b', bg: '#fffbeb' };
                                return { label: ev.type, color: '#94a3b8', bg: '#f9fafb' };
                              };

                              const lastRejection = hasRejection
                                ? [...displayChain].reverse().find(e => e.type === 'rejected')
                                : null;

                              return (
                                <div style={{ margin: '4px 16px 10px 48px' }}>
                                  {/* Stacked pill chain — always visible */}
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    {displayChain.map((ev, i) => {
                                      const p = pillFor(ev);
                                      const isLast = i === displayChain.length - 1;
                                      return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'stretch' }}>
                                          {/* Vertical spine + dot */}
                                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0, marginRight: 8 }}>
                                            {i > 0 && <div style={{ width: 1.5, height: 5, background: 'var(--border)', flexShrink: 0 }} />}
                                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0, border: `2px solid ${p.color}40`, marginTop: i === 0 ? 4 : 0 }} />
                                            {!isLast && <div style={{ width: 1.5, flex: 1, background: 'var(--border)', minHeight: 6 }} />}
                                          </div>
                                          {/* Pill + timestamp */}
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: isLast ? 0 : 5, paddingTop: i === 0 ? 0 : 0 }}>
                                            <div style={{
                                              padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                                              color: p.color, background: p.bg,
                                              border: ev.type === 'awaiting' ? `1.5px dashed ${p.color}` : `1px solid ${p.color}28`,
                                              whiteSpace: 'nowrap', lineHeight: 1.5,
                                            }}>{p.label}</div>
                                            {ev.at && <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{fmtDate(ev.at)} · {new Date(ev.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}</span>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Rejection notes — show when open */}
                                  {lastRejection?.notes && (
                                    <div style={{ margin: '6px 0 6px 20px', padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, fontSize: 11, color: '#7f1d1d', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                                      {lastRejection.notes}
                                    </div>
                                  )}

                                  {/* CTAs below chain */}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    {isAwaiting && (
                                      <button
                                        onClick={() => { setExtraRecipients([]); setShowContactDropdown(false); setTaskCompleteEmail({ task, project: activeProject, ms }); }}
                                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                      >Resend to client</button>
                                    )}
                                    {hasRejection && (
                                      <button
                                        onClick={() => openResendModal(task, activeProject, ms)}
                                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                      >Send Revision {nextRevNum} →</button>
                                    )}
                                    {task.approved_at && expandedCoC.has(task.id) && (
                                      <button
                                        onClick={() => setExpandedCoC(prev => { const n = new Set(prev); n.delete(task.id); return n; })}
                                        style={{ fontSize: 10, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2, marginLeft: 'auto' }}
                                      >Hide history</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

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
                                      onClick={e => { e.preventDefault(); e.stopPropagation(); if (window.confirm(`Delete "${f.name}"?`)) handleDeleteFile(f); }}
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

                      {/* From transcript / Attach file / Add link */}
                      <button
                        onClick={() => { setTranscriptDefaultMs(ms.id); setShowTranscriptImporter(true); }}
                        style={{ width: '100%', padding: '7px 16px 7px 48px', background: 'none', border: 'none', borderTop: '1px solid var(--border-light)', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left', transition: 'color .15s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                        title="Add tasks from a meeting transcript"
                      >
                        Add transcript to milestone
                      </button>
                      <button
                        onClick={() => triggerFileUpload(activeProject.id, ms.id)}
                        disabled={uploadingFor === ms.id}
                        style={{ width: '100%', padding: '7px 16px 7px 48px', background: 'none', border: 'none', cursor: uploadingFor === ms.id ? 'default' : 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left', transition: 'color .15s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                      >
                        {uploadingFor === ms.id ? 'Uploading…' : 'Attach file to milestone'}
                      </button>
                      <button
                        onClick={() => openLinkModal(activeProject.id, ms.id)}
                        style={{ width: '100%', padding: '7px 16px 7px 48px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint)', textAlign: 'left', transition: 'color .15s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                      >
                        Add link to milestone
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

            {/* Unassigned tasks — tasks with no milestone (e.g. from meeting imports), always rendered so there's a place to add one */}
            {(() => {
              const unassigned = tasks.filter(t => !t.milestone_id && !t.deleted_at);
              const isDropTargetUnassigned = dragOverMsId === '__unassigned__';
              return (
                <div
                  onDragOver={e => { if (draggedTaskId) { e.preventDefault(); setDragOverMsId('__unassigned__'); } }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverMsId(null); }}
                  onDrop={e => {
                    if (!draggedTaskId) return;
                    e.preventDefault();
                    setDragOverMsId(null);
                    handleMoveTaskToMilestone(draggedTaskId, null);
                  }}
                  style={{
                    border: `1px solid ${isDropTargetUnassigned ? 'var(--accent)' : '#fde68a'}`,
                    borderRadius: 10, overflow: 'hidden', background: '#fffbeb', marginBottom: 16,
                    boxShadow: isDropTargetUnassigned ? '0 0 0 3px rgba(249, 115, 22, 0.15)' : 'none',
                    transition: 'border-color .1s, box-shadow .1s',
                  }}
                >
                  <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.04em' }}>Unassigned Tasks</span>
                    {unassigned.length > 0 && <span style={{ fontSize: 11, color: '#b45309', marginLeft: 4 }}>{unassigned.length} task{unassigned.length !== 1 ? 's' : ''} — not yet placed in a milestone</span>}
                  </div>
                  {unassigned.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {/* Column header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px 6px 48px', borderTop: '1px solid #fde68a', background: '#fef9c3' }}>
                        <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em' }}>Task</div>
                        <div style={{ width: 110, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Assigned To</div>
                        <div style={{ width: 52, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Hrs</div>
                        <div style={{ minWidth: 64, fontSize: 9, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0, textAlign: 'center' }}>Due Date</div>
                      </div>
                      {unassigned.map(task => renderUnassignedTaskRow(task))}
                    </div>
                  )}
                  {/* Add task row — creates a task with no milestone */}
                  {newTaskMs === '__standalone__' ? (
                    <div style={{ display: 'flex', gap: 8, padding: '8px 16px 8px 18px', alignItems: 'center', borderTop: '1px solid #fde68a' }}>
                      <input
                        type="text"
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddTask(null); if (e.key === 'Escape') { setNewTaskMs(null); setNewTaskTitle(''); } }}
                        placeholder="Task name… (Enter to add)"
                        autoFocus
                        style={{ flex: 1, fontSize: 13, padding: '5px 10px' }}
                      />
                      <button className="btn btn-primary" onClick={() => handleAddTask(null)} style={{ fontSize: 12 }}>Add</button>
                      <button onClick={() => { setNewTaskMs(null); setNewTaskTitle(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}>✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setNewTaskMs('__standalone__'); setNewTaskTitle(''); setEditingTask(null); setConfirmDeleteTask(null); }}
                      style={{ display: 'block', width: '100%', padding: '8px 18px', background: 'none', border: 'none', borderTop: '1px solid #fde68a', cursor: 'pointer', fontSize: 12, color: '#92400e', textAlign: 'left' }}
                    >
                      + Add task
                    </button>
                  )}
                </div>
              );
            })()}

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
        </>)}

        {/* ── Activity tab ── */}
        {projectTab === 'activity' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOverMeetingsTab(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverMeetingsTab(false); }}
            onDrop={handleDropOnMeetingsTab}
            style={{ position: 'relative', ...(dragOverMeetingsTab ? { outline: '2px dashed var(--accent)', outlineOffset: 6, borderRadius: 10 } : {}) }}
          >
            {dragOverMeetingsTab && (
              <div style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--accent-rgb, 249,115,22), 0.06)', borderRadius: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>Drop transcript or meeting doc to import</div>
              </div>
            )}
            {/* ── Project Notes ── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Project Notes</div>

              {/* Note input — always visible on this tab */}
              <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  autoFocus
                  value={newNoteText}
                  onChange={e => setNewNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddNote(); }}
                  placeholder="Type a note…"
                  rows={3}
                  style={{ width: '100%', fontSize: 13, lineHeight: 1.65, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleAddNote} disabled={!newNoteText.trim()} style={{ borderRadius: 20 }}>Save Note</button>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>or drop a transcript anywhere on this tab to import &amp; analyze</span>
                </div>
              </div>

              {/* Notes list */}
              {projectNotes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {projectNotes.map(note => (
                    <div key={note.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      {editingNoteId === note.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <textarea
                            autoFocus
                            value={editNoteText}
                            onChange={e => setEditNoteText(e.target.value)}
                            rows={3}
                            style={{ width: '100%', fontSize: 13, lineHeight: 1.65, resize: 'vertical' }}
                          />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleSaveNoteEdit(note.id)} style={{ borderRadius: 20 }}>Save</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setEditingNoteId(null)} style={{ borderRadius: 20 }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{note.text}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                              {new Date(note.updated_at || note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              {note.updated_at && note.updated_at !== note.created_at ? ' (edited)' : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            <button onClick={() => { setEditingNoteId(note.id); setEditNoteText(note.text); }} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }} title="Edit">✏</button>
                            <button onClick={() => handleDeleteNote(note.id)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--red)', cursor: 'pointer' }} title="Delete">✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {dealTasks.filter(t => !t.completed).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Open Next Steps</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dealTasks.filter(t => !t.completed).map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{t.title}</span>
                      {t.due_date && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t.due_date}</span>}
                      {t.assigned_to && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: t.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: t.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{t.assigned_to}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Meeting log shortcut */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Meeting Log {meetings.length > 0 && <span style={{ fontWeight: 500, color: 'var(--text-faint)' }}>({meetings.length})</span>}
              </span>
              <button className="btn btn-primary btn-xs" onClick={() => { setTranscriptDefaultMs(null); setShowTranscriptImporter(true); }}>+ Add Meeting</button>
            </div>
            {meetings.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20, textAlign: 'center', padding: '12px 0' }}>No meetings logged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {meetings.map(mtg => (
                  <div key={mtg.id} style={{ padding: '12px 14px', background: 'var(--surface)', border: `1px solid ${mtg.deal_id ? '#bbf7d0' : 'var(--border)'}`, borderLeft: mtg.deal_id ? '3px solid #059669' : undefined, borderRadius: 8 }}>
                    {mtg.deal_id && (
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0', textTransform: 'uppercase', letterSpacing: '.05em' }}>From Deal</span>
                      </div>
                    )}
                    {editingMeeting === mtg.id ? (
                      /* ── Inline edit form ── */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input
                          type="text"
                          value={editMeetingDraft.title || ''}
                          onChange={e => setEditMeetingDraft(d => ({ ...d, title: e.target.value }))}
                          placeholder="Meeting title"
                          style={{ fontSize: 13, fontWeight: 700, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="date"
                            value={editMeetingDraft.meeting_date || ''}
                            onChange={e => setEditMeetingDraft(d => ({ ...d, meeting_date: e.target.value }))}
                            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 160 }}
                          />
                          <input
                            type="text"
                            value={editMeetingDraft.meeting_time || ''}
                            onChange={e => setEditMeetingDraft(d => ({ ...d, meeting_time: e.target.value }))}
                            placeholder="Time (e.g. 10:00 AM)"
                            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 140 }}
                          />
                        </div>
                        <input
                          type="text"
                          value={Array.isArray(editMeetingDraft.attendees) ? editMeetingDraft.attendees.join(', ') : (editMeetingDraft.attendees || '')}
                          onChange={e => setEditMeetingDraft(d => ({ ...d, attendees: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                          placeholder="Attendees (comma-separated)"
                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                        />
                        <textarea
                          value={editMeetingDraft.summary || ''}
                          onChange={e => setEditMeetingDraft(d => ({ ...d, summary: e.target.value }))}
                          placeholder="Summary / notes…"
                          rows={3}
                          style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', lineHeight: 1.6, resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary btn-sm" onClick={handleSaveMeeting} disabled={savingMeeting} style={{ borderRadius: 20 }}>{savingMeeting ? 'Saving…' : 'Save'}</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditingMeeting(null)} style={{ borderRadius: 20 }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <MeetingCard
                        mtg={mtg}
                        tasks={tasks}
                        isExpanded={expandedMeetings.has(mtg.id)}
                        onToggleExpanded={() => setExpandedMeetings(prev => { const next = new Set(prev); next.has(mtg.id) ? next.delete(mtg.id) : next.add(mtg.id); return next; })}
                        onEdit={() => { setEditingMeeting(mtg.id); setEditMeetingDraft({ title: mtg.title, meeting_date: mtg.meeting_date || '', meeting_time: mtg.meeting_time || '', attendees: mtg.attendees || [], summary: mtg.summary || '' }); }}
                        onDelete={async () => { if (!window.confirm('Delete this meeting?')) return; await deleteProjectMeeting(mtg.id); setMeetings(prev => prev.filter(m => m.id !== mtg.id)); }}
                        onActionItemClick={ai => { const base = mtg.meeting_date ? new Date(mtg.meeting_date + 'T12:00:00') : new Date(); base.setDate(base.getDate() + 7); setActionItemDraft({ title: ai.title || '', assigned_to: ai.owner || '', estimated_hours: ai.estimated_hours || '', milestone_id: milestones[0]?.id || null, due_date: base.toISOString().slice(0,10) }); }}
                        innerBg="var(--bg)"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Activity Log</span>
              {activeProject.source_deal_id && (
                <button className="btn btn-primary btn-xs" onClick={() => setAddingDealAct(a => !a)}>+ Log Activity</button>
              )}
            </div>

            {addingDealAct && activeProject.source_deal_id && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <select value={dealActForm.type} onChange={e => setDealActForm(f => ({ ...f, type: e.target.value }))} style={{ fontSize: 12 }}>
                    {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                  <input type="date" value={dealActForm.activity_date} onChange={e => setDealActForm(f => ({ ...f, activity_date: e.target.value }))} style={{ fontSize: 12 }} />
                  <select value={dealActForm.assigned_to} onChange={e => setDealActForm(f => ({ ...f, assigned_to: e.target.value }))} style={{ fontSize: 12 }}>
                    {owners.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <textarea rows={2} placeholder="What happened?" value={dealActForm.summary} onChange={e => setDealActForm(f => ({ ...f, summary: e.target.value }))} style={{ width: '100%', fontSize: 12, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-sm" disabled={savingDealAct || !dealActForm.summary.trim()} onClick={async () => {
                    setSavingDealAct(true);
                    try {
                      await addActivity({ ...dealActForm, deal_id: activeProject.source_deal_id });
                      const updated = await fetchActivities(activeProject.source_deal_id);
                      setDealActivities(updated);
                      setDealActForm(f => ({ ...f, summary: '' }));
                      setAddingDealAct(false);
                    } catch(e) { alert(e.message); } finally { setSavingDealAct(false); }
                  }}>{savingDealAct ? 'Saving…' : 'Log'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAddingDealAct(false)}>Cancel</button>
                </div>
              </div>
            )}

            {dealActivities.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '24px 0' }}>
                {activeProject.source_deal_id ? 'No activity logged on this deal yet.' : 'No deal linked — create the project from a won deal to see activity here.'}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dealActivities.map(a => {
                const ICONS = { email:'✉️', call:'📞', meeting:'🤝', note:'📝', proposal:'📄', contract:'✍️' };
                return (
                  <div key={a.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ICONS[a.type] || '📝'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{a.type}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{a.activity_date}</span>
                        {a.assigned_to && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: a.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: a.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{a.assigned_to}</span>}
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>{a.summary}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Files tab ── */}
        {projectTab === 'files' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Drop zone */}
            <div
              onClick={() => triggerFileUpload(activeProject.id)}
              onDragOver={e => { e.preventDefault(); setDragOverFilesZone(true); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverFilesZone(false); }}
              onDrop={handleDropOnFilesZone}
              style={{
                padding: '28px 20px',
                textAlign: 'center',
                border: `2px dashed ${dragOverFilesZone ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                background: dragOverFilesZone ? 'var(--accent-light)' : 'var(--surface)',
                cursor: uploadingFor === '__files_zone__' ? 'default' : 'pointer',
                transition: 'border-color .15s, background .15s',
              }}
            >
              {uploadingFor === '__files_zone__' ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>⏳ Uploading…</div>
              ) : (
                <>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: dragOverFilesZone ? 'var(--accent)' : 'var(--text-muted)' }}>
                    Drop files here or click to browse
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Any file type supported</div>
                </>
              )}
            </div>

            {/* Insert Link */}
            <button
              onClick={() => openLinkModal(activeProject.id)}
              style={{
                width: '100%',
                padding: '10px 16px',
                border: '2px dashed var(--border)',
                borderRadius: 10,
                background: 'var(--surface)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-muted)',
                transition: 'border-color .15s, color .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              🔗 Insert Link
            </button>

            {/* Active files */}
            {projectFiles.length > 0 && (() => {
              const projectLevel = projectFiles.filter(f => !f.milestone_id && !f.task_id);
              const milestoneLevel = projectFiles.filter(f => f.milestone_id && !f.task_id);
              const taskLevel = projectFiles.filter(f => f.task_id);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {projectLevel.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Project files</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {projectLevel.map(f => {
                          const confirming = confirmDeleteFile === f.id;
                          return confirming ? (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                              <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, flex: 1 }}>Remove "{f.name.length > 30 ? f.name.slice(0, 30) + '…' : f.name}"?</span>
                              <button onClick={() => handleArchiveFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}>Archive</button>
                              <button onClick={() => handleDeleteFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Delete</button>
                              <button onClick={() => setConfirmDeleteFile(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                            </div>
                          ) : (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
                              <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                                {f.size && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{fmtFileSize(f.size)}</span>}
                              </div>
                              <button onClick={() => setConfirmDeleteFile(f.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }} title="Remove">✕</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {milestoneLevel.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Milestone files</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {milestoneLevel.map(f => {
                          const ms = milestones.find(m => m.id === f.milestone_id);
                          const confirming = confirmDeleteFile === f.id;
                          return (
                            <div key={f.id}>
                              {ms && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>{ms.title}</div>}
                              {confirming ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                                  <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, flex: 1 }}>Remove "{f.name.length > 30 ? f.name.slice(0, 30) + '…' : f.name}"?</span>
                                  <button onClick={() => handleArchiveFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}>Archive</button>
                                  <button onClick={() => handleDeleteFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Delete</button>
                                  <button onClick={() => setConfirmDeleteFile(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
                                  <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                                    {f.size && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{fmtFileSize(f.size)}</span>}
                                  </div>
                                  <button onClick={() => setConfirmDeleteFile(f.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }} title="Remove">✕</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {taskLevel.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Task files</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {taskLevel.map(f => {
                          const task = tasks.find(t => t.id === f.task_id);
                          const confirming = confirmDeleteFile === f.id;
                          return (
                            <div key={f.id}>
                              {task && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>{task.title}</div>}
                              {confirming ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                                  <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, flex: 1 }}>Remove "{f.name.length > 30 ? f.name.slice(0, 30) + '…' : f.name}"?</span>
                                  <button onClick={() => handleArchiveFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}>Archive</button>
                                  <button onClick={() => handleDeleteFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Delete</button>
                                  <button onClick={() => setConfirmDeleteFile(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
                                  <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                                    {f.size && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{fmtFileSize(f.size)}</span>}
                                  </div>
                                  <button onClick={() => setConfirmDeleteFile(f.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }} title="Remove">✕</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Archived files */}
            {archivedFiles.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                <button
                  onClick={() => setArchivedFilesOpen(v => !v)}
                  style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}
                >
                  {archivedFilesOpen ? '▲' : '▼'} Archived ({archivedFiles.length})
                </button>
                {archivedFilesOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {archivedFiles.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--bg)', border: '1px solid var(--border-light)', borderRadius: 8, opacity: 0.6 }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <button onClick={() => handleRestoreFile(f)} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>Restore</button>
                        <button onClick={() => { if (window.confirm(`Permanently delete "${f.name}"?`)) handleDeleteFile(f); }} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Proposals ── */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)' }}>📋 Proposals</div>
              </div>
              {(activeProject.proposals || []).length === 0 && !activeProject.proposal_text && !activeProject.proposal_pdf_url ? (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>No proposals imported yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Legacy single proposal (pre-multi-proposal) */}
                  {(activeProject.proposal_text || activeProject.proposal_pdf_url) && (activeProject.proposals || []).length === 0 && (
                    <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14 }}>📄</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>Original Proposal</div>
                        {activeProject.proposal_text && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{activeProject.proposal_text.slice(0, 80)}…</div>}
                      </div>
                      {activeProject.proposal_pdf_url && (
                        <a href={activeProject.proposal_pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', flexShrink: 0 }}>View PDF</a>
                      )}
                      {/* Delete legacy proposal — clears proposal_text, pdf_url, and description */}
                      <button
                        onClick={async () => {
                          if (!window.confirm('Remove this proposal? The project summary will also be cleared.')) return;
                          const updated = { ...activeProject, proposal_text: null, proposal_pdf_url: null, proposal_page_hints: null, description: null };
                          setActiveProject(updated);
                          await upsertProject(updated);
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                        title="Remove proposal"
                      >✕</button>
                    </div>
                  )}
                  {/* New multi-proposal entries */}
                  {(activeProject.proposals || []).map((p, i) => (
                    <div key={p.id || i} style={{ padding: '10px 14px', background: 'var(--surface)', border: `1px solid ${p.primary ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {p.name}
                          {p.primary && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>Primary</span>}
                        </div>
                        {p.text_excerpt && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.text_excerpt}</div>}
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{new Date(p.created_at).toLocaleDateString()}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                        {p.pdf_url && (
                          <a href={p.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>PDF</a>
                        )}
                        {!p.primary && (
                          <button
                            onClick={async () => {
                              const updated = { ...activeProject, proposals: (activeProject.proposals || []).map((pr, j) => ({ ...pr, primary: j === i })) };
                              setActiveProject(updated);
                              await upsertProject(updated);
                            }}
                            style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >Set primary</button>
                        )}
                        {/* Delete proposal entry */}
                        <button
                          onClick={async () => {
                            if (!window.confirm('Remove this proposal?')) return;
                            const remaining = (activeProject.proposals || []).filter((_, j) => j !== i);
                            // If no proposals left, also clear the raw proposal_text/pdf fields
                            const cleared = remaining.length === 0
                              ? { proposal_text: null, proposal_pdf_url: null, proposal_page_hints: null }
                              : {};
                            const updated = { ...activeProject, proposals: remaining, ...cleared };
                            setActiveProject(updated);
                            await upsertProject(updated);
                          }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                          title="Remove proposal"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── Contacts tab ── */}
        {projectTab === 'contacts' && (
          <ContactsPanel
            clientId={clientRecord?.id}
            companyName={activeProject.client_name}
            contacts={clientRecord?.contacts || []}
            discovered={(() => {
              const addedNames = new Set((clientRecord?.contacts || []).map(c => c.name?.trim().toLowerCase()));
              const pool = new Map();
              // companies.contacts (shared with Watch List/Old Gold/Pipeline) first,
              // then contact_angles layered on top for title/linkedin only.
              [projectCompany, dealCompanyIntel].forEach(company => {
                (company?.contacts || []).forEach(c => {
                  if (!c.name?.trim()) return;
                  const key = c.name.trim().toLowerCase();
                  if (!addedNames.has(key)) pool.set(key, { name: c.name.trim(), title: c.title || '', email: c.email || '', linkedin: c.linkedin || '' });
                });
              });
              [projectCompany, dealCompanyIntel].forEach(company => {
                (company?.contact_angles || []).forEach(c => {
                  if (!c.name?.trim()) return;
                  const key = c.name.trim().toLowerCase();
                  if (addedNames.has(key)) return;
                  const existing = pool.get(key) || {};
                  pool.set(key, { name: c.name.trim(), title: existing.title || c.title || '', email: existing.email || c.email || '', linkedin: existing.linkedin || c.linkedinUrl || c.linkedin || '' });
                });
              });
              return Array.from(pool.values());
            })()}
            onContactsChange={updated => { setClientRecord(cr => cr ? { ...cr, contacts: updated } : cr); triggerProjectThesisRefresh(); }}
          />
        )}


        {/* ── Research tab ── */}
        {projectTab === 'research' && (
          <CompanyIntelPanel
            intel={dealCompanyIntel}
            emptyMessage={`No research found for ${activeProject.client_name || 'this client'}.`}
          />
        )}

        {/* ── Forecast tab ── */}
        {projectTab === 'forecast' && (
          forecastPin && !forecastUnlocked ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 16 }}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Forecast is protected</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  autoFocus
                  type="password"
                  value={forecastPinInput}
                  onChange={e => { setForecastPinInput(e.target.value); setForecastPinError(false); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (forecastPinInput === forecastPin) { setForecastUnlocked(true); setForecastPinInput(''); }
                      else { setForecastPinError(true); setForecastPinInput(''); }
                    }
                  }}
                  placeholder="Enter PIN"
                  style={{ fontSize: 14, padding: '8px 12px', borderRadius: 8, border: `1px solid ${forecastPinError ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--text)', width: 160, textAlign: 'center', letterSpacing: 4 }}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (forecastPinInput === forecastPin) { setForecastUnlocked(true); setForecastPinInput(''); }
                    else { setForecastPinError(true); setForecastPinInput(''); }
                  }}
                >Unlock</button>
              </div>
              {forecastPinError && <div style={{ fontSize: 12, color: '#ef4444' }}>Incorrect PIN</div>}
            </div>
          ) : (
            <ProjectForecast
              tasks={tasks}
              milestones={milestones}
              teamMembers={teamMembers}
              activeProject={activeProject}
              onBudgetChange={val => { setActiveProject(p => ({ ...p, budget: val })); }}
              onBudgetBlur={handleSaveProject}
              open={showEstimate}
              onToggle={() => setShowEstimate(o => !o)}
            />
          )
        )}

        {/* ── Archive pill — bottom right ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 32, paddingBottom: 8 }}>
          <button
            onClick={handleArchiveProject}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 20, border: `1px solid ${confirmDeleteProj ? '#ef4444' : 'var(--accent)'}`, background: confirmDeleteProj ? '#fef2f2' : 'var(--accent)', color: confirmDeleteProj ? '#ef4444' : '#fff', cursor: 'pointer', transition: 'all .15s' }}
          >
            {confirmDeleteProj ? '⚠️ Confirm archive' : '📦 Archive project'}
          </button>
        </div>

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

      {/* Task complete — notify client email draft */}
      {taskCompleteEmail && (() => {
        const { task, project, ms: emailMs } = taskCompleteEmail;
        // Priority: task's explicit portal_contact > milestone's portal_contact > project primary contact
        const clientContacts = clientRecord?.contacts || project.contacts || [];
        const defaultContact = clientContacts.find(c => c.is_primary) || clientContacts[0];
        const primaryContact = task.portal_contact?.name
          ? { name: task.portal_contact.name, email: task.portal_contact.email || '' }
          : emailMs?.portal_contact?.name
            ? { name: emailMs.portal_contact.name, email: emailMs.portal_contact.email || '' }
            : defaultContact;
        const clientName   = (primaryContact?.name || project.client_name || project.contact_name || '').split(' ')[0] || 'there';
        const toEmail      = primaryContact?.email || project.client_email || '';
        const portalUrl    = project.share_token ? `${window.location.origin}/portal/${project.share_token}?task=${task.id}` : null;
        const subject         = `Task complete: ${task.title}`;
        const companyLabel    = project.client_name || project.name;
        const taskAttachments = projectFiles.filter(f => f.task_id === task.id && f.url);
        const filePlainText   = taskAttachments.length
          ? `\n\nAttached files:\n${taskAttachments.map(f => `• ${f.name}: ${f.url}`).join('\n')}`
          : '';
        const fileHtml        = taskAttachments.length
          ? `<p style="font-family:sans-serif;font-size:13px;color:#6b7280;margin-top:16px;">📎 <strong>Attached files</strong></p><p style="font-family:sans-serif;">${taskAttachments.map(f => `<a href="${f.url}" style="display:inline-block;margin:2px 4px 2px 0;padding:3px 10px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;font-size:12px;color:#111;text-decoration:none;font-family:sans-serif;">${f.name}</a>`).join('')}</p>`
          : '';
        const body            = `Hi ${clientName},\n\nA task on your project has been completed and is ready for your review.\n\nTask: ${task.title}\n\n${portalUrl ? `Please visit your project dashboard to review and approve it:\n${portalUrl}\n\n` : ''}Best,\nPart Human${filePlainText}`;
        const htmlBody        = [
          `<p style="font-family:sans-serif;font-size:14px;">Hi ${clientName},</p>`,
          `<p style="font-family:sans-serif;font-size:14px;">A task on your project has been completed and is ready for your review.</p>`,
          `<p style="font-family:sans-serif;font-size:14px;"><strong>Task:</strong> ${task.title}</p>`,
          portalUrl ? `<p style="font-family:sans-serif;font-size:14px;">Please visit your project dashboard to review and approve it:</p><p><a href="${portalUrl}" style="display:inline-block;background:#fbbf24;color:#111;font-weight:800;font-size:13px;padding:6px 14px;border-radius:20px;text-decoration:none;font-family:sans-serif;">PH &times; ${companyLabel}</a></p>` : '',
          `<p style="font-family:sans-serif;font-size:14px;">Best,<br>Part Human</p>`,
          fileHtml,
        ].join('');
        const ccEmails        = extraRecipients.map(c => c.email).filter(Boolean);
        const gmailUrl        = toEmail ? `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(toEmail)}&su=${encodeURIComponent(subject)}${ccEmails.length ? `&cc=${encodeURIComponent(ccEmails.join(','))}` : ''}` : null;
        const allContacts = (clientRecord?.contacts || project.contacts || []).filter(c => c.email && c.email !== toEmail && !extraRecipients.find(r => r.email === c.email));

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => { setTaskCompleteEmail(null); setShowContactDropdown(false); }} />
            <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: '24px 24px 20px', width: 680, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>

              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>📬 Notify client</div>
                <button onClick={() => { setTaskCompleteEmail(null); setShowContactDropdown(false); }} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }}>✕</button>
              </div>

              {/* Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>To</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, alignItems: 'center', minHeight: 38 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {primaryContact ? `${primaryContact.name}${primaryContact.email ? ` <${primaryContact.email}>` : ''}` : toEmail || '—'}
                    </span>
                    {extraRecipients.map(c => (
                      <span key={c.email} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 8px 3px 10px', borderRadius: 20 }}>
                        {c.name || c.email}
                        <button onClick={() => setExtraRecipients(prev => prev.filter(r => r.email !== c.email))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2, display: 'flex', alignItems: 'center' }}>×</button>
                      </span>
                    ))}
                    {allContacts.length > 0 && (
                      <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowContactDropdown(v => !v)} style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 20, padding: '2px 10px', fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ CC contact</button>
                        {showContactDropdown && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 210 }}>
                            {allContacts.map(c => (
                              <button key={c.email} onClick={() => { setExtraRecipients(prev => [...prev, c]); setShowContactDropdown(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{c.email}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Subject</div>
                  <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)' }}>{subject}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Message</div>
                  <div style={{ fontSize: 12, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', lineHeight: 1.65, maxHeight: 'none' }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{`Hi ${clientName},\n\nA task on your project has been completed and is ready for your review.\n\nTask: ${task.title}\n\n${portalUrl ? 'Please visit your project dashboard to review and approve it:\n' : ''}`}</div>
                    {portalUrl && (
                      <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fbbf24', color: '#111', fontWeight: 800, fontSize: 12, padding: '5px 12px', borderRadius: 20, textDecoration: 'none', margin: '6px 0 8px', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                        <span style={{ fontWeight: 900, fontSize: 13 }}>PH</span><span>×</span><span>{companyLabel}</span>
                      </a>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{`\nBest,\nPart Human`}</div>
                    {taskAttachments.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 5 }}>📎 Attached files</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {taskAttachments.map(f => (
                            <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, color: '#111', textDecoration: 'none' }}
                            >{fileIcon(f.mime_type)} {f.name}</a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {portalUrl && <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>💡 Once Gmail opens, paste to drop in the styled message</div>}

              {/* Footer */}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 14, gap: 10 }}>
                {/* Approve internally escape hatch */}
                <button
                  onClick={async () => {
                    await approveTask(task.id, 'Internal');
                    const now = new Date().toISOString();
                    const patch = t => t.id === task.id ? { ...t, approved_at: now, approved_by: 'Internal' } : t;
                    setTasks(prev => prev.map(patch));
                    setAllTasks(prev => ({ ...prev, [project.id]: (prev[project.id] || []).map(patch) }));
                    setAssignedTasks(prev => prev.map(patch));
                    setTaskCompleteEmail(null);
                  }}
                  style={{ fontSize: 11, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline', textUnderlineOffset: 2, flexShrink: 0 }}
                >Approve internally</button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlBody], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) })]); }
                    catch { navigator.clipboard.writeText(body); }
                  }}
                  style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >Copy</button>
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlBody], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) })]); }
                    catch { /* skip */ }
                    try {
                      const chain = await addToReviewChain(task.id, { type: 'sent', by: 'Part Human' });
                      const chainPatch = t => t.id === task.id ? { ...t, review_chain: chain } : t;
                      setTasks(prev => prev.map(chainPatch));
                      setAllTasks(prev => ({ ...prev, [project.id]: (prev[project.id] || []).map(chainPatch) }));
                    } catch { /* non-fatal */ }
                    window.open(gmailUrl, '_blank');
                    setTaskCompleteEmail(null);
                  }}
                  style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >Open in Gmail ↗</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Meeting summary email modal ── */}
      {meetingSummaryEmail && (() => {
        const { meeting, savedTasks, project, importNote } = meetingSummaryEmail;
        const primaryContact = (clientRecord?.contacts || project.contacts || []).find(c => c.is_primary) || (clientRecord?.contacts || project.contacts || [])[0];
        const clientName     = (primaryContact?.name || project.client_name || project.contact_name || '').split(' ')[0] || 'there';
        const toEmail        = primaryContact?.email || project.client_email || '';
        const companyLabel   = project.client_name || project.name || '';
        const portalUrl      = project.share_token ? `${window.location.origin}/portal/${project.share_token}` : null;
        const subject        = `Meeting summary: ${meeting.title || 'our meeting'}`;
        const taskLines      = savedTasks.map(t => `• ${t.title}`).join('\n');
        const taskHtml       = savedTasks.map(t => `<li style="font-family:sans-serif;font-size:13px;margin:4px 0;color:#374151;">${t.title}</li>`).join('');
        const intro          = `Thanks for the time today. Here's a quick summary of what we covered and the next steps we've lined up.`;
        const body           = `Hi ${clientName},\n\n${intro}\n\nNEXT STEPS:\n${taskLines}\n\n${portalUrl ? `You can track progress in your project portal:\n${portalUrl}\n\n` : ''}Best,\nPart Human`;
        const htmlBody       = [
          `<p style="font-family:sans-serif;font-size:14px;">Hi ${clientName},</p>`,
          `<p style="font-family:sans-serif;font-size:14px;">${intro}</p>`,
          `<p style="font-family:sans-serif;font-size:13px;font-weight:700;color:#111;margin-bottom:4px;">NEXT STEPS</p>`,
          `<ul style="margin:0 0 12px;padding-left:18px;">${taskHtml}</ul>`,
          portalUrl ? `<p style="font-family:sans-serif;font-size:14px;">You can track progress in your project portal:</p><p><a href="${portalUrl}" style="display:inline-block;background:#fbbf24;color:#111;font-weight:800;font-size:13px;padding:6px 14px;border-radius:20px;text-decoration:none;font-family:sans-serif;">PH &times; ${companyLabel}</a></p>` : '',
          `<p style="font-family:sans-serif;font-size:14px;">Best,<br>Part Human</p>`,
        ].join('');
        const gmailUrl = toEmail ? `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(toEmail)}&su=${encodeURIComponent(subject)}` : null;

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => setMeetingSummaryEmail(null)} />
            <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: '24px 24px 20px', width: 680, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>

              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Send meeting summary?</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>{meeting.title || 'Meeting'} · {meeting.meeting_date || ''}</div>
                </div>
                <button onClick={() => setMeetingSummaryEmail(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }}>✕</button>
              </div>

              {/* Import note badge */}
              {importNote && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px', fontSize: 11, color: 'var(--text-faint)', marginBottom: 14 }}>
                  ✅ {importNote}
                </div>
              )}

              {/* Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>To</div>
                  <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)' }}>
                    {primaryContact ? `${primaryContact.name}${primaryContact.email ? ` <${primaryContact.email}>` : ''}` : toEmail || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>No contact email on file</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Subject</div>
                  <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)' }}>{subject}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Message</div>
                  <div style={{ fontSize: 12, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{`Hi ${clientName},\n\n${intro}\n\nNEXT STEPS`}</div>
                    <ul style={{ margin: '6px 0 10px', paddingLeft: 18 }}>
                      {savedTasks.map((t, i) => (
                        <li key={i} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 3 }}>{t.title}</li>
                      ))}
                    </ul>
                    {portalUrl ? (
                      <>
                        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{'You can track progress in your project portal:'}</div>
                        <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fbbf24', color: '#111', fontWeight: 800, fontSize: 12, padding: '5px 12px', borderRadius: 20, textDecoration: 'none', margin: '8px 0 10px', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                          <span style={{ fontWeight: 900, fontSize: 13 }}>PH</span><span>×</span><span>{companyLabel}</span>
                        </a>
                        <br />
                      </>
                    ) : null}
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{`\nBest,\nPart Human`}</div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 16, gap: 10 }}>
                <button
                  onClick={() => setMeetingSummaryEmail(null)}
                  style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >Skip</button>
                {toEmail ? (
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlBody], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) })]); }
                      catch { navigator.clipboard.writeText(body); }
                      window.open(gmailUrl, '_blank');
                      setMeetingSummaryEmail(null);
                    }}
                    style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >Open in Gmail ↗</button>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>Add an email to this project's primary contact to send</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Resend revised update modal */}
      {resendEmail && (() => {
        const { task, project, ms: resendMs } = resendEmail;
        const _resendContacts   = clientRecord?.contacts || project?.contacts || [];
        const _resendDefault    = _resendContacts.find(c => c.is_primary) || _resendContacts[0];
        const primaryContact    = task.portal_contact?.name
          ? { name: task.portal_contact.name, email: task.portal_contact.email || '' }
          : resendMs?.portal_contact?.name
            ? { name: resendMs.portal_contact.name, email: resendMs.portal_contact.email || '' }
            : _resendDefault;
        const clientName        = (primaryContact?.name || project?.client_name || '').split(' ')[0] || 'there';
        const toEmail           = primaryContact?.email || project?.client_email || '';
        const companyLabel      = project?.client_name || project?.name || '';
        const portalUrl         = project?.share_token ? `${window.location.origin}/portal/${project.share_token}?task=${task.id}` : null;
        const revNum            = ((task.review_chain || []).filter(e => e.type === 'revised_sent').length) + 1;
        const subject           = `Revision ${revNum} ready: ${task.title}`;
        const taskAttachments   = projectFiles.filter(f => f.task_id === task.id && f.url);
        const aiResponse        = task.rejection_response || '';
        const messageBody       = aiResponse
          ? `${aiResponse} Please click the link below to review.`
          : `A revision has been made to your project. Please click the link below to review and approve it.`;
        // Plain-text file list appended after sign-off
        const filePlainText     = taskAttachments.length
          ? `\n\nAttached files:\n${taskAttachments.map(f => `• ${f.name}: ${f.url}`).join('\n')}`
          : '';
        const body              = `Hi ${clientName},\n\n${messageBody}\n\n${portalUrl ? `${portalUrl}\n\n` : ''}Best,\nPart Human${filePlainText}`;
        // HTML file list — styled link pills
        const fileHtml          = taskAttachments.length
          ? `<p style="font-family:sans-serif;font-size:13px;color:#6b7280;margin-top:16px;">📎 <strong>Attached files</strong></p><p style="font-family:sans-serif;">${taskAttachments.map(f => `<a href="${f.url}" style="display:inline-block;margin:2px 4px 2px 0;padding:3px 10px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;font-size:12px;color:#111;text-decoration:none;font-family:sans-serif;">${f.name}</a>`).join('')}</p>`
          : '';
        const htmlBody          = [
          `<p style="font-family:sans-serif;font-size:14px;">Hi ${clientName},</p>`,
          `<p style="font-family:sans-serif;font-size:14px;">${messageBody.replace(/\n/g, '<br>')}</p>`,
          portalUrl ? `<p><a href="${portalUrl}" style="display:inline-block;background:#fbbf24;color:#111;font-weight:800;font-size:13px;padding:6px 14px;border-radius:20px;text-decoration:none;font-family:sans-serif;">PH &times; ${companyLabel}</a></p>` : '',
          `<p style="font-family:sans-serif;font-size:14px;">Best,<br>Part Human</p>`,
          fileHtml,
        ].join('');
        const ccEmailsResend = extraRecipients.map(c => c.email).filter(Boolean);
        const gmailUrl = toEmail ? `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(toEmail)}&su=${encodeURIComponent(subject)}${ccEmailsResend.length ? `&cc=${encodeURIComponent(ccEmailsResend.join(','))}` : ''}` : null;
        const allContactsResend = (project?.contacts || []).filter(c => c.email && c.email !== toEmail && !extraRecipients.find(r => r.email === c.email));

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => { setResendEmail(null); setShowContactDropdown(false); }} />
            <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: '28px 28px 24px', width: 500, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>📤 Send Revision {revNum}</div>
                <button onClick={() => { setResendEmail(null); setShowContactDropdown(false); }} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>To</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, alignItems: 'center', minHeight: 38 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {primaryContact ? `${primaryContact.name}${primaryContact.email ? ` <${primaryContact.email}>` : ''}` : toEmail || '—'}
                    </span>
                    {extraRecipients.map(c => (
                      <span key={c.email} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 8px 3px 10px', borderRadius: 20 }}>
                        {c.name || c.email}
                        <button onClick={() => setExtraRecipients(prev => prev.filter(r => r.email !== c.email))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2, display: 'flex', alignItems: 'center' }}>×</button>
                      </span>
                    ))}
                    {allContactsResend.length > 0 && (
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setShowContactDropdown(v => !v)}
                          style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 20, padding: '2px 10px', fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >+ CC contact</button>
                        {showContactDropdown && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 210 }}>
                            {allContactsResend.map(c => (
                              <button
                                key={c.email}
                                onClick={() => { setExtraRecipients(prev => [...prev, c]); setShowContactDropdown(false); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                              >
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{c.email}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Subject</div>
                  <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)' }}>{subject}</div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Message</div>
                    {generatingResponse === task.id && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>✦ Writing response…</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', lineHeight: 1.65 }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{`Hi ${clientName},\n\n${messageBody}\n\n`}</div>
                    {portalUrl ? (
                      <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fbbf24', color: '#111', fontWeight: 800, fontSize: 12, padding: '5px 12px', borderRadius: 20, textDecoration: 'none', margin: '2px 0 8px' }}>
                        <span style={{ fontWeight: 900, fontSize: 13 }}>PH</span><span>×</span><span>{companyLabel}</span>
                      </a>
                    ) : <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>No portal link — set up a client portal to enable this</span>}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{`\nBest,\nPart Human`}</div>
                    {taskAttachments.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 6 }}>📎 Attached files</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {taskAttachments.map(f => (
                            <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '2px 9px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                              {f.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {portalUrl && (
                <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
                  💡 Once Gmail opens, just paste to drop in the styled message
                </div>
              )}
              {/* Project notes — shown as context before sending */}
              {project?.internal_notes && (
                <div style={{ marginTop: 12, padding: '9px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 7, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>📌</span>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Project Notes</div>
                    <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{project.internal_notes}</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlBody], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) })]);
                    } catch { navigator.clipboard.writeText(body); }
                  }}
                  style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >Copy</button>
                {gmailUrl && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlBody], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) })]);
                      } catch { /* skip */ }
                      // Record "revised_sent" event in chain, then clear rejection fields
                      // so the portal resets to "awaiting approval" for the revised work.
                      try {
                        const chain = await addToReviewChain(task.id, { type: 'revised_sent', by: 'Part Human', response: messageBody });
                        await clearRejectionFields(task.id);
                        const patchTask = t => t.id === task.id
                          ? { ...t, review_chain: chain, rejected_at: null, rejected_by: null, rejection_notes: null }
                          : t;
                        setTasks(prev => prev.map(patchTask));
                        setAllTasks(prev => {
                          const pid = project?.id;
                          if (!pid) return prev;
                          return { ...prev, [pid]: (prev[pid] || []).map(patchTask) };
                        });
                        setAssignedTasks(prev => prev.map(patchTask));
                      } catch { /* non-fatal */ }
                      window.open(gmailUrl, '_blank');
                      setResendEmail(null);
                    }}
                    style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >Open in Gmail ↗</button>
                )}
              </div>
            </div>
          </div>
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

      {/* Transcript importer modal */}
      {/* ── Action Item → Task modal ── */}
      {actionItemDraft && activeProject && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setActionItemDraft(null)} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: 24, width: 440, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.18)' }}>
            <button
              onClick={() => setActionItemDraft(null)}
              style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1, padding: '2px 6px' }}
            >✕</button>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Add as Task</h3>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 18, lineHeight: 1.4 }}>
              Edit the details below and click <strong>Add to Tasks</strong> to push this to the Tasks tab.
            </p>

            {/* Title */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Task title</label>
              <textarea
                autoFocus
                rows={2}
                value={actionItemDraft.title}
                onChange={e => {
                  setActionItemDraft(d => ({ ...d, title: e.target.value }));
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', resize: 'none', lineHeight: 1.5, overflow: 'hidden', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {/* Assigned to */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Assign to</label>
                <select
                  value={actionItemDraft.assigned_to}
                  onChange={e => setActionItemDraft(d => ({ ...d, assigned_to: e.target.value }))}
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  <option value="">Unassigned</option>
                  <optgroup label="Team">{owners.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>
                  {clientTaskContacts.length > 0 && <optgroup label="Client">{clientTaskContacts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
                </select>
              </div>
              {/* Estimated hours */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Est. hours</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 2"
                  value={actionItemDraft.estimated_hours}
                  onChange={e => setActionItemDraft(d => ({ ...d, estimated_hours: e.target.value }))}
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                />
              </div>
            </div>

            {/* Due date */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>
                Due date <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-faint)' }}>(suggested — edit freely)</span>
              </label>
              <input
                type="date"
                value={actionItemDraft.due_date || ''}
                onChange={e => setActionItemDraft(d => ({ ...d, due_date: e.target.value }))}
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              />
            </div>

            {/* Milestone */}
            {milestones.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Milestone</label>
                <select
                  value={actionItemDraft.milestone_id || ''}
                  onChange={e => setActionItemDraft(d => ({ ...d, milestone_id: e.target.value || null }))}
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  <option value="">No milestone (unassigned)</option>
                  {milestones.map(ms => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
                </select>
              </div>
            )}

            {/* Similarity warning — live as user edits the title */}
            {(() => {
              const similar = actionItemDraft.title.trim() ? findSimilarTasks(actionItemDraft.title.trim()) : [];
              if (!similar.length) return null;
              return (
                <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fcd34d' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠️ Similar task{similar.length > 1 ? 's' : ''} already exist</div>
                  {similar.map(t => (
                    <div key={t.id} style={{ fontSize: 11, color: '#78350f', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10 }}>•</span>
                      <span>{t.title}</span>
                      {t.assigned_to && <span style={{ fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 3, background: t.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: t.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{t.assigned_to}</span>}
                      {t.completed && <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>✓ done</span>}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>You can still add it — just making sure it's intentional.</div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={pushingActionItem || !actionItemDraft.title.trim()}
                onClick={async () => {
                  setPushingActionItem(true);
                  try {
                    const saved = await upsertProjectTask({
                      project_id:      activeProject.id,
                      milestone_id:    actionItemDraft.milestone_id || null,
                      title:           actionItemDraft.title.trim(),
                      assigned_to:     actionItemDraft.assigned_to || '',
                      estimated_hours: actionItemDraft.estimated_hours !== '' && actionItemDraft.estimated_hours != null ? parseFloat(actionItemDraft.estimated_hours) : null,
                      due_date:        actionItemDraft.due_date || null,
                      completed:       false,
                      order_index:     tasks.filter(t => t.milestone_id === (actionItemDraft.milestone_id || null)).length,
                      created_at:      new Date().toISOString(),
                    });
                    const updated = [...tasks, saved];
                    setTasks(updated);
                    setAllTasks(prev => ({ ...prev, [activeProject.id]: updated }));
                    setActionItemDraft(null);
                  } catch(e) { alert(e.message); } finally { setPushingActionItem(false); }
                }}
                style={{ borderRadius: 20, flex: 1 }}
              >
                {pushingActionItem ? 'Adding…' : '➕ Add to Tasks'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setActionItemDraft(null)} style={{ borderRadius: 20 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending task updates from AI cross-reference ── */}
      {pendingUpdates.length > 0 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1010, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setPendingUpdates([])} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: 24, width: 520, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.18)', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>🔄 Suggested Task Updates</h3>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
              The AI noticed these possible updates to existing tasks based on the new meeting. Check the ones you'd like to apply.
            </p>
            {pendingUpdates.map((u, i) => (
              <div key={i} style={{ padding: '12px 14px', borderRadius: 8, border: `1px solid ${u.accepted ? 'var(--accent)' : 'var(--border)'}`, background: u.accepted ? 'var(--accent-light, #ede9fe)' : 'var(--surface)', marginBottom: 8, cursor: 'pointer' }} onClick={() => setPendingUpdates(prev => prev.map((x, xi) => xi === i ? { ...x, accepted: !x.accepted } : x))}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={u.accepted} onChange={() => {}} style={{ marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{u.existing_task_title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.04em', color: 'var(--accent)' }}>{u.field}</span>
                      {' '}&rarr;{' '}
                      <span style={{ fontWeight: 600 }}>{u.suggested_value}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>{u.reason}</div>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-primary btn-sm"
                style={{ borderRadius: 20, flex: 1 }}
                onClick={async () => {
                  const accepted = pendingUpdates.filter(u => u.accepted);
                  for (const u of accepted) {
                    const task = tasks.find(t => t.title?.toLowerCase().trim() === u.existing_task_title?.toLowerCase().trim());
                    if (!task) continue;
                    const patch = { [u.field]: u.suggested_value };
                    const updated = { ...task, ...patch };
                    try {
                      await upsertProjectTask(updated);
                      const patchFn = t => t.id === task.id ? updated : t;
                      setTasks(prev => prev.map(patchFn));
                      setAllTasks(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] || []).map(patchFn) }));
                    } catch (e) { console.error('Update failed:', e.message); }
                  }
                  setPendingUpdates([]);
                }}
              >Apply {pendingUpdates.filter(u => u.accepted).length} update{pendingUpdates.filter(u => u.accepted).length !== 1 ? 's' : ''}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setPendingUpdates([])} style={{ borderRadius: 20 }}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task mentions panel ── */}
      {mentionsPanel && (() => {
        const taskTitle = mentionsPanel.title?.toLowerCase() || '';
        const sig = str => str.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
        const taskWords = new Set(sig(mentionsPanel.title || ''));
        const scoreMeeting = (mtg) => {
          const fields = [mtg.title || '', mtg.summary || '', mtg.transcript || '', ...(mtg.action_items || []).map(ai => ai.title || '')];
          const fullText = fields.join(' ').toLowerCase();
          if (fullText.includes(taskTitle)) return 2; // direct hit
          const words = sig(fullText);
          const overlap = words.filter(w => taskWords.has(w)).length;
          return overlap / Math.max(taskWords.size, 1) >= 0.4 ? 1 : 0;
        };
        const matchingMeetings = meetings.map(m => ({ mtg: m, score: scoreMeeting(m) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

        // Find the snippet within a field that contains the task mention
        const getSnippet = (text, maxLen = 200) => {
          if (!text) return null;
          const lower = text.toLowerCase();
          const idx = lower.indexOf(taskTitle);
          if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '');
          const start = Math.max(0, idx - 60);
          const end   = Math.min(text.length, idx + taskTitle.length + 140);
          return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        };

        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 850, background: 'rgba(0,0,0,0.2)' }} onClick={() => { setMentionsPanel(null); setExpandedTranscripts(new Set()); setTranscriptHighlight({}); }} />
            <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 860, width: 460, maxWidth: '92vw', background: 'var(--bg)', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)' }}>
              {/* Header */}
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Meeting Mentions</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>{mentionsPanel.title}</div>
                  </div>
                  <button onClick={() => { setMentionsPanel(null); setExpandedTranscripts(new Set()); setTranscriptHighlight({}); }} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px', lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
                  {matchingMeetings.length === 0 ? 'No meetings mention this task yet.' : `Found in ${matchingMeetings.length} meeting${matchingMeetings.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              {/* Mention list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                {matchingMeetings.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)', fontSize: 13 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
                    <div>This task hasn't appeared in any meeting notes yet.</div>
                    <div style={{ fontSize: 11, marginTop: 6 }}>Mentions will show up here when a meeting transcript or summary references this task.</div>
                  </div>
                ) : matchingMeetings.map(({ mtg, score }) => {
                  const dateStr = mtg.meeting_date ? new Date(mtg.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : null;
                  // Find which fields contain the mention
                  const matchingActionItems = (mtg.action_items || []).filter(ai => ai.title?.toLowerCase().includes(taskTitle) || sig(ai.title || '').some(w => taskWords.has(w)));
                  const summarySnippet   = mtg.summary?.toLowerCase().includes(taskTitle) || sig(mtg.summary || '').some(w => taskWords.has(w)) ? getSnippet(mtg.summary) : null;
                  const transcriptSnippet = mtg.transcript?.toLowerCase().includes(taskTitle) ? getSnippet(mtg.transcript) : null;
                  return (
                    <div key={mtg.id} style={{ marginBottom: 20, padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                      {/* Meeting header */}
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{mtg.title}</div>
                      {dateStr && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 10 }}>{dateStr}{mtg.meeting_time ? ` · ${mtg.meeting_time}` : ''}{mtg.attendees?.length ? ` · ${mtg.attendees.join(', ')}` : ''}</div>}
                      {/* Action item matches — click any to jump to it in the transcript */}
                      {matchingActionItems.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Action Items</div>
                          {matchingActionItems.map((ai, i) => (
                            <div
                              key={i}
                              onClick={() => {
                                if (!mtg.transcript) return;
                                setTranscriptHighlight(prev => ({ ...prev, [mtg.id]: ai.title }));
                                setExpandedTranscripts(prev => { const n = new Set(prev); n.add(mtg.id); return n; });
                              }}
                              style={{ fontSize: 12, color: 'var(--text)', padding: '4px 8px', borderRadius: 6, background: 'var(--accent-light, #ede9fe)', marginBottom: 3, display: 'flex', gap: 6, cursor: mtg.transcript ? 'pointer' : 'default' }}
                              title={mtg.transcript ? 'Click to jump to this point in the transcript' : ''}
                            >
                              {ai.owner && <span style={{ fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{ai.owner}</span>}
                              <span style={{ flex: 1 }}>{ai.title}</span>
                              {ai.due_date && <span style={{ color: 'var(--text-faint)', flexShrink: 0, fontSize: 10 }}>{ai.due_date}</span>}
                              {mtg.transcript && <span style={{ color: 'var(--accent)', flexShrink: 0, fontSize: 10, opacity: 0.7 }}>→ transcript</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Summary snippet */}
                      {summarySnippet && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Summary</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, fontStyle: 'italic' }}>"{summarySnippet}"</div>
                        </div>
                      )}
                      {/* Transcript — show when available; expand on click or action item tap */}
                      {mtg.transcript && (() => {
                        const isExpanded = expandedTranscripts.has(mtg.id);
                        const searchTerm = (transcriptHighlight[mtg.id] || taskTitle).toLowerCase();
                        const transcript = mtg.transcript;

                        const renderHighlighted = (text) => {
                          const lower = text.toLowerCase();
                          const idx = lower.indexOf(searchTerm);
                          if (idx === -1) return <span>{text}</span>;
                          return (
                            <>
                              <span>{text.slice(0, idx)}</span>
                              <mark
                                ref={el => {
                                  if (!el) return;
                                  // Scroll within the overflow container, not the viewport
                                  const container = el.closest('[data-transcript-scroll]');
                                  if (container) {
                                    const markOffset = el.offsetTop - container.offsetTop;
                                    container.scrollTop = Math.max(0, markOffset - container.clientHeight / 2 + el.offsetHeight);
                                  }
                                }}
                                style={{ background: '#fef08a', color: '#713f12', borderRadius: 2, padding: '0 2px', fontWeight: 700 }}
                              >{text.slice(idx, idx + searchTerm.length)}</mark>
                              <span>{text.slice(idx + searchTerm.length)}</span>
                            </>
                          );
                        };

                        return (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Transcript</div>
                              <button
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedTranscripts(prev => { const n = new Set(prev); n.delete(mtg.id); return n; });
                                  } else {
                                    setTranscriptHighlight(prev => ({ ...prev, [mtg.id]: taskTitle }));
                                    setExpandedTranscripts(prev => { const n = new Set(prev); n.add(mtg.id); return n; });
                                  }
                                }}
                                style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                              >{isExpanded ? '↑ Collapse' : '↓ View in transcript'}</button>
                            </div>
                            {isExpanded && (
                              <div
                                data-transcript-scroll=""
                                style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.75, fontFamily: 'monospace', background: 'var(--bg)', padding: '10px 12px', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 380, overflowY: 'auto', position: 'relative' }}
                              >
                                {renderHighlighted(transcript)}
                              </div>
                            )}
                            {!isExpanded && transcriptSnippet && (
                              <div
                                onClick={() => { setTranscriptHighlight(prev => ({ ...prev, [mtg.id]: taskTitle })); setExpandedTranscripts(prev => { const n = new Set(prev); n.add(mtg.id); return n; }); }}
                                style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.65, fontFamily: 'monospace', background: 'var(--bg)', padding: '8px 10px', borderRadius: 6, whiteSpace: 'pre-wrap', cursor: 'pointer' }}
                                title="Click to view full transcript"
                              >{transcriptSnippet}</div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      {showTranscriptImporter && activeProject && (
        <TranscriptImporter
          projectId={activeProject.id}
          milestones={milestones}
          owners={owners}
          existingTasks={tasks}
          defaultMsId={transcriptDefaultMs}
          initialTranscript={meetingsInitialTranscript}
          onImported={handleTranscriptImported}
          onClose={() => { setShowTranscriptImporter(false); setTranscriptDefaultMs(null); setMeetingsInitialTranscript(''); }}
        />
      )}

      {/* Client Portal share modal */}
      {showShareModal && activeProject && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => { setShowShareModal(false); setPortalEmailDraft(null); }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: 28, width: 500, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.18)' }}>
            <button
              onClick={() => { setShowShareModal(false); setPortalEmailDraft(null); }}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1, padding: '2px 6px' }}
            >✕</button>

            {/* ── Email compose view (after saving) ── */}
            {portalEmailDraft ? (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>📬 Share portal with client</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>To</div>
                    <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)' }}>
                      {portalEmailDraft.contactName ? `${portalEmailDraft.contactName} <${portalEmailDraft.to}>` : portalEmailDraft.to}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Subject</div>
                    <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)' }}>{portalEmailDraft.subject}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Message</div>
                    <div style={{ fontSize: 12, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-muted)', lineHeight: 1.65 }}
                      dangerouslySetInnerHTML={{ __html: portalEmailDraft.htmlBody }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10, textAlign: 'right' }}>💡 Once Gmail opens, paste to drop in the styled message</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                  <button onClick={() => setPortalEmailDraft(null)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>← Back</button>
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([portalEmailDraft.htmlBody], { type: 'text/html' }), 'text/plain': new Blob([portalEmailDraft.body], { type: 'text/plain' }) })]); }
                      catch { navigator.clipboard.writeText(portalEmailDraft.body); }
                    }}
                    style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >Copy</button>
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([portalEmailDraft.htmlBody], { type: 'text/html' }), 'text/plain': new Blob([portalEmailDraft.body], { type: 'text/plain' }) })]); }
                      catch { navigator.clipboard.writeText(portalEmailDraft.body); }
                      window.open(portalEmailDraft.gmailUrl, '_blank');
                      setPortalEmailDraft(null);
                      setShowShareModal(false);
                    }}
                    style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >Open in Gmail ↗</button>
                </div>
              </>
            ) : (<>

            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>🔗 Client Portal</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              Share a read-only project view with your client. They'll see the timeline, milestones, tasks, and files — nothing internal.
            </p>

            {/* Portal URL */}
            <div style={{ marginBottom: 16 }}>
              <Lbl>Portal URL</Lbl>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <div style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--surface-2)', fontFamily: 'monospace', fontSize: 12,
                  color: shareToken ? 'var(--text)' : 'var(--text-faint)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center',
                }}>
                  {shareToken
                    ? `${window.location.origin}/portal/${shareToken}`
                    : `${window.location.origin}/portal/[save to generate]`}
                </div>
                <button
                  onClick={() => {
                    if (!shareToken) return;
                    navigator.clipboard.writeText(`${window.location.origin}/portal/${shareToken}`);
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 2000);
                  }}
                  disabled={!shareToken}
                  style={{
                    padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border)',
                    background: shareCopied ? '#d1fae5' : 'var(--surface)',
                    color: shareCopied ? '#10b981' : 'var(--text-muted)',
                    cursor: shareToken ? 'pointer' : 'default',
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'all .15s',
                  }}
                >{shareCopied ? '✓ Copied!' : 'Copy Link'}</button>
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 16 }}>
              <Lbl>Password (optional)</Lbl>
              <input
                type="text"
                value={sharePassword}
                onChange={e => setSharePassword(e.target.value)}
                placeholder="Leave blank for link-only access"
                style={{ width: '100%' }}
              />
            </div>

            {/* Client email */}
            <div style={{ marginBottom: 24 }}>
              <Lbl>Client email</Lbl>
              {(() => {
                const portalContacts = (clientRecord?.contacts || []).slice().sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
                if (portalContacts.length > 0) {
                  return (
                    <select
                      value={shareClientEmail}
                      onChange={e => setShareClientEmail(e.target.value)}
                      style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                    >
                      <option value="">— Select a contact —</option>
                      {portalContacts.map(c => (
                        <option key={c.email || c.name} value={c.email || ''}>
                          {c.name}{c.is_primary ? ' (Primary)' : ''}{c.email ? ` — ${c.email}` : ' — no email'}
                        </option>
                      ))}
                    </select>
                  );
                }
                return (
                  <input
                    type="email"
                    value={shareClientEmail}
                    onChange={e => setShareClientEmail(e.target.value)}
                    placeholder="client@company.com"
                    style={{ width: '100%' }}
                  />
                );
              })()}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {shareToken && (
                <a
                  href={`${window.location.origin}/portal/${shareToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', marginRight: 'auto' }}
                >
                  ↗ Open Portal
                </a>
              )}
              <button
                onClick={() => setShowShareModal(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
              >Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSaveShare}
                disabled={shareSaving}
                style={{ minWidth: 90 }}
              >
                {shareSaving ? 'Sharing…' : shareSaved ? '✓ Shared!' : 'Share Portal'}
              </button>
            </div>

            {portalShareLog.length > 0 && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
                {[...portalShareLog].reverse().map((entry, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-faint)', padding: '2px 0' }}>
                    Shared with {entry.email} on {new Date(entry.sharedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}
                  </div>
                ))}
              </div>
            )}
          </>)}
          </div>
        </div>
      )}
    </>
  );
}

// ── Project Forecast ──────────────────────────────────────────────────────────

function ProjectForecast({ tasks, milestones = [], teamMembers, activeProject, onBudgetChange, onBudgetBlur, open, onToggle }) {
  const [activeTab, setActiveTab] = useState('estimate');
  const memberMap = Object.fromEntries((teamMembers || []).map(m => [m.name, m]));

  const fmt$   = n => n >= 0 ? `$${Math.round(n).toLocaleString('en-US')}` : `-$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  const fmtHrs = n => `${parseFloat(n.toFixed(1))}h`;
  const marginColor = m => m == null ? 'var(--text-faint)' : m >= 50 ? '#10b981' : m >= 25 ? '#f59e0b' : '#ef4444';
  const budgetColor = pct => pct == null ? 'var(--text-faint)' : pct <= 80 ? '#10b981' : pct <= 100 ? '#f59e0b' : '#ef4444';

  // ── Per-person rollup ────────────────────────────────────────────────────────
  const byPerson = {};
  let unestimated = 0;

  tasks.forEach(task => {
    if (task.deleted_at) return;
    const hrs = parseFloat(task.estimated_hours);
    if (!hrs) { unestimated++; return; }
    const name   = task.assigned_to || '(Unassigned)';
    const member = memberMap[name] || {};
    if (!byPerson[name]) byPerson[name] = {
      name,
      tasks: 0, hours: 0, hoursDone: 0, hoursLeft: 0,
      billRate: parseFloat(member.hourlyRate) || 0,
      costRate: parseFloat(member.costRate)   || 0,
    };
    byPerson[name].tasks++;
    byPerson[name].hours    += hrs;
    byPerson[name].hoursDone += task.completed ? hrs : 0;
    byPerson[name].hoursLeft += task.completed ? 0   : hrs;
  });

  const rows         = Object.values(byPerson).sort((a, b) => b.hours - a.hours);
  const totalHours   = rows.reduce((s, r) => s + r.hours, 0);
  const totalDone    = rows.reduce((s, r) => s + r.hoursDone, 0);
  const totalLeft    = rows.reduce((s, r) => s + r.hoursLeft, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.hours * r.billRate, 0);
  const totalCost    = rows.reduce((s, r) => s + r.hours * r.costRate, 0);
  const totalProfit  = totalRevenue - totalCost;
  const margin       = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : null;

  const hasBillRates = rows.some(r => r.billRate > 0);
  const hasCostRates = rows.some(r => r.costRate > 0);
  const hasProfit    = hasBillRates && hasCostRates;

  // ── Budget ───────────────────────────────────────────────────────────────────
  const budget     = parseFloat(activeProject?.budget) || 0;
  const budgetPct  = budget > 0 && totalRevenue > 0 ? (totalRevenue / budget) * 100 : null;
  const budgetVar  = budget > 0 ? budget - totalRevenue : null;

  // ── By-phase rollup ──────────────────────────────────────────────────────────
  const msMap = Object.fromEntries(milestones.map(m => [m.id, m]));
  const byPhase = {};

  tasks.forEach(task => {
    if (task.deleted_at) return;
    const hrs = parseFloat(task.estimated_hours);
    if (!hrs) return;
    const key    = task.milestone_id || '__none__';
    const label  = task.milestone_id ? (msMap[task.milestone_id]?.title || 'Unknown Phase') : 'No Phase';
    const member = memberMap[task.assigned_to] || {};
    if (!byPhase[key]) byPhase[key] = { label, tasks: 0, hours: 0, cost: 0, revenue: 0, order: task.milestone_id ? (msMap[task.milestone_id]?.order_index ?? 999) : 1000 };
    byPhase[key].tasks++;
    byPhase[key].hours   += hrs;
    byPhase[key].cost    += hrs * (parseFloat(member.costRate)   || 0);
    byPhase[key].revenue += hrs * (parseFloat(member.hourlyRate) || 0);
  });

  const phaseRows = Object.values(byPhase).sort((a, b) => a.order - b.order);

  // ── Collapsed summary ────────────────────────────────────────────────────────
  const doneBarPct = totalHours > 0 ? (totalDone / totalHours) * 100 : 0;
  const summary = totalHours > 0
    ? [
        `${fmtHrs(totalHours)} estimated`,
        totalDone > 0 ? `${fmtHrs(totalDone)} done` : null,
        hasBillRates && totalRevenue > 0 ? `${fmt$(totalRevenue)} revenue` : null,
        hasProfit && margin != null ? `${Math.round(margin)}% margin` : null,
        unestimated > 0 ? `${unestimated} unestimated` : null,
      ].filter(Boolean).join(' · ')
    : 'No hours estimated — edit tasks to add estimates';

  // ── Sub-components ───────────────────────────────────────────────────────────
  const ColHdr = ({ children, align = 'left', title: tt }) => (
    <div title={tt} style={{ padding: '7px 14px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', textAlign: align, cursor: tt ? 'help' : 'default' }}>
      {children}
    </div>
  );

  const Cell = ({ children, bold, color, align = 'left', muted }) => (
    <div style={{ padding: '9px 14px', fontSize: 13, fontWeight: bold ? 700 : 400, color: color || (muted ? 'var(--text-muted)' : 'var(--text)'), display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 4 }}>
      {children}
    </div>
  );

  const Avatar = ({ name, role }) => (
    <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
        {role && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{role}</div>}
      </div>
    </div>
  );

  const Tab = ({ id, label, disabled }) => (
    <button
      onClick={() => !disabled && setActiveTab(id)}
      disabled={disabled}
      title={disabled ? 'Set billing & cost rates in Settings → Team & Billing Rates to enable' : undefined}
      className={`tab-btn${activeTab === id ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >{label}</button>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>

      {/* ── Collapsed header ── */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Project Forecast</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{summary}</div>
        </div>
        {/* Quick-glance chips when collapsed */}
        {!open && totalHours > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {totalDone > 0 && (
              <div style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {Math.round(doneBarPct)}% done
              </div>
            )}
            {hasProfit && margin != null && (
              <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: marginColor(margin) + '18', color: marginColor(margin), border: `1px solid ${marginColor(margin)}33` }}>
                {Math.round(margin)}% margin
              </div>
            )}
            {budgetPct != null && (
              <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: budgetColor(budgetPct) + '18', color: budgetColor(budgetPct), border: `1px solid ${budgetColor(budgetPct)}33` }}>
                {budgetPct <= 100 ? `${Math.round(budgetPct)}% of budget` : `${Math.round(budgetPct - 100)}% over budget`}
              </div>
            )}
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>

          {/* ── Contract value + budget health ── */}
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Contract value</span>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--surface)' }}>
                <span style={{ padding: '4px 8px', fontSize: 13, color: 'var(--text-muted)', borderRight: '1px solid var(--border)', background: 'var(--bg)' }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={activeProject?.budget || ''}
                  onChange={e => onBudgetChange(e.target.value)}
                  onBlur={onBudgetBlur}
                  placeholder="0"
                  onClick={e => e.stopPropagation()}
                  style={{ border: 'none', outline: 'none', padding: '4px 10px', fontSize: 13, width: 110, background: 'transparent' }}
                />
              </div>
            </div>

            {/* Budget health bar */}
            {budget > 0 && totalRevenue > 0 && (
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {fmt$(totalRevenue)} estimated of {fmt$(budget)} budget
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: budgetColor(budgetPct) }}>
                    {budgetVar >= 0 ? `${fmt$(budgetVar)} under` : `${fmt$(-budgetVar)} OVER`}
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--border-light)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(budgetPct, 100)}%`,
                    background: budgetColor(budgetPct),
                    borderRadius: 4,
                    transition: 'width .3s ease',
                  }} />
                </div>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text-muted)' }}>
              Edit any task and set "Est. hrs" to start building the forecast.
            </div>
          ) : (
            <>
              {/* ── Tabs ── */}
              <div className="tab-bar tab-bar-surface" style={{ padding: '12px 18px 0' }}>
                <Tab id="estimate"      label="Estimate" />
                <Tab id="phase"         label="By Phase" />
                <Tab id="profitability" label="Profitability" disabled={!hasProfit} />
              </div>

              {/* ── ESTIMATE TAB ── */}
              {activeTab === 'estimate' && (() => {
                const showRev  = hasBillRates;
                const cols = showRev ? '1fr 55px 70px 70px 70px 90px' : '1fr 55px 70px 70px';
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--border-light)' }}>
                      <ColHdr>Team Member</ColHdr>
                      <ColHdr align="right">Tasks</ColHdr>
                      <ColHdr align="right" title="Estimated hours on completed tasks">Done</ColHdr>
                      <ColHdr align="right" title="Estimated hours on incomplete tasks">Remaining</ColHdr>
                      {showRev && <ColHdr align="right">Rate</ColHdr>}
                      {showRev && <ColHdr align="right">Revenue</ColHdr>}
                    </div>
                    {rows.map((r, i) => (
                      <div key={r.name} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: i < rows.length - 1 ? '1px solid var(--border-light)' : 'none', background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)' }}>
                        <Avatar name={r.name} role={memberMap[r.name]?.role} />
                        <Cell muted align="right">{r.tasks}</Cell>
                        <Cell align="right" color={r.hoursDone > 0 ? '#10b981' : 'var(--text-faint)'}>{fmtHrs(r.hoursDone)}</Cell>
                        <Cell align="right" color={r.hoursLeft > 0 ? 'var(--text)' : 'var(--text-faint)'}>{fmtHrs(r.hoursLeft)}</Cell>
                        {showRev && <Cell muted align="right">{r.billRate > 0 ? `$${r.billRate}/hr` : '—'}</Cell>}
                        {showRev && <Cell bold color={r.billRate > 0 ? '#10b981' : 'var(--text-faint)'} align="right">{r.billRate > 0 ? fmt$(r.hours * r.billRate) : '—'}</Cell>}
                      </div>
                    ))}
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                      <Cell bold>Total</Cell>
                      <Cell bold align="right">{rows.reduce((s, r) => s + r.tasks, 0)}</Cell>
                      <Cell bold color="#10b981" align="right">{fmtHrs(totalDone)}</Cell>
                      <Cell bold align="right">{fmtHrs(totalLeft)}</Cell>
                      {showRev && <div />}
                      {showRev && <Cell bold color="#10b981" align="right">{fmt$(totalRevenue)}</Cell>}
                    </div>
                    {/* Hours burn bar */}
                    {totalDone > 0 && (
                      <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtHrs(totalDone)} of {fmtHrs(totalHours)} completed</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{Math.round(doneBarPct)}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--border-light)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${doneBarPct}%`, background: '#10b981', borderRadius: 3, transition: 'width .3s ease' }} />
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ── BY PHASE TAB ── */}
              {activeTab === 'phase' && (() => {
                const showCost = hasCostRates;
                const showRev  = hasBillRates;
                const cols = ['1fr', '55px', '70px', showCost && '80px', showRev && '80px'].filter(Boolean).join(' ');
                const phTotal = { tasks: 0, hours: 0, cost: 0, revenue: 0 };
                phaseRows.forEach(r => { phTotal.tasks += r.tasks; phTotal.hours += r.hours; phTotal.cost += r.cost; phTotal.revenue += r.revenue; });
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--border-light)' }}>
                      <ColHdr>Phase / Milestone</ColHdr>
                      <ColHdr align="right">Tasks</ColHdr>
                      <ColHdr align="right">Hours</ColHdr>
                      {showCost && <ColHdr align="right">Cost</ColHdr>}
                      {showRev  && <ColHdr align="right">Revenue</ColHdr>}
                    </div>
                    {phaseRows.map((r, i) => (
                      <div key={r.label} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: i < phaseRows.length - 1 ? '1px solid var(--border-light)' : 'none', background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)' }}>
                        <Cell bold>{r.label}</Cell>
                        <Cell muted align="right">{r.tasks}</Cell>
                        <Cell bold align="right">{fmtHrs(r.hours)}</Cell>
                        {showCost && <Cell align="right" color="#ef4444">{r.cost > 0 ? fmt$(r.cost) : '—'}</Cell>}
                        {showRev  && <Cell align="right" color="#10b981">{r.revenue > 0 ? fmt$(r.revenue) : '—'}</Cell>}
                      </div>
                    ))}
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                      <Cell bold>Total</Cell>
                      <Cell bold align="right">{phTotal.tasks}</Cell>
                      <Cell bold align="right">{fmtHrs(phTotal.hours)}</Cell>
                      {showCost && <Cell bold color="#ef4444" align="right">{fmt$(phTotal.cost)}</Cell>}
                      {showRev  && <Cell bold color="#10b981" align="right">{fmt$(phTotal.revenue)}</Cell>}
                    </div>
                  </>
                );
              })()}

              {/* ── PROFITABILITY TAB ── */}
              {activeTab === 'profitability' && hasProfit && (() => {
                const cols = '1fr 70px 75px 80px 75px 80px 90px';
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
                            {m != null && <span style={{ fontSize: 10, color: marginColor(m), fontWeight: 600 }}>({Math.round(m)}%)</span>}
                          </Cell>
                        </div>
                      );
                    })}
                    <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                      <Cell bold>Total</Cell>
                      <Cell bold align="right">{fmtHrs(totalHours)}</Cell>
                      <div /><Cell bold color="#10b981" align="right">{fmt$(totalRevenue)}</Cell>
                      <div /><Cell bold color="#ef4444" align="right">{fmt$(totalCost)}</Cell>
                      <Cell bold color={totalProfit >= 0 ? '#10b981' : '#ef4444'} align="right">{fmt$(totalProfit)}</Cell>
                    </div>

                    {/* P&L summary */}
                    <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border-light)', background: 'var(--bg)', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                      {[
                        { label: 'Revenue',  value: fmt$(totalRevenue),  color: '#10b981' },
                        { label: 'Cost',     value: fmt$(totalCost),     color: '#ef4444' },
                        { label: 'Profit',   value: fmt$(totalProfit),   color: totalProfit >= 0 ? '#10b981' : '#ef4444' },
                        { label: 'Margin',   value: margin != null ? `${Math.round(margin)}%` : '—', color: marginColor(margin) },
                        budget > 0 ? { label: 'vs Budget', value: budgetVar >= 0 ? `${fmt$(budgetVar)} under` : `${fmt$(-budgetVar)} OVER`, color: budgetColor(budgetPct) } : null,
                      ].filter(Boolean).map(stat => (
                        <div key={stat.label}>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 2 }}>{stat.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}

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
