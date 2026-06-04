import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchDeals,
    DEAL_STAGES,
    DEAL_ACTIVE_STAGES,
    DEAL_CLOSED_STAGES,
    stageLabel,
    dealValue,
    fmt$,
    daysSince,
} from './safe-data.js';
import {
    moveDealStage,
    deleteDeal,
    upsertProject,
} from './write-data.js';
import V2Modal from './V2Modal.jsx';
import V2Confirm from './V2Confirm.jsx';
import DealForm from './forms/DealForm.jsx';

/* ============================================
   V2 DEALS KANBAN — now interactive

   Six active stages as columns; Won and Lost as
   dedicated drop bars. Drag a card to move stage.
   Drop on Won → moveStage + auto-create project
   (matches legacy behavior without the audio
   fanfare or animated celebration).
============================================ */

const LANE_ACCENTS = {
    prospect:       'var(--v2-blue)',
    outreach:       '#6f8ec9',
    responded:      'var(--v2-blue)',
    discovery_call: 'var(--v2-purple)',
    proposal_sent:  '#c08850',
    negotiation:    'var(--v2-orange)',
};

function ageWarn(days) {
    if (days >= 14) return 'stale';
    if (days >= 8)  return 'warn';
    return null;
}

function ownerAvatar(owner) {
    if (!owner) return null;
    const initials = owner.slice(0, 2).toUpperCase();
    const color = owner.startsWith('M') ? 'orange' : owner.startsWith('P') ? 'purple' : 'teal';
    return { initials, color };
}

