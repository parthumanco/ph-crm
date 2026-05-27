import { useEffect, useMemo, useState } from 'react';
import {
    fetchCompanies,
    fetchPipelineCompanyIds,
    distanceMiles,
    TRIGGER_CATEGORIES,
    URGENCY_META,
} from './safe-data.js';

/* ============================================
   V2 SIGNALS — Browse-and-understand surface

   The legacy SignalWatch page is the densest UI
   in the app (~1948 lines, 32 useState hooks,
   three stacked toolbar rows). V2 strips it to
   the read-only essence: see your prospects,
   see what's been detected, see why they score
   where they do.

   Mutations (scan, deep-scan, add-to-pipeline,
   delete, CSV import) live in legacy until the
   redesign is approved. Each row has a single
   "Open in legacy" affordance for those actions.
============================================ */

const TIER_FILTERS = [
    { id: 'all', label: 'All tiers' },
    { id: 'T1',  label: 'Tier 1' },
    { id: 'T2',  label: 'Tier 2' },
    { id: 'T3',  label: 'Tier 3' },
];

const SCORE_FILTERS = [
    { id: 'all', label: 'Any score' },
    { id: '7',   label: '7 +' },
    { id: '5',   label: '5 +' },
    { id: '3',   label: '3 +' },
];

const DISTANCE_FILTERS = [
    { id: 'all', label: 'Any distance' },
    { id: '50',  label: '< 50 mi' },
    { id: '100', label: '< 100 mi' },
    { id: '250', label: '< 250 mi' },
];

const STATUS_FILTERS = [
    { id: 'all',      label: 'All' },
    { id: 'scanned',  label: 'Deep-scanned' },
    { id: 'pending',  label: 'Scan pending' },
    { id: 'pipeline', label: 'In pipeline' },
];

const SIG_FILTERS = [
    { id: 'all', label: 'Any' },
    { id: '7',   label: '7 +' },
    { id: '5',   label: '5 +' },
    { id: '3',   label: '3 +' },
];

const FUNDING_FILTERS = [
    { id: 'all',     label: 'Any',     match: () => true },
    { id: 'seed',    label: 'Seed',    match: (s) => /seed|pre.?seed/i.test(s || '') },
    { id: 'a',       label: 'Series A', match: (s) => /(?:series\s*)?a\b/i.test(s || '') && !/aa/i.test(s || '') },
    { id: 'b',       label: 'Series B', match: (s) => /(?:series\s*)?b\b/i.test(s || '') },
    { id: 'cplus',   label: 'C +',      match: (s) => /(?:series\s*)?[cdefg]/i.test(s || '') || /late/i.test(s || '') },
    { id: 'boot',    label: 'Bootstrap', match: (s) => /boot|self|priv/i.test(s || '') },
];

const EMPLOYEE_FILTERS = [
    { id: 'all',   label: 'Any',     match: () => true },
    { id: '0-30',  label: '< 30',    match: (n) => n !== null && n < 30 },
    { id: '30-100',label: '30–100',  match: (n) => n !== null && n >= 30 && n < 100 },
    { id: '100-500', label: '100–500', match: (n) => n !== null && n >= 100 && n < 500 },
    { id: '500+', label: '500+',     match: (n) => n !== null && n >= 500 },
];

/** Parse employee_count strings like "50", "30-50", "100+", "1000" into a representative number. */
function parseEmployees(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/,/g, '');
    const numbers = s.match(/\d+/g);
    if (!numbers) return null;
    // For ranges use the lower bound; for single values use as-is.
    return parseInt(numbers[0], 10);
}

function ScoreRing({ value, max = 10, accent = 'var(--v2-orange)' }) {
    const v = typeof value === 'number' ? Math.max(0, Math.min(max, value)) : 0;
    const pct = (v / max) * 100;
    const bg = `conic-gradient(${accent} 0% ${pct}%, var(--crm-surface-alt) ${pct}% 100%)`;
    return (
        <div className="v2-score-ring" style={{ background: bg }}>
            <span className="v2-score-ring__value">{value ?? '—'}</span>
        </div>
    );
}

function TriggerPill({ trigger }) {
    const cat = trigger.category || 'social';
    const meta = TRIGGER_CATEGORIES[cat] || TRIGGER_CATEGORIES.social;
    return (
        <div className="v2-trigger" style={{ '--trigger-accent': meta.accent }}>
            <div className="v2-trigger__head">
                <span className="v2-trigger__cat">{meta.label}</span>
                {trigger.urgency && URGENCY_META[trigger.urgency] && (
                    <span className="v2-trigger__urgency" style={{ color: URGENCY_META[trigger.urgency].color }}>
                        {URGENCY_META[trigger.urgency].label}
                    </span>
                )}
            </div>
            <div className="v2-trigger__title">{trigger.headline || trigger.title || trigger.summary || 'Signal'}</div>
            {trigger.detail && <div className="v2-trigger__detail">{trigger.detail}</div>}
            {(trigger.source || trigger.date) && (
                <div className="v2-trigger__meta">
                    {trigger.date && <span>{trigger.date}</span>}
                    {trigger.source && <span>· {trigger.source}</span>}
                </div>
            )}
        </div>
    );
}

