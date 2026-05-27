import { useEffect, useMemo, useState } from 'react';
import {
    fetchCases,
    fetchCaseMessages,
    caseStatusLabel,
    casePriorityLabel,
    CASE_PRIORITIES,
} from './safe-data.js';

/* ============================================
   V2 SUPPORT

   Two-pane layout: cases list (left), thread
   (right). Wired to lib/support.js read
   functions. Selecting a case in the list
   loads its message thread via fetchCaseMessages.
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

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const list = await fetchCases();
                if (cancelled) return;
                setCases(list);
                if (list.length && !selectedId) setSelectedId(list[0].id);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load cases');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedId) { setMessages([]); return; }
        let cancelled = false;
        (async () => {
            try {
                setLoadingThread(true);
                const msgs = await fetchCaseMessages(selectedId);
                if (!cancelled) setMessages(msgs);
            } catch {
                if (!cancelled) setMessages([]);
            } finally {
                if (!cancelled) setLoadingThread(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedId]);

    const selectedCase = useMemo(
        () => cases.find((c) => c.id === selectedId),
        [cases, selectedId]
    );

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
                                <div>
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
                                        <span>Status: {caseStatusLabel(selectedCase.status)}</span>
                                        {selectedCase.contact_name && <span>Contact: {selectedCase.contact_name}</span>}
                                    </div>
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
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
