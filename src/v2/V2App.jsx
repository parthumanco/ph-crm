import { useState } from 'react';
import V2ProjectsPage from './V2ProjectsPage.jsx';
import './v2.css';

/* ============================================
   V2 SHELL — Redesigned CRM

   Loaded by main.jsx when window.location.pathname
   starts with "/v2". Replaces the entire legacy
   App tree while on a /v2 URL; legacy app at /
   stays bit-for-bit untouched.

   First-pass scope: shell + Projects page only.
   Every other sidebar item shows a placeholder
   that points back at the prototype set so we can
   port them in subsequent passes without
   half-breaking the new app.
============================================ */

const NAV_SECTIONS = [
    {
        label: 'work',
        items: [
            { id: 'projects', label: 'Projects', icon: 'folder', count: null },
            { id: 'deals',    label: 'Deals',    icon: 'cash',   count: null },
            { id: 'accounts', label: 'Accounts', icon: 'list',   count: null },
            { id: 'support',  label: 'Support',  icon: 'support',count: null },
        ],
    },
    {
        label: 'prospecting',
        items: [
            { id: 'signals',  label: 'Signals',  icon: 'spark' },
            { id: 'discover', label: 'Discover', icon: 'search' },
            { id: 'outreach', label: 'Outreach', icon: 'wave' },
        ],
    },
    {
        label: 'tools',
        items: [
            { id: 'report',   label: 'Weekly Report', icon: 'doc' },
            { id: 'chat',     label: 'Little Stevie', icon: 'chat' },
            { id: 'settings', label: 'ICP Settings',  icon: 'gear' },
        ],
    },
];

const PAGE_META = {
    projects: { eyebrow: 'currently in flight',   title: 'Projects', breadcrumb: 'Projects' },
    deals:    { eyebrow: 'the pipeline',          title: 'Deals',    breadcrumb: 'Deals' },
    accounts: { eyebrow: 'your network',          title: 'Accounts', breadcrumb: 'Accounts' },
    support:  { eyebrow: 'client care',           title: 'Support',  breadcrumb: 'Support' },
    signals:  { eyebrow: 'intelligence',          title: 'Signals',  breadcrumb: 'Signals' },
    discover: { eyebrow: 'find your next client', title: 'Discover', breadcrumb: 'Discover' },
    outreach: { eyebrow: 'cold to warm',          title: 'Outreach', breadcrumb: 'Outreach' },
    report:   { eyebrow: 'this week',             title: 'Weekly Report', breadcrumb: 'Weekly Report' },
    chat:     { eyebrow: 'ask the data',          title: 'Little Stevie', breadcrumb: 'Little Stevie' },
    settings: { eyebrow: 'who you serve',         title: 'ICP Settings', breadcrumb: 'ICP Settings' },
};

function Icon({ name }) {
    const stroke = { stroke: 'currentColor', fill: 'none', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };
    switch (name) {
        case 'folder':  return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
        case 'cash':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M5 8h14M5 12h14M5 16h8"/><circle cx="19" cy="16" r="2"/></svg>;
        case 'list':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M20 7H4M4 12h12M4 17h8"/></svg>;
        case 'support': return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M12 21a9 9 0 1 0-9-9"/><path d="M12 17v-5l3 1.5"/></svg>;
        case 'spark':   return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2M7.05 7.05l1.4 1.4M15.55 15.55l1.4 1.4M7.05 16.95l1.4-1.4M15.55 8.45l1.4-1.4"/></svg>;
        case 'search':  return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>;
        case 'wave':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M3 12c4-6 14-6 18 0M3 12c4 6 14 6 18 0"/><circle cx="12" cy="12" r="2"/></svg>;
        case 'doc':     return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M6 4h12v16l-6-3-6 3z"/></svg>;
        case 'chat':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M21 12a8 8 0 1 1-3-6"/><path d="M21 4v5h-5"/></svg>;
        case 'gear':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
        default: return null;
    }
}

function V2Placeholder({ pageKey, meta }) {
    return (
        <div className="v2-placeholder">
            <div className="v2-placeholder__eyebrow">{meta?.eyebrow || 'coming next'}</div>
            <div className="v2-placeholder__title">{meta?.title || pageKey}</div>
            <p className="v2-placeholder__body">
                Not ported yet. The visual direction for this surface is in the static prototype set.
            </p>
            <p className="v2-placeholder__hint">
                <a href="/" onClick={(e) => { e.preventDefault(); window.location.href = '/'; }}>
                    ← Use the legacy {meta?.title || pageKey} for now
                </a>
            </p>
        </div>
    );
}

export default function V2App() {
    const [page, setPage] = useState('projects');
    const meta = PAGE_META[page];

    return (
        <div className="v2-app">

            <aside className="v2-sidebar">
                <div className="v2-sidebar__brand">
                    <div className="v2-sidebar__brand-mark">P</div>
                    <div>
                        <div className="v2-sidebar__brand-name">Part Human</div>
                        <div className="v2-sidebar__brand-sub">CRM · v2</div>
                    </div>
                </div>

                <nav className="v2-sidebar__sections">
                    {NAV_SECTIONS.map((section) => (
                        <div key={section.label} className="v2-nav-section">
                            <div className="v2-nav-section__label">{section.label}</div>
                            <div className="v2-nav-section__items">
                                {section.items.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`v2-nav-item ${page === item.id ? 'is-active' : ''}`}
                                        onClick={() => setPage(item.id)}
                                    >
                                        <Icon name={item.icon} />
                                        <span className="v2-nav-item__label">{item.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className="v2-sidebar__footer">
                    <div className="v2-sidebar__user">
                        <div className="v2-sidebar__user-avatar">PA</div>
                        <div className="v2-sidebar__user-name">Peter</div>
                    </div>
                    <a
                        className="v2-sidebar__exit"
                        href="/"
                        onClick={(e) => { e.preventDefault(); window.location.href = '/'; }}
                        title="Return to the existing app"
                    >
                        legacy →
                    </a>
                </div>
            </aside>

            <div className="v2-main">

                <header className="v2-header">
                    <div className="v2-breadcrumb">
                        <span>Work</span>
                        <span className="v2-breadcrumb__sep">/</span>
                        <span className="v2-breadcrumb__current">{meta?.breadcrumb || page}</span>
                    </div>
                    <div className="v2-header__actions">
                        <div className="v2-search">
                            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
                            <input type="text" placeholder="Search projects, deals, accounts…" />
                            <kbd>⌘K</kbd>
                        </div>
                    </div>
                </header>

                <div className="v2-banner">
                    Prototype UI · /v2 redesign branch
                    <a onClick={() => { window.location.href = '/'; }}>↩ legacy app</a>
                </div>

                <div className="v2-content">
                    {page === 'projects'
                        ? <V2ProjectsPage />
                        : <V2Placeholder pageKey={page} meta={meta} />}
                </div>

            </div>

        </div>
    );
}
