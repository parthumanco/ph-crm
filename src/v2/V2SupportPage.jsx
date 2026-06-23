import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchCases,
    fetchCaseMessages,
    caseStatusLabel,
    casePriorityLabel,
    channelIcon,
    channelLabel,
    slaSummary,
    CASE_PRIORITIES,
    CASE_STATUSES,
    CHANNELS,
    loadTeamMembers,
    DEFAULT_TEAM_MEMBERS,
} from './safe-data.js';
import {
    upsertCase,
    deleteCase,
    addCaseMessage,
} from './write-data.js';
import V2Modal from './V2Modal.jsx';
import V2Confirm from './V2Confirm.jsx';
import CaseForm from './forms/CaseForm.jsx';

/* ============================================
   V2 SUPPORT — now interactive

   Two-pane layout: cases list (left), thread
   (right). Adds:
     • + New case button on the page header
     • Click a case row → edit modal
     • Status dropdown in the thread header
     • Resolve button
     • Composer at the bottom with reply / note tabs
============================================ */

function priorityClass(p) {
    if (p === 'high' || p === 'urgent') return 'v2-priority--high';
    if (p === 'medium' || p === 'normal') return 'v2-priority--med';
    return 'v2-priority--low';
}

function priorityLetter(p) {
    return (p || '').slice(0, 1).toUpperCase() || '·';
}

function slaChipClass(deadline) {
    if (!deadline) return 'v2-sla-chip';
    const hours = (new Date(deadline) - new Date()) / 3600000;
    if (hours < 0) return 'v2-sla-chip v2-sla-chip--breach';
    if (hours < 4) return 'v2-sla-chip v2-sla-chip--warn';
    return 'v2-sla-chip';
}

