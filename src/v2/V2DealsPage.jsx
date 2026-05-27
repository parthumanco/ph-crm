import { useEffect, useMemo, useState } from 'react';
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

/* ============================================
   V2 DEALS KANBAN

   Read-only kanban view wired to lib/deals.js
   fetchDeals(). Active stages render as columns;
   Won and Lost are displayed in dedicated drop
   bars below the stats so there's exactly one
   target for each close action (no duplicate
   stat-card-doubles-as-drop-zone ambiguity).
============================================ */

const LANE_ACCENTS = {
    new: '#6f8ec9',
    discovery: 'var(--v2-blue)',
    proposal: 'var(--v2-purple)',
    negotiation: '#c08850',
    verbal: 'var(--v2-orange)',
    contract: 'var(--v2-teal)',
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

function DealCard({ deal }) {
    const days = daysSince(deal.stage_entered_at || deal.created_at);
    const ageClass = ageWarn(days);
    const owner = ownerAvatar(deal.assigned_to);
    return (
        <div className="v2-deal">
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

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const list = await fetchDeals();
                if (!cancelled) setDeals(list);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load deals');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

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

            {/* Closed lanes — dedicated, unambiguous targets */}
            <div className="v2-closed-strip">
                <div className="v2-closed-lane v2-closed-lane--won">
                    <div className="v2-closed-lane__icon">✓</div>
                    <div className="v2-closed-lane__body">
                        <div className="v2-closed-lane__label">Won lane</div>
                        <div className="v2-closed-lane__hint">{wonCount} closed · auto-creates project on move</div>
                    </div>
                    <div className="v2-closed-lane__count">{wonCount}</div>
                </div>
                <div className="v2-closed-lane v2-closed-lane--lost">
                    <div className="v2-closed-lane__icon">×</div>
                    <div className="v2-closed-lane__body">
                        <div className="v2-closed-lane__label">Lost lane</div>
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
                        return (
                            <div key={stage.id} className="v2-lane" style={{ '--lane-accent': LANE_ACCENTS[stage.id] || stage.color }}>
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
                                        <div className="v2-lane__empty">No deals in {stage.label.toLowerCase()}</div>
                                    )}
                                    {stageDeals.map((d) => <DealCard key={d.id} deal={d} />)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
