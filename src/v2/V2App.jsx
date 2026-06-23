import { useEffect, useState } from 'react';
import { loadIcp, DEFAULT_ICP } from '../lib/settings.js';

// V2 pages — fully redesigned
import V2ProjectsPage from './V2ProjectsPage.jsx';
import V2ProjectPage from './V2ProjectPage.jsx';
import V2DealsPage from './V2DealsPage.jsx';
import V2AccountsPage from './V2AccountsPage.jsx';
import V2AccountPage from './V2AccountPage.jsx';
import V2SupportPage from './V2SupportPage.jsx';
import V2SignalsPage from './V2SignalsPage.jsx';

// Legacy pages — rendered inside the v2 shell until ported
import LegacyDiscoverPage from '../pages/DiscoverPage.jsx';
import LegacyPipelinePage from '../pages/PipelinePage.jsx';
import LegacyWeeklyReportPage from '../pages/WeeklyReportPage.jsx';
import LegacyChatPage from '../pages/ChatPage.jsx';
import LegacySettingsPage from '../pages/SettingsPage.jsx';
import LegacyDocumentsPage from '../pages/DocumentsPage.jsx';
import LegacyOldGoldPage from '../pages/OldGoldPage.jsx';
import LegacyClientsPage from '../pages/ClientsPage.jsx';

import './v2.css';

/* ============================================
   V2 SHELL — Redesigned CRM

   Mounted at root and /v2/* by main.jsx. Routes
   not yet ported to V2 render their LEGACY
   counterpart inside the v2 shell, so Mike's
   ongoing work on main flows through to the v2
   instance automatically via the weekly
   main → ux/redesign-v2 merge.

   Read-only guarantee
   ───────────────────
   Every V2 page imports data only through
   safe-data.js (reads) and write-data.js
   (mutations). Adding a write requires explicitly
   re-exporting it from write-data.js — making the
   decision visible in code review.

   Legacy-in-shell pages
   ─────────────────────
   Render directly via their imported component
   with whatever props App.jsx passes them. They
   carry their own inline styling and lifecycle.
   That's fine — they keep working while we
   progressively replace each with a V2 version.
============================================ */

const NAV_SECTIONS = [
    {
        label: 'work',
        items: [
            { id: 'projects',  label: 'Projects',  icon: 'folder' },
            { id: 'deals',     label: 'Deals',     icon: 'cash' },
            { id: 'accounts',  label: 'Accounts',  icon: 'list' },
            { id: 'clients',   label: 'Clients',   icon: 'building' },
            { id: 'documents', label: 'Documents', icon: 'doc' },
            { id: 'support',   label: 'Support',   icon: 'support' },
        ],
    },
    {
        label: 'prospecting',
        items: [
            { id: 'signals',  label: 'Signals',  icon: 'spark' },
            { id: 'discover', label: 'Discover', icon: 'search' },
            { id: 'outreach', label: 'Outreach', icon: 'wave' },
            { id: 'oldgold',  label: 'Old Gold', icon: 'coin' },
        ],
    },
    {
        label: 'tools',
        items: [
            { id: 'report',   label: 'Weekly Report', icon: 'report' },
            { id: 'chat',     label: 'Little Stevie', icon: 'chat' },
            { id: 'settings', label: 'ICP Settings',  icon: 'gear' },
        ],
    },
];

const PAGE_META = {
    projects:        { breadcrumb: 'Projects' },
    'project-detail':{ breadcrumb: 'Project detail' },
    deals:           { breadcrumb: 'Deals' },
    accounts:        { breadcrumb: 'Accounts' },
    'account-detail':{ breadcrumb: 'Account' },
    clients:         { breadcrumb: 'Clients' },
    documents:       { breadcrumb: 'Documents' },
    support:         { breadcrumb: 'Support' },
    signals:         { breadcrumb: 'Signals' },
    discover:        { breadcrumb: 'Discover' },
    outreach:        { breadcrumb: 'Outreach (Active Pipeline)' },
    oldgold:         { breadcrumb: 'Old Gold' },
    report:          { breadcrumb: 'Weekly Report' },
    chat:            { breadcrumb: 'Little Stevie' },
    settings:        { breadcrumb: 'ICP Settings' },
};

// Pages with a V2-native component. Everything else in NAV_SECTIONS falls
// back to its legacy component inside the v2 shell.
const PORTED = new Set([
    'projects', 'project-detail', 'deals',
    'accounts', 'account-detail', 'support', 'signals',
]);

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
        case 'gear':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3"/></svg>;
        case 'building':return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V11h6v10"/></svg>;
        case 'coin':    return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>;
        case 'report':  return <svg className="v2-nav-item__icon" viewBox="0 0 24 24" {...stroke}><path d="M6 4h12v16l-6-3-6 3z"/></svg>;
        default: return null;
    }
}

/** Wraps a legacy page so the v2 shell sets the visual context.
    Pages keep their inline styles and inner layout; we just normalize
    padding and provide a hook for any v2-side overrides. */