function DealCard({ deal, onClick, onDragStart, onDragEnd, isDragging }) {
    const days = daysSince(deal.stage_entered_at || deal.created_at);
    const ageClass = ageWarn(days);
    const owner = ownerAvatar(deal.assigned_to);
    return (
        <div
            className={`v2-deal ${isDragging ? 'is-dragging' : ''}`}
            draggable
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/dealid', deal.id);
                onDragStart?.(deal);
            }}
            onDragEnd={() => onDragEnd?.()}
            onClick={(e) => {
                // Click should open detail; drag handlers don't fire click.
                if (e.detail > 0) onClick?.(deal);
            }}
            role="button"
            tabIndex={0}
        >
            <div className="v2-deal__head">
                <div className="v2-deal__company">{deal.company_name || '—'}</div>
                {deal.tier && (
                    <span className={`v2-deal__tier v2-deal__tier--${deal.tier}`}>T{deal.tier}</span>
                )}
            </div>
            {deal.title && <div className="v2-deal__title">{deal.title}</div>}
            <div className="v2-deal__row">
                <div className="v2-deal__amount">{fmt$(dealValue(deal))}</div>
            </div>
            {deal.contact_name && (
                <div className="v2-deal__row">
                    <span className="v2-deal__contact">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M3 21c0-4 4-7 9-7s9 3 9 7"/></svg>
                        <span className="v2-deal__contact-name">{deal.contact_name}</span>
                    </span>
                </div>
            )}
            <div className="v2-deal__footer">
                <span className={`v2-deal__age ${ageClass ? `v2-deal__age--${ageClass}` : ''}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                    {days} day{days === 1 ? '' : 's'}{ageClass === 'warn' ? ' · nudge' : ''}
                </span>
                {owner && (
                    <span className={`v2-deal__assignee v2-deal__assignee--${owner.color}`}>
                        {owner.initials}
                    </span>
                )}
            </div>
        </div>
    );
}

export default function V2DealsPage() {
    const [deals, setDeals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [draggingId, setDraggingId] = useState(null);
    const [dragOverStage, setDragOverStage] = useState(null);
    const [dealModal, setDealModal] = useState(null);   // null | { mode: 'new' | 'edit', target?: deal }
    const [deleteTarget, setDeleteTarget] = useState(null); // null | deal
    const [working, setWorking] = useState(false);
    const [toast, setToast] = useState(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const list = await fetchDeals();
            setDeals(list);
        } catch (err) {
            setError(err.message || 'Failed to load deals');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Auto-dismiss toast after 4 seconds
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    /** Move a deal to a new stage. If moving to 'won', also create
        a project from the deal (matches legacy createProjectFromDeal). */
    const moveToStage = useCallback(async (dealId, newStage) => {
        const deal = deals.find((d) => d.id === dealId);
        if (!deal || deal.stage === newStage) return;

        // Optimistic local update so the kanban feels snappy
        setDeals((s) => s.map((d) => d.id === dealId ? { ...d, stage: newStage } : d));

        try {
            await moveDealStage(dealId, newStage);

            if (newStage === 'won') {
                // Auto-create a project for the won deal
                try {
                    await upsertProject({
                        name: deal.title || deal.company_name,
                        client_name: deal.company_name,
                        contact_name: deal.contact_name || null,
                        status: 'active',
                        start_date: new Date().toISOString().slice(0, 10),
                    });
                    setToast({ kind: 'win', text: `Won! Project created for ${deal.company_name}.` });
                } catch (err) {
                    setToast({ kind: 'warn', text: `Won, but couldn't create project: ${err.message}` });
                }
            } else if (newStage === 'lost') {
                setToast({ kind: 'info', text: `${deal.company_name} moved to Lost — back to nurture in 6 months.` });
            }

            await load();
        } catch (err) {
            // Roll back optimistic update on failure
            setDeals((s) => s.map((d) => d.id === dealId ? { ...d, stage: deal.stage } : d));
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t move deal' });
        }
    }, [deals, load]);

    const handleDrop = useCallback((e, targetStage) => {
        e.preventDefault();
        const dealId = e.dataTransfer.getData('text/dealid');
        setDragOverStage(null);
        if (!dealId) return;
        moveToStage(dealId, targetStage);
    }, [moveToStage]);

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        setWorking(true);
        try {
            await deleteDeal(deleteTarget.id);
            setDeleteTarget(null);
            setDealModal(null);
            await load();
        } catch (err) {
            setError(err.message || 'Couldn\'t delete deal');
        } finally {
            setWorking(false);
        }
    }, [deleteTarget, load]);

    const byStage = useMemo(() => {
        const map = {};
        for (const stage of DEAL_STAGES) map[stage.id] = [];
        for (const d of deals) {
            if (map[d.stage]) map[d.stage].push(d);
        }
        return map;
    }, [deals]);

    const stats = useMemo(() => {
        let openPipeline = 0;
        let wonYtd = 0;
        const thisYear = new Date().getFullYear();
        for (const d of deals) {
            if (!DEAL_CLOSED_STAGES.find((s) => s.id === d.stage)) {
                openPipeline += dealValue(d);
            }
            if (d.stage === 'won' && d.won_date) {
                if (new Date(d.won_date).getFullYear() === thisYear) {
                    wonYtd += dealValue(d);
                }
            }
        }
        const openCount = deals.filter((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage)).length;
        return { openPipeline, wonYtd, openCount };
    }, [deals]);

    const wonCount = (byStage.won || []).length;
    const lostCount = (byStage.lost || []).length;

    return (
        <>
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">the pipeline</div>
                    <h1 className="v2-page-title">
                        Deals
                        {stats.openCount > 0 && (
                            <span className="v2-page-title__count">
                                {stats.openCount} open · {fmt$(stats.openPipeline)} value
                            </span>
                        )}
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading ? 'Loading from Supabase…' : `Won this year: ${fmt$(stats.wonYtd)}`}
                    </p>
                </div>
                <div className="v2-page-header__actions">
                    <button
                        type="button"
                        className="v2-btn v2-btn--primary"
                        onClick={() => setDealModal({ mode: 'new' })}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                        New deal
                    </button>
                </div>
            </div>

            {error && <div className="v2-error">Couldn't load deals: {error}</div>}

            {/* Stats */}
            <div className="v2-stat-row">
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Open pipeline</div>
                    <div className="v2-stat-card__value">{fmt$(stats.openPipeline)}</div>
                    <div className="v2-stat-card__delta">across {stats.openCount} deals</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Won YTD</div>
                    <div className="v2-stat-card__value">{fmt$(stats.wonYtd)}</div>
                    <div className="v2-stat-card__delta v2-good">{wonCount} closed</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Active stages</div>
                    <div className="v2-stat-card__value">{DEAL_ACTIVE_STAGES.length}</div>
                    <div className="v2-stat-card__delta">stages in play</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Closed lost</div>
                    <div className="v2-stat-card__value">{lostCount}</div>
                    <div className="v2-stat-card__delta">routed to nurture</div>
                </div>
            </div>

            {/* Closed lanes — dedicated, unambiguous drop targets */}
            <div className="v2-closed-strip">
                <div
                    className={`v2-closed-lane v2-closed-lane--won ${dragOverStage === 'won' ? 'is-drop-target' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage('won'); }}
                    onDragLeave={() => setDragOverStage(null)}
                    onDrop={(e) => handleDrop(e, 'won')}
                >
                    <div className="v2-closed-lane__icon">✓</div>
                    <div className="v2-closed-lane__body">
                        <div className="v2-closed-lane__label">{draggingId ? 'Drop here to mark Won' : 'Won lane'}</div>
                        <div className="v2-closed-lane__hint">{wonCount} closed · auto-creates project on move</div>
                    </div>
                    <div className="v2-closed-lane__count">{wonCount}</div>
                </div>
                <div
                    className={`v2-closed-lane v2-closed-lane--lost ${dragOverStage === 'lost' ? 'is-drop-target' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage('lost'); }}
                    onDragLeave={() => setDragOverStage(null)}
                    onDrop={(e) => handleDrop(e, 'lost')}
                >
                    <div className="v2-closed-lane__icon">×</div>
                    <div className="v2-closed-lane__body">
                        <div className="v2-closed-lane__label">{draggingId ? 'Drop here to mark Lost' : 'Lost lane'}</div>
                        <div className="v2-closed-lane__hint">{lostCount} closed · returns to nurture in 6mo</div>
                    </div>
                    <div className="v2-closed-lane__count">{lostCount}</div>
                </div>
            </div>

            {/* Kanban board */}
            <div className="v2-board-wrap">
                <div className="v2-board">
                    {DEAL_ACTIVE_STAGES.map((stage) => {
                        const stageDeals = byStage[stage.id] || [];
                        const total = stageDeals.reduce((sum, d) => sum + dealValue(d), 0);
                        const isDropTarget = dragOverStage === stage.id;
                        return (
                            <div
                                key={stage.id}
                                className={`v2-lane ${isDropTarget ? 'is-drop-target' : ''}`}
                                style={{ '--lane-accent': LANE_ACCENTS[stage.id] || stage.color }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (dragOverStage !== stage.id) setDragOverStage(stage.id);
                                }}
                                onDragLeave={(e) => {
                                    // Only clear when leaving the lane entirely, not when moving to a child
                                    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStage(null);
                                }}
                                onDrop={(e) => handleDrop(e, stage.id)}
                            >
                                <div className="v2-lane__header">
                                    <div className="v2-lane__title-row">
                                        <div className="v2-lane__title">
                                            <span className="v2-lane__title-dot" />
                                            {stage.label}
                                        </div>
                                        <div className="v2-lane__count">{stageDeals.length}</div>
                                    </div>
                                    <div className="v2-lane__value">
                                        <strong>{fmt$(total)}</strong>
                                    </div>
                                </div>
                                <div className="v2-lane__body">
                                    {loading && <div className="v2-lane__empty">Loading…</div>}
                                    {!loading && stageDeals.length === 0 && (
                                        <div className="v2-lane__empty">
                                            {draggingId ? `Drop to move to ${stage.label}` : `No deals in ${stage.label.toLowerCase()}`}
                                        </div>
                                    )}
                                    {stageDeals.map((d) => (
                                        <DealCard
                                            key={d.id}
                                            deal={d}
                                            isDragging={draggingId === d.id}
                                            onDragStart={(deal) => setDraggingId(deal.id)}
                                            onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                                            onClick={(deal) => setDealModal({ mode: 'edit', target: deal })}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Toast (auto-dismiss) */}
            {toast && (
                <div className={`v2-toast v2-toast--${toast.kind}`}>
                    {toast.kind === 'win' && <span className="v2-toast__icon">✓</span>}
                    {toast.kind === 'warn' && <span className="v2-toast__icon">!</span>}
                    {toast.kind === 'info' && <span className="v2-toast__icon">·</span>}
                    <span>{toast.text}</span>
                </div>
            )}

            {/* Create / edit modal */}
            <V2Modal
                open={dealModal !== null}
                onClose={() => setDealModal(null)}
                eyebrow={dealModal?.mode === 'edit' ? 'edit deal' : 'new deal'}
                title={dealModal?.mode === 'edit' ? (dealModal.target?.title || dealModal.target?.company_name || 'Edit deal') : 'Create a deal'}
                footer={
                    dealModal?.mode === 'edit' && (
                        <button
                            type="button"
                            className="v2-btn-link v2-btn-link--danger"
                            onClick={() => setDeleteTarget(dealModal.target)}
                            style={{ marginRight: 'auto' }}
                        >
                            Delete deal
                        </button>
                    )
                }
            >
                {dealModal && (
                    <DealForm
                        initial={dealModal.mode === 'edit' ? dealModal.target : null}
                        onSaved={() => { setDealModal(null); load(); }}
                        onCancel={() => setDealModal(null)}
                    />
                )}
            </V2Modal>

            <V2Confirm
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                eyebrow="careful"
                title="Delete this deal?"
                description={deleteTarget ? `${deleteTarget.company_name} will be removed. Activities and tasks on this deal will be deleted too.` : null}
                confirmLabel="Delete deal"
                confirmTone="danger"
                loading={working}
            />
        </>
    );
}
