import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchCases,
    fetchCaseMessages,
    caseStatusLabel,
    casePriorityLabel,
    CASE_PRIORITIES,
    CASE_STATUSES,
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
                author_name: 'Peter',
            });
            setComposerText('');
            await loadThread(selectedCase.id);
            setToast({ kind: 'win', text: composerKind === 'note' ? 'Internal note saved.' : 'Reply sent.' });
        } catch (err) {
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t send' });
        } finally {
            setSending(false);
        }
    }, [selectedCase, composerText, composerKind, loadThread]);

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
        const open = cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed').length;
        const awaiting = cases.filter((c) => c.status === 'awaiting_reply' || c.status === 'open').length;
        return { open, awaiting };
    }, [cases]);

    return (
        <>
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">client care</div>
                    <h1 className="v2-page-title">
                        Support
                        {cases.length > 0 && (
                            <span className="v2-page-title__count">
                                {stats.open} open · {stats.awaiting} awaiting reply
                            </span>
                        )}
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading ? 'Loading from Supabase…' : `${cases.length} total · sorted by recent activity`}
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
                    <div className="v2-stat-card__label">Awaiting reply</div>
                    <div className="v2-stat-card__value">{stats.awaiting}</div>
                    <div className="v2-stat-card__delta">from client</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Resolved</div>
                    <div className="v2-stat-card__value">{cases.filter(c => c.status === 'resolved').length}</div>
                    <div className="v2-stat-card__delta">closed out</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Priorities</div>
                    <div className="v2-stat-card__value">{CASE_PRIORITIES.length}</div>
                    <div className="v2-stat-card__delta">levels in use</div>
                </div>
            </div>

            <div className="v2-support-grid">
                {/* LEFT — cases list */}
                <div className="v2-cases">
                    <div className="v2-cases__header">
                        <div className="v2-cases__title">
                            Cases <span className="v2-cases__title-count">{cases.length} total</span>
                        </div>
                    </div>
                    <div className="v2-cases__list">
                        {loading && <div className="v2-empty"><strong>Loading…</strong></div>}
                        {!loading && cases.length === 0 && (
                            <div className="v2-empty"><strong>No cases yet</strong>Reach out from any client conversation to create one.</div>
                        )}
                        {!loading && cases.map((c) => {
                            const active = c.id === selectedId;
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
                                            <span className="v2-case-row__client">{c.client_name || c.company_name || 'Unknown'}</span>
                                            {c.case_number && <span className="v2-case-row__num">#{c.case_number}</span>}
                                        </div>
                                        <div className="v2-case-row__title">{c.title || c.subject || 'Untitled case'}</div>
                                        <div className="v2-case-row__meta">
                                            {c.contact_name && <span>{c.contact_name}</span>}
                                            {c.sla_deadline && (
                                                <span className={slaChipClass(c.sla_deadline)}>
                                                    SLA · {formatRel(c.sla_deadline)}
                                                </span>
                                            )}
                                            {c.status && <span>{caseStatusLabel(c.status)}</span>}
                                        </div>
                                    </div>
                                    <div className="v2-case-row__right">{formatRel(c.updated_at || c.created_at)}</div>
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
                                    <span className="v2-composer__hint">
                                        {composerKind === 'reply'
                                            ? 'Sent · attaches to the timeline'
                                            : 'Stays on this case · team only'}
                                    </span>
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