function LegacyShim({ pageKey, children }) {
    return (
        <div className="v2-legacy-shim" data-legacy-page={pageKey}>
            <div className="v2-legacy-shim__banner">
                <span className="v2-legacy-shim__eyebrow">legacy view</span>
                <span className="v2-legacy-shim__text">
                    Mike's working surface for <strong>{pageKey}</strong> — flows through to v2 until we port the design.
                </span>
            </div>
            <div className="v2-legacy-shim__body">{children}</div>
        </div>
    );
}

export default function V2App() {
    // Single source of truth for navigation. Detail views carry an id
    // so we can drill into a specific record without changing the URL
    // (URL routing comes in a later phase).
    const [view, setView] = useState({ page: 'projects', projectId: null, accountName: null });
    const goTo = (page, extras = {}) => setView({ page, projectId: null, accountName: null, ...extras });

    // ICP — loaded once at mount, kept in sync when legacy SettingsPage
    // saves a new value. Legacy pages expect this prop.
    const [icp, setIcp] = useState(DEFAULT_ICP);
    useEffect(() => {
        loadIcp().then((loaded) => setIcp(loaded)).catch(() => { /* keep DEFAULT_ICP */ });
    }, []);

    const meta = PAGE_META[view.page];

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
                                {section.items.map((item) => {
                                    const isActive = view.page === item.id
                                        || (view.page === 'project-detail' && item.id === 'projects')
                                        || (view.page === 'account-detail' && item.id === 'accounts');
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`v2-nav-item ${isActive ? 'is-active' : ''}`}
                                            onClick={() => goTo(item.id)}
                                        >
                                            <Icon name={item.icon} />
                                            <span className="v2-nav-item__label">{item.label}</span>
                                        </button>
                                    );
                                })}
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
                        onClick={(e) => { e.preventDefault(); window.location.href = '/legacy'; }}
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
                        <span className="v2-breadcrumb__current">{meta?.breadcrumb || view.page}</span>
                    </div>
                    <div className="v2-header__actions">
                        <div className="v2-search">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
                            <input type="text" placeholder="Search projects, deals, accounts…" />
                            <kbd>⌘K</kbd>
                        </div>
                    </div>
                </header>

                <div className="v2-banner">
                    Prototype UI · /v2 redesign branch · read-only
                    <a onClick={() => { window.location.href = '/legacy'; }}>↩ legacy app</a>
                </div>

                <div className="v2-content">
                    {view.page === 'projects' && (
                        <V2ProjectsPage onSelect={(id) => setView({ page: 'project-detail', projectId: id, accountName: null })} />
                    )}
                    {view.page === 'project-detail' && (
                        <V2ProjectPage projectId={view.projectId} onBack={() => goTo('projects')} />
                    )}
                    {view.page === 'deals' && <V2DealsPage />}
                    {view.page === 'accounts' && (
                        <V2AccountsPage onSelect={(name) => setView({ page: 'account-detail', projectId: null, accountName: name })} />
                    )}
                    {view.page === 'account-detail' && (
                        <V2AccountPage
                            accountName={view.accountName}
                            onBack={() => goTo('accounts')}
                            onSelectProject={(id) => setView({ page: 'project-detail', projectId: id, accountName: null })}
                        />
                    )}
                    {view.page === 'support' && <V2SupportPage />}
                    {view.page === 'signals' && <V2SignalsPage />}

                    {/* Legacy-in-shell fallbacks — Mike's pages render here
                        until they get a V2 counterpart. Each receives the
                        same props its legacy App.jsx call site uses. */}
                    {view.page === 'discover'  && <LegacyShim pageKey="Discover">      <LegacyDiscoverPage icp={icp} /></LegacyShim>}
                    {view.page === 'outreach'  && <LegacyShim pageKey="Outreach">      <LegacyPipelinePage icp={icp} /></LegacyShim>}
                    {view.page === 'report'    && <LegacyShim pageKey="Weekly Report"> <LegacyWeeklyReportPage icp={icp} /></LegacyShim>}
                    {view.page === 'chat'      && <LegacyShim pageKey="Little Stevie"> <LegacyChatPage /></LegacyShim>}
                    {view.page === 'settings'  && <LegacyShim pageKey="ICP Settings">  <LegacySettingsPage icp={icp} onIcpSaved={setIcp} /></LegacyShim>}
                    {view.page === 'documents' && <LegacyShim pageKey="Documents">     <LegacyDocumentsPage /></LegacyShim>}
                    {view.page === 'oldgold'   && <LegacyShim pageKey="Old Gold">      <LegacyOldGoldPage isActive={true} onNavigate={goTo} /></LegacyShim>}
                    {view.page === 'clients'   && <LegacyShim pageKey="Clients">       <LegacyClientsPage icp={icp} onNavigate={goTo} /></LegacyShim>}
                </div>

            </div>

        </div>
    );
}