function CompanyRow({ company, inPipeline, expanded, onToggle }) {
    const triggers = Array.isArray(company.triggers) ? company.triggers : [];
    const contacts = Array.isArray(company.contacts) ? company.contacts : [];
    const dist = distanceMiles(company.lat, company.lng);
    const topTriggers = triggers.slice(0, 3);
    return (
        <div className={`v2-signal-row ${expanded ? 'is-expanded' : ''}`}>
            <button type="button" className="v2-signal-row__head" onClick={onToggle}>
                <div className="v2-signal-row__scores">
                    <ScoreRing value={company.icp_score} accent="var(--v2-orange)" />
                    <div className="v2-signal-row__score-label">ICP</div>
                </div>

                <div className="v2-signal-row__body">
                    <div className="v2-signal-row__title-row">
                        <span className="v2-signal-row__name">{company.name}</span>
                        {company.icp_tier && (
                            <span className={`v2-tier-chip v2-tier-chip--${company.icp_tier.toLowerCase()}`}>
                                {company.icp_tier}
                            </span>
                        )}
                        {company.deep_scanned ? (
                            <span className="v2-scan-chip v2-scan-chip--done">Deep-scanned</span>
                        ) : (
                            <span className="v2-scan-chip">Scan pending</span>
                        )}
                        {inPipeline && <span className="v2-scan-chip v2-scan-chip--pipeline">In pipeline</span>}
                    </div>

                    <div className="v2-signal-row__meta">
                        {company.industry && <span>{company.industry}</span>}
                        {company.hq && <span>· {company.hq}</span>}
                        {dist !== null && (
                            <span style={dist < 100 ? { color: '#20857c', fontWeight: 600 } : null}>
                                · {dist} mi
                            </span>
                        )}
                        {company.funding_stage && <span>· {company.funding_stage}</span>}
                        {company.employee_count && <span>· {company.employee_count} emp</span>}
                    </div>

                    {topTriggers.length > 0 && (
                        <div className="v2-signal-row__pill-strip">
                            {topTriggers.map((t, i) => {
                                const cat = t.category || 'social';
                                const meta = TRIGGER_CATEGORIES[cat] || TRIGGER_CATEGORIES.social;
                                return (
                                    <span
                                        key={i}
                                        className="v2-trigger-mini"
                                        style={{ '--trigger-accent': meta.accent }}
                                    >
                                        <span className="v2-trigger-mini__dot" />
                                        {meta.label}
                                    </span>
                                );
                            })}
                            {triggers.length > 3 && (
                                <span className="v2-trigger-mini v2-trigger-mini--more">
                                    +{triggers.length - 3} more
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="v2-signal-row__counts">
                    <div className="v2-signal-row__count">
                        <div className="v2-signal-row__count-val">{triggers.length}</div>
                        <div className="v2-signal-row__count-label">triggers</div>
                    </div>
                    <div className="v2-signal-row__count">
                        <div className="v2-signal-row__count-val">{contacts.length}</div>
                        <div className="v2-signal-row__count-label">contacts</div>
                    </div>
                </div>
            </button>

            {expanded && (
                <div className="v2-signal-row__body-detail">
                    {company.summary && (
                        <div className="v2-signal-section">
                            <div className="v2-signal-section__label">Summary</div>
                            <p className="v2-signal-section__body">{company.summary}</p>
                        </div>
                    )}

                    {company.recommended_angle && (
                        <div className="v2-signal-section v2-signal-section--angle">
                            <div className="v2-signal-section__label">Recommended angle</div>
                            <p className="v2-signal-section__body">{company.recommended_angle}</p>
                        </div>
                    )}

                    {triggers.length > 0 && (
                        <div className="v2-signal-section">
                            <div className="v2-signal-section__label">All triggers · {triggers.length}</div>
                            <div className="v2-trigger-grid">
                                {triggers.map((t, i) => <TriggerPill key={i} trigger={t} />)}
                            </div>
                        </div>
                    )}

                    {contacts.length > 0 && (
                        <div className="v2-signal-section">
                            <div className="v2-signal-section__label">Contacts · {contacts.length}</div>
                            <div className="v2-contact-grid">
                                {contacts.map((c, i) => (
                                    <div key={i} className="v2-contact">
                                        <div className="v2-contact__name">{c.name || 'Unknown'}</div>
                                        {c.title && <div className="v2-contact__title">{c.title}</div>}
                                        {c.linkedin && (
                                            <a className="v2-contact__link" href={c.linkedin} target="_blank" rel="noopener noreferrer">
                                                LinkedIn ↗
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="v2-signal-section__legacy">
                        <a
                            href="/"
                            onClick={(e) => { e.preventDefault(); window.location.href = '/'; }}
                            className="v2-section__link"
                        >
                            Open in legacy to scan, edit, or add to pipeline →
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function V2SignalsPage() {
    const [companies, setCompanies] = useState([]);
    const [pipeline, setPipeline] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(null);

    const [tierF,   setTierF]   = useState('all');
    const [scoreF,  setScoreF]  = useState('all');
    const [sigF,    setSigF]    = useState('all');
    const [distF,   setDistF]   = useState('all');
    const [statusF, setStatusF] = useState('all');
    const [fundF,   setFundF]   = useState('all');
    const [empF,    setEmpF]    = useState('all');
    const [indF,    setIndF]    = useState('all');
    const [search,  setSearch]  = useState('');

    const clearAll = () => {
        setTierF('all'); setScoreF('all'); setSigF('all'); setDistF('all');
        setStatusF('all'); setFundF('all'); setEmpF('all'); setIndF('all');
        setSearch('');
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [list, pipeSet] = await Promise.all([
                    fetchCompanies(),
                    fetchPipelineCompanyIds().catch(() => new Set()),
                ]);
                if (cancelled) return;
                setCompanies(list);
                setPipeline(pipeSet);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load signals');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Compute the industry options dynamically from the data — only show
    // industries we actually have, with counts. Sort by frequency desc.
    const industryOptions = useMemo(() => {
        const counts = new Map();
        for (const c of companies) {
            const v = (c.industry || '').trim();
            if (!v) continue;
            counts.set(v, (counts.get(v) || 0) + 1);
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));
    }, [companies]);

    const filtered = useMemo(() => {
        const fundMatch = FUNDING_FILTERS.find((f) => f.id === fundF)?.match || (() => true);
        const empMatch  = EMPLOYEE_FILTERS.find((f) => f.id === empF)?.match  || (() => true);
        return companies.filter((c) => {
            if (tierF !== 'all' && c.icp_tier !== tierF) return false;
            if (scoreF !== 'all') {
                const min = parseInt(scoreF, 10);
                if ((c.icp_score ?? 0) < min) return false;
            }
            if (sigF !== 'all') {
                const min = parseInt(sigF, 10);
                if ((c.overall_score ?? 0) < min) return false;
            }
            if (distF !== 'all') {
                const max = parseInt(distF, 10);
                const d = distanceMiles(c.lat, c.lng);
                if (d === null || d > max) return false;
            }
            if (statusF === 'scanned'  && !c.deep_scanned) return false;
            if (statusF === 'pending'  &&  c.deep_scanned) return false;
            if (statusF === 'pipeline' && !pipeline.has(c.id)) return false;
            if (fundF !== 'all' && !fundMatch(c.funding_stage)) return false;
            if (empF !== 'all') {
                const n = parseEmployees(c.employee_count);
                if (!empMatch(n)) return false;
            }
            if (indF !== 'all' && (c.industry || '').trim() !== indF) return false;
            if (search) {
                const q = search.toLowerCase();
                const haystack = [c.name, c.industry, c.hq, c.funding_stage].filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(q)) return false;
            }
            return true;
        });
    }, [companies, tierF, scoreF, sigF, distF, statusF, fundF, empF, indF, search, pipeline]);

    const stats = useMemo(() => {
        const total = companies.length;
        const deepScanned = companies.filter((c) => c.deep_scanned).length;
        const tier1 = companies.filter((c) => c.icp_tier === 'T1').length;
        const inPipe = companies.filter((c) => pipeline.has(c.id)).length;
        return { total, deepScanned, tier1, inPipe };
    }, [companies, pipeline]);

    const activeFilterCount =
        (tierF !== 'all' ? 1 : 0) +
        (scoreF !== 'all' ? 1 : 0) +
        (sigF !== 'all' ? 1 : 0) +
        (distF !== 'all' ? 1 : 0) +
        (statusF !== 'all' ? 1 : 0) +
        (fundF !== 'all' ? 1 : 0) +
        (empF !== 'all' ? 1 : 0) +
        (indF !== 'all' ? 1 : 0) +
        (search ? 1 : 0);

    return (
        <>
            <div className="v2-page-header" style={{ '--accent-override': 'var(--v2-blue)' }}>
                <div>
                    <div className="v2-page-header__eyebrow" style={{ color: 'var(--v2-blue)' }}>intelligence</div>
                    <h1 className="v2-page-title">
                        Signals
                        {companies.length > 0 && (
                            <span className="v2-page-title__count">
                                {companies.length} {companies.length === 1 ? 'company' : 'companies'} tracked
                            </span>
                        )}
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading ? 'Loading from Supabase…' : `${stats.deepScanned} deep-scanned · ${stats.tier1} Tier 1`}
                    </p>
                </div>
            </div>

            <style>{`.v2-page-header::after { background: var(--v2-blue) !important; }`}</style>

            {error && <div className="v2-error">Couldn't load signals: {error}</div>}

            <div className="v2-stat-row">
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Tracked</div>
                    <div className="v2-stat-card__value">{stats.total}</div>
                    <div className="v2-stat-card__delta">companies</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Deep-scanned</div>
                    <div className="v2-stat-card__value">{stats.deepScanned}</div>
                    <div className="v2-stat-card__delta">
                        {stats.total ? Math.round((stats.deepScanned / stats.total) * 100) : 0}% of total
                    </div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Tier 1</div>
                    <div className="v2-stat-card__value">{stats.tier1}</div>
                    <div className="v2-stat-card__delta">strongest fit</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">In pipeline</div>
                    <div className="v2-stat-card__value">{stats.inPipe}</div>
                    <div className="v2-stat-card__delta v2-good">actively worked</div>
                </div>
            </div>

            {/* Filter panel — grouped, not stacked */}
            <div className="v2-filter-panel">
                <div className="v2-filter-panel__head">
                    <div className="v2-filter-panel__title">
                        Filters
                        {activeFilterCount > 0 && (
                            <span className="v2-filter-panel__count">{activeFilterCount} active</span>
                        )}
                    </div>
                    <div className="v2-filter-panel__head-right">
                        {activeFilterCount > 0 && (
                            <button type="button" className="v2-filter-panel__clear" onClick={clearAll}>
                                Clear all
                            </button>
                        )}
                        <div className="v2-filter-panel__search">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
                            <input
                                type="text"
                                placeholder="Search company, industry, HQ…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="v2-filter-panel__groups">
                    {/* Row 1 — Fit & scoring */}
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">tier</div>
                        <div className="v2-segmented">
                            {TIER_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${tierF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setTierF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">ICP score</div>
                        <div className="v2-segmented">
                            {SCORE_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${scoreF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setScoreF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">signal score</div>
                        <div className="v2-segmented">
                            {SIG_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${sigF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setSigF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">distance</div>
                        <div className="v2-segmented">
                            {DISTANCE_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${distF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setDistF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>

                    {/* Row 2 — Company shape & status */}
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">industry</div>
                        <div className="v2-select-wrap">
                            <select className="v2-select" value={indF} onChange={(e) => setIndF(e.target.value)}>
                                <option value="all">Any industry ({companies.length})</option>
                                {industryOptions.map((opt) => (
                                    <option key={opt.name} value={opt.name}>
                                        {opt.name} ({opt.count})
                                    </option>
                                ))}
                            </select>
                            <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                        </div>
                    </div>
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">funding stage</div>
                        <div className="v2-segmented">
                            {FUNDING_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${fundF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setFundF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">employees</div>
                        <div className="v2-segmented">
                            {EMPLOYEE_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${empF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setEmpF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="v2-filter-group">
                        <div className="v2-filter-group__label">status</div>
                        <div className="v2-segmented">
                            {STATUS_FILTERS.map((f) => (
                                <button key={f.id} type="button"
                                    className={`v2-segmented__item ${statusF === f.id ? 'is-active' : ''}`}
                                    onClick={() => setStatusF(f.id)}>{f.label}</button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="v2-filter-panel__result">
                    {loading ? 'Loading…' : `Showing ${filtered.length} of ${companies.length}`}
                </div>
            </div>

            {/* Signals list */}
            <div className="v2-signal-list">
                {loading && (
                    <div className="v2-empty"><strong>Loading…</strong>Reading companies from Supabase.</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="v2-empty">
                        <strong>No companies match these filters</strong>
                        Clear filters or broaden tier/score to see more.
                    </div>
                )}
                {!loading && filtered.map((c) => (
                    <CompanyRow
                        key={c.id}
                        company={c}
                        inPipeline={pipeline.has(c.id)}
                        expanded={expanded === c.id}
                        onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
                    />
                ))}
            </div>
        </>
    );
}