function formatRel(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diffH = (Date.now() - d.getTime()) / 3600000;
    if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    const days = Math.round(diffH / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function V2SupportPage() {
    const [cases, setCases] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingThread, setLoadingThread] = useState(false);
    const [error, setError] = useState(null);

    // Team — used for the owner filter + composer author + form
    const [teamMembers, setTeamMembers] = useState(DEFAULT_TEAM_MEMBERS);
    const owners = useMemo(
        () => (teamMembers.length ? teamMembers.map((m) => m.name) : DEFAULT_TEAM_MEMBERS.map((m) => m.name)),
        [teamMembers]
    );
    const [composerAuthor, setComposerAuthor] = useState(owners[0] || 'Mike');

    // Filters
    const [statusFilter,  setStatusFilter]  = useState('open');     // 'all' | open | in_progress | waiting | resolved | closed
    const [priorityFilter, setPriorityFilter] = useState('all');
    const [ownerFilter,   setOwnerFilter]   = useState('all');
    const [search,        setSearch]        = useState('');

    // Mutation state
    const [caseModal,    setCaseModal]    = useState(null);   // null | { mode: 'new' | 'edit', target?: case }
    const [deleteTarget, setDeleteTarget] = useState(null);   // null | case
    const [composerKind, setComposerKind] = useState('reply'); // 'reply' | 'note'
    const [composerText, setComposerText] = useState('');
    const [sending,      setSending]      = useState(false);
    const [working,      setWorking]      = useState(false);
    const [toast,        setToast]        = useState(null);

    const loadCases = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const list = await fetchCases();
            setCases(list);
            if (list.length && !selectedId) setSelectedId(list[0].id);
        } catch (err) {
            setError(err.message || 'Failed to load cases');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadThread = useCallback(async (caseId) => {
        if (!caseId) { setMessages([]); return; }
        try {
            setLoadingThread(true);
            const msgs = await fetchCaseMessages(caseId);
            setMessages(msgs);
        } catch {
            setMessages([]);
        } finally {
            setLoadingThread(false);
        }
    }, []);

    useEffect(() => { loadCases(); }, [loadCases]);
    useEffect(() => { loadThread(selectedId); }, [selectedId, loadThread]);

    // Load team members for owner filter + composer author dropdown
    useEffect(() => {
        loadTeamMembers().then((tm) => {
            setTeamMembers(tm);
            if (tm.length && !tm.map((m) => m.name).includes(composerAuthor)) {
                setComposerAuthor(tm[0].name);
            }
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-dismiss toast
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const selectedCase = useMemo(
        () => cases.find((c) => c.id === selectedId),
        [cases, selectedId]
    );

    const handleStatusChange = useCallback(async (newStatus) => {
        if (!selectedCase || selectedCase.status === newStatus) return;
        const prevStatus = selectedCase.status;
        // Optimistic update so the dropdown feels snappy
        setCases((s) => s.map((c) => c.id === selectedCase.id ? { ...c, status: newStatus } : c));
        try {
            await upsertCase({ ...selectedCase, status: newStatus });
            setToast({ kind: 'info', text: `Status: ${caseStatusLabel(newStatus)}` });
        } catch (err) {
            // Roll back
            setCases((s) => s.map((c) => c.id === selectedCase.id ? { ...c, status: prevStatus } : c));
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t update status' });
        }
    }, [selectedCase]);

    const handleAssignChange = useCallback(async (newOwner) => {
        if (!selectedCase || selectedCase.assigned_to === newOwner) return;
        const prevOwner = selectedCase.assigned_to;
        setCases((s) => s.map((c) => c.id === selectedCase.id ? { ...c, assigned_to: newOwner } : c));
        try {
            await upsertCase({ ...selectedCase, assigned_to: newOwner });
            setToast({ kind: 'info', text: `Assigned to ${newOwner}` });
        } catch (err) {
            setCases((s) => s.map((c) => c.id === selectedCase.id ? { ...c, assigned_to: prevOwner } : c));
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t reassign' });
        }
    }, [selectedCase]);

    const handleResolve = useCallback(async () => {
        if (!selectedCase) return;
        const prevStatus = selectedCase.status;
        setCases((s) => s.map((c) => c.id === selectedCase.id ? { ...c, status: 'resolved' } : c));
        try {
            await upsertCase({ ...selectedCase, status: 'resolved', resolved_at: new Date().toISOString() });
            setToast({ kind: 'win', text: 'Case resolved.' });
        } catch (err) {
            setCases((s) => s.map((c) => c.id === selectedCase.id ? { ...c, status: prevStatus } : c));
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t resolve' });
        }
    }, [selectedCase]);

    const handleSend = useCallback(async (e) => {
        e?.preventDefault?.();
        if (!selectedCase || !composerText.trim()) return;
        setSending(true);
        try {
            await addCaseMessage({
                case_id: selectedCase.id,
                body: composerText.trim(),
                internal: composerKind === 'note',
                author_role: 'internal',
                author_name: composerAuthor,
            });
            setComposerText('');
            await loadThread(selectedCase.id);
            setToast({ kind: 'win', text: composerKind === 'note' ? 'Internal note saved.' : 'Reply sent.' });
        } catch (err) {
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t send' });
        } finally {
            setSending(false);
        }
    }, [selectedCase, composerText, composerKind, composerAuthor, loadThread]);

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        setWorking(true);
        try {
            await deleteCase(deleteTarget.id);
            if (selectedId === deleteTarget.id) setSelectedId(null);
            setDeleteTarget(null);
            setCaseModal(null);
            await loadCases();
            setToast({ kind: 'info', text: 'Case deleted.' });
        } catch (err) {
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t delete' });
        } finally {
            setWorking(false);
        }
    }, [deleteTarget, selectedId, loadCases]);

    const stats = useMemo(() => {
        const open      = cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed').length;
        const inProgress= cases.filter((c) => c.status === 'in_progress').length;
        const waiting   = cases.filter((c) => c.status === 'waiting' || c.status === 'awaiting_reply').length;

        // SLA on-time %: of resolved cases, how many were resolved before
        // their SLA deadline? Mirrors Mike's slaSummary helper.
        const resolved = cases.filter((c) => c.status === 'resolved' || c.status === 'closed');
        let onTime = 0;
        let breaches = 0;
        for (const c of resolved) {
            const dueAt = c.due_at || c.sla_deadline;
            const resolvedAt = c.resolved_at || c.updated_at;
            if (!dueAt) continue;
            const s = slaSummary(dueAt, resolvedAt);
            if (s?.breached) breaches += 1; else onTime += 1;
        }
        const slaPct = (onTime + breaches) > 0
            ? Math.round((onTime / (onTime + breaches)) * 100)
            : null;

        return { open, inProgress, waiting, resolvedCount: resolved.length, slaPct };
    }, [cases]);

    // Filtered list — drives both the count + the left pane.
    const filteredCases = useMemo(() => {
        const q = search.trim().toLowerCase();
        return cases.filter((c) => {
            // Status: 'open' option matches anything not resolved/closed
            if (statusFilter === 'open') {
                if (c.status === 'resolved' || c.status === 'closed') return false;
            } else if (statusFilter !== 'all' && c.status !== statusFilter) {
                return false;
            }
            if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
            if (ownerFilter !== 'all' && (c.assigned_to || '') !== ownerFilter) return false;
            if (q) {
                const hay = [
                    c.title, c.subject, c.client_name, c.company_name,
                    c.contact_name, c.assigned_to,
                ].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [cases, statusFilter, priorityFilter, ownerFilter, search]);

    const activeFilterCount =
        (statusFilter !== 'open' ? 1 : 0) +
        (priorityFilter !== 'all' ? 1 : 0) +
        (ownerFilter !== 'all' ? 1 : 0) +
        (search ? 1 : 0);
    const clearAllFilters = () => {
        setStatusFilter('open');
        setPriorityFilter('all');
        setOwnerFilter('all');
        setSearch('');
    };

    return (
        <>
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">client care</div>
                    <h1 className="v2-page-title">
                        Support
                        {cases.length > 0 && (
                            <span className="v2-page-title__count">
                                {stats.open} open · {stats.waiting} waiting on client
                            </span>
                        )}
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading
                            ? 'Loading from Supabase…'
                            : stats.slaPct !== null
                                ? `${cases.length} total · ${stats.slaPct}% on time`
                                : `${cases.length} total · no SLA history yet`}
                    </p>
                </div>
                <div className="v2-page-header__actions">
                    <button
                        type="button"
                        className="v2-btn v2-btn--primary"
                        onClick={() => setCaseModal({ mode: 'new' })}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                        New case
                    </button>
                </div>
            </div>

            {error && <div className="v2-error">Couldn't load cases: {error}</div>}

            <div className="v2-stat-row">
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Open</div>
                    <div className="v2-stat-card__value">{stats.open}</div>
                    <div className="v2-stat-card__delta">currently active</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">In progress</div>
                    <div className="v2-stat-card__value">{stats.inProgress}</div>
                    <div className="v2-stat-card__delta">being worked</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Waiting on client</div>
                    <div className="v2-stat-card__value">{stats.waiting}</div>
                    <div className="v2-stat-card__delta">reply pending</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">SLA on-time</div>
                    <div className="v2-stat-card__value">
                        {stats.slaPct === null ? '—' : `${stats.slaPct}%`}
                    </div>
                    <div className="v2-stat-card__delta">
                        {stats.slaPct === null
                            ? 'no history yet'
                            : `over ${stats.resolvedCount} resolved`}
                    </div>
                </div>
            </div>

            <div className="v2-support-grid">
                {/* LEFT — cases list */}
                <div className="v2-cases">
                    <div className="v2-cases__header">
                        <div className="v2-cases__title-row">
                            <div className="v2-cases__title">
                                Cases <span className="v2-cases__title-count">{filteredCases.length} of {cases.length}</span>
                            </div>
                            {activeFilterCount > 0 && (
                                <button
                                    type="button"
                                    className="v2-cases__clear"
                                    onClick={clearAllFilters}
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>

                        {/* Filter bar — status tabs + priority + owner + search */}
                        <div className="v2-cases__filters">
                            <div className="v2-cases__tabs">
                                {[
                                    { id: 'open',        label: 'Open' },
                                    { id: 'in_progress', label: 'In progress' },
                                    { id: 'waiting',     label: 'Waiting' },
                                    { id: 'resolved',    label: 'Resolved' },
                                    { id: 'all',         label: 'All' },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        className={`v2-cases__tab ${statusFilter === tab.id ? 'is-active' : ''}`}
                                        onClick={() => setStatusFilter(tab.id)}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            <div className="v2-cases__filter-row">
                                <div className="v2-select-wrap v2-select-wrap--inline">
                                    <select
                                        className="v2-select v2-select--inline"
                                        value={priorityFilter}
                                        onChange={(e) => setPriorityFilter(e.target.value)}
                                    >
                                        <option value="all">Any priority</option>
                                        {CASE_PRIORITIES.map((p) => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                    <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                </div>
                                <div className="v2-select-wrap v2-select-wrap--inline">
                                    <select
                                        className="v2-select v2-select--inline"
                                        value={ownerFilter}
                                        onChange={(e) => setOwnerFilter(e.target.value)}
                                    >
                                        <option value="all">Any owner</option>
                                        {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                    <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                </div>
                            </div>
                            <div className="v2-cases__search">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
                                <input
                                    type="text"
                                    placeholder="Search title, client, contact…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="v2-cases__list">
                        {loading && <div className="v2-empty"><strong>Loading…</strong></div>}
                        {!loading && cases.length === 0 && (
                            <div className="v2-empty"><strong>No cases yet</strong>Reach out from any client conversation to create one.</div>
                        )}
                        {!loading && cases.length > 0 && filteredCases.length === 0 && (
                            <div className="v2-empty">
                                <strong>No cases match these filters</strong>
                                Clear or broaden them to see more.
                            </div>
                        )}
                        {!loading && filteredCases.map((c) => {
                            const active = c.id === selectedId;
                            const channelKey = c.channel || 'email';
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    className={`v2-case-row ${active ? 'is-active' : ''}`}
                                    onClick={() => setSelectedId(c.id)}
                                >
                                    <div className={`v2-case-row__priority ${priorityClass(c.priority)}`}>
                                        {priorityLetter(c.priority)}
                                    </div>
                                    <div className="v2-case-row__body">
                                        <div className="v2-case-row__top">
                                            <span
                                                className="v2-case-row__channel"
                                                title={channelLabel(channelKey)}
                                                aria-label={`Channel: ${channelLabel(channelKey)}`}
                                            >
                                                {channelIcon(channelKey)}
                                            </span>
                                            <span className="v2-case-row__client">{c.client_name || c.company_name || 'Unknown'}</span>
                                            {c.case_number && <span className="v2-case-row__num">#{String(c.case_number).padStart(3, '0')}</span>}
                                        </div>
                                        <div className="v2-case-row__title">{c.title || c.subject || 'Untitled case'}</div>
                                        <div className="v2-case-row__meta">
                                            {c.contact_name && <span>{c.contact_name}</span>}
                                            {(c.due_at || c.sla_deadline) && (
                                                <span className={slaChipClass(c.due_at || c.sla_deadline)}>
                                                    SLA · {formatRel(c.due_at || c.sla_deadline)}
                                                </span>
                                            )}
                                            {c.status && <span>{caseStatusLabel(c.status)}</span>}
                                        </div>
                                    </div>
                                    <div className="v2-case-row__right">
                                        <div className="v2-case-row__age">{formatRel(c.updated_at || c.created_at)}</div>
                                        {c.assigned_to && (
                                            <div className="v2-case-row__owner">{c.assigned_to}</div>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* RIGHT — thread */}
                <div className="v2-thread">
                    {!selectedCase && !loading && (
                        <div className="v2-empty" style={{ padding: '64px 32px' }}>
                            <strong>Pick a case to view its thread</strong>
                            Messages, internal notes, and SLA appear here.
                        </div>
                    )}
                    {selectedCase && (
                        <>
                            <div className="v2-thread__header">
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="v2-thread__breadcrumb">
                                        <span>{selectedCase.client_name || selectedCase.company_name}</span>
                                        {selectedCase.case_number && <span>· Case #{selectedCase.case_number}</span>}
                                    </div>
                                    <h2 className="v2-thread__title">{selectedCase.title || selectedCase.subject || 'Untitled case'}</h2>
                                    <div className="v2-thread__meta">
                                        <span className="v2-priority-chip">
                                            <span className={`v2-priority-chip__dot ${priorityClass(selectedCase.priority)}`} />
                                            {casePriorityLabel(selectedCase.priority)} priority
                                        </span>
                                        <span className="v2-thread__chip" title={channelLabel(selectedCase.channel || 'email')}>
                                            <span style={{ fontSize: 14 }}>{channelIcon(selectedCase.channel || 'email')}</span>
                                            {channelLabel(selectedCase.channel || 'email')}
                                        </span>
                                        <div className="v2-thread__status">
                                            <span style={{ color: 'var(--crm-text-3)' }}>Status:</span>
                                            <div className="v2-select-wrap v2-select-wrap--inline">
                                                <select
                                                    className="v2-select v2-select--inline"
                                                    value={selectedCase.status || 'open'}
                                                    onChange={(e) => handleStatusChange(e.target.value)}
                                                >
                                                    {CASE_STATUSES.map((s) => (
                                                        <option key={s.id} value={s.id}>{s.label}</option>
                                                    ))}
                                                </select>
                                                <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                            </div>
                                        </div>
                                        <div className="v2-thread__status">
                                            <span style={{ color: 'var(--crm-text-3)' }}>Owner:</span>
                                            <div className="v2-select-wrap v2-select-wrap--inline">
                                                <select
                                                    className="v2-select v2-select--inline"
                                                    value={selectedCase.assigned_to || owners[0] || 'Mike'}
                                                    onChange={(e) => handleAssignChange(e.target.value)}
                                                >
                                                    {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                                <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                            </div>
                                        </div>
                                        {selectedCase.contact_name && <span>Contact: {selectedCase.contact_name}</span>}
                                    </div>
                                </div>
                                <div className="v2-thread__actions">
                                    <button
                                        type="button"
                                        className="v2-btn"
                                        onClick={() => setCaseModal({ mode: 'edit', target: selectedCase })}
                                    >
                                        Edit
                                    </button>
                                    {selectedCase.status !== 'resolved' && (
                                        <button
                                            type="button"
                                            className="v2-btn v2-btn--primary"
                                            onClick={handleResolve}
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                            Resolve
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="v2-thread__body">
                                {loadingThread && <div className="v2-empty">Loading thread…</div>}
                                {!loadingThread && messages.length === 0 && (
                                    <div className="v2-empty">No messages on this case yet.</div>
                                )}
                                {messages.map((m) => {
                                    const isInternal = m.internal || m.author_role === 'internal';
                                    const cls = isInternal ? 'v2-msg v2-msg--internal' : 'v2-msg v2-msg--client';
                                    return (
                                        <div key={m.id} className={cls}>
                                            <div className={`v2-msg__avatar v2-msg__avatar--${isInternal ? 'internal' : 'client'}`}>
                                                {(m.author_name || '?').slice(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="v2-msg__head">
                                                    <span className="v2-msg__author">{m.author_name || (isInternal ? 'Team' : 'Client')}</span>
                                                    <span className={`v2-msg__role-chip v2-msg__role-chip--${isInternal ? 'internal' : 'client'}`}>
                                                        {isInternal ? 'Part Human' : 'Client'}
                                                    </span>
                                                    <span className="v2-msg__time">{formatRel(m.created_at)}</span>
                                                </div>
                                                <div className="v2-msg__body">{m.body || m.content || ''}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Composer — reply to client or internal note */}
                            <form className="v2-composer" onSubmit={handleSend}>
                                <div className="v2-composer__tabs">
                                    <button
                                        type="button"
                                        className={`v2-composer__tab ${composerKind === 'reply' ? 'is-active' : ''}`}
                                        onClick={() => setComposerKind('reply')}
                                    >
                                        Reply to client
                                    </button>
                                    <button
                                        type="button"
                                        className={`v2-composer__tab ${composerKind === 'note' ? 'is-active' : ''}`}
                                        onClick={() => setComposerKind('note')}
                                    >
                                        Internal note
                                    </button>
                                </div>
                                <textarea
                                    className={`v2-composer__input ${composerKind === 'note' ? 'v2-composer__input--note' : ''}`}
                                    value={composerText}
                                    onChange={(e) => setComposerText(e.target.value)}
                                    placeholder={composerKind === 'reply'
                                        ? 'Write a reply to the client…  ⌘+Enter to send'
                                        : 'Internal note — not visible to the client.'}
                                    onKeyDown={(e) => {
                                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend(e);
                                    }}
                                    rows={3}
                                />
                                <div className="v2-composer__footer">
                                    <div className="v2-composer__author">
                                        <span className="v2-composer__hint">From</span>
                                        <div className="v2-select-wrap v2-select-wrap--inline">
                                            <select
                                                className="v2-select v2-select--inline"
                                                value={composerAuthor}
                                                onChange={(e) => setComposerAuthor(e.target.value)}
                                            >
                                                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                            <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                        </div>
                                        <span className="v2-composer__hint">
                                            · {composerKind === 'reply'
                                                ? 'sent · attaches to the timeline'
                                                : 'stays on this case · team only'}
                                        </span>
                                    </div>
                                    <button
                                        type="submit"
                                        className="v2-btn v2-btn--primary"
                                        disabled={sending || !composerText.trim()}
                                    >
                                        {sending
                                            ? 'Sending…'
                                            : composerKind === 'reply' ? 'Send reply' : 'Save note'}
                                    </button>
                                </div>
                            </form>
                        </>
                    )}
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className={`v2-toast v2-toast--${toast.kind}`}>
                    <span className="v2-toast__icon">{toast.kind === 'win' ? '✓' : toast.kind === 'warn' ? '!' : '·'}</span>
                    <span>{toast.text}</span>
                </div>
            )}

            {/* New / edit case modal */}
            <V2Modal
                open={caseModal !== null}
                onClose={() => setCaseModal(null)}
                eyebrow={caseModal?.mode === 'edit' ? 'edit case' : 'new case'}
                title={caseModal?.mode === 'edit'
                    ? (caseModal.target?.title || caseModal.target?.subject || 'Edit case')
                    : 'Create a case'}
                footer={
                    caseModal?.mode === 'edit' && (
                        <button
                            type="button"
                            className="v2-btn-link v2-btn-link--danger"
                            onClick={() => setDeleteTarget(caseModal.target)}
                            style={{ marginRight: 'auto' }}
                        >
                            Delete case
                        </button>
                    )
                }
            >
                {caseModal && (
                    <CaseForm
                        initial={caseModal.mode === 'edit' ? caseModal.target : null}
                        owners={owners}
                        onSaved={(saved) => {
                            const wasNew = caseModal.mode === 'new';
                            setCaseModal(null);
                            loadCases().then(() => {
                                if (wasNew && saved?.id) setSelectedId(saved.id);
                            });
                            setToast({ kind: 'win', text: wasNew ? 'Case created.' : 'Case updated.' });
                        }}
                        onCancel={() => setCaseModal(null)}
                    />
                )}
            </V2Modal>

            <V2Confirm
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                eyebrow="careful"
                title="Delete this case?"
                description={deleteTarget ? `"${deleteTarget.title || deleteTarget.subject || 'Untitled'}" and all its messages will be removed.` : null}
                confirmLabel="Delete case"
                confirmTone="danger"
                loading={working}
            />
        </>
    );
}
