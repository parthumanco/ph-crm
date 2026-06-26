import { useState, useEffect, useRef } from 'react';
import SignalWatchPage from './pages/SignalWatchPage';
import PipelinePage from './pages/PipelinePage';
import DealsPage from './pages/DealsPage';
import SupportPage from './pages/SupportPage';
import ProjectsPage from './pages/ProjectsPage';
import ClientsPage from './pages/ClientsPage';
import DiscoverPage from './pages/DiscoverPage';
import WeeklyReportPage from './pages/WeeklyReportPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import OldGoldPage from './pages/OldGoldPage';
import DocumentsPage from './pages/DocumentsPage';
import { loadIcp, DEFAULT_ICP, loadTeamMembers, DEFAULT_TEAM_MEMBERS } from './lib/settings';
import { checkAndFireReminders } from './lib/reminders';

const NAV = [
  { id: 'clients',  label: 'Clients',            icon: '🏢' },
  { id: 'projects', label: 'Projects',            icon: '📌' },
  { divider: true },
  { id: 'deals',    label: 'Pipeline',            icon: '💵' },
  { id: 'oldgold',  label: 'Networking / Old Gold', icon: '🪙' },
  { divider: true },
  { id: 'pipeline', label: 'Cold Outreach',       icon: '🔥' },
  { id: 'report',   label: 'Outreach Planner',    icon: '📋' },
  { id: 'chat',      label: 'Little Stevie',      icon: '💬' },
  { divider: true },
  { id: 'signals',  label: 'Watch List',           icon: '🌡️' },
  { id: 'discover', label: 'Find New Companies',  icon: '🧭' },
  { divider: true },
  { id: 'documents', label: 'Document Builder',   icon: '📄' },
  { divider: true },
  { id: 'settings',  label: 'Settings',           icon: '⚙️'  },
  { id: 'support',  label: 'Support',             icon: '🎧' },
];

const PAGE_TITLES = {
  clients:  { title: 'Clients',              sub: 'Active and archived client history, contacts & AI insights' },
  signals:  { title: 'Watch List',            sub: 'Company intelligence & outreach triggers' },
  pipeline: { title: 'Cold Outreach',        sub: 'Active prospects & touch cadence' },
  oldgold:  { title: 'Networking / Old Gold', sub: "Pete's warm outreach — discovery conversations & next steps" },
  deals:    { title: 'Pipeline',             sub: 'CRM pipeline, activities & revenue tracking' },
  support:  { title: 'Support',              sub: 'Case management & client communication' },
  projects: { title: 'Projects',             sub: 'Timelines, milestones & deliverables' },
  discover: { title: 'Find New Companies',   sub: 'Find new companies to add to your watch list' },
  report:   { title: 'Outreach Planner',     sub: 'AI briefing & draft outreach' },
  chat:      { title: 'Little Stevie',        sub: 'Ask anything about your pipeline' },
  documents: { title: 'Document Builder',    sub: 'Proposals, SOWs, MSAs, MNDAs & Goals + Objectives' },
  settings:  { title: 'Settings',            sub: 'ICP, team, billing rates & notifications' },
};

// Keeps a page mounted but invisible so background work (scans, report generation) isn't interrupted.
function PageSlot({ active, children }) {
  return (
    <div style={{ display: active ? 'contents' : 'none' }}>
      {children}
    </div>
  );
}

const VALID_PAGES = new Set(['clients','projects','deals','pipeline','report','oldgold','discover','signals','chat','documents','settings','support']);

function pageFromHash() {
  const h = window.location.hash.replace('#', '');
  return VALID_PAGES.has(h) ? h : null;
}

export default function App() {
  const [page, setPage]               = useState(() => pageFromHash() || localStorage.getItem('ph_current_page') || 'projects');
  const [pageKeys, setPageKeys]       = useState({});
  const [icp, setIcp]                 = useState(DEFAULT_ICP);
  const [teamMembers, setTeamMembers] = useState(DEFAULT_TEAM_MEMBERS);
  const [targetDealId, setTargetDealId] = useState(null);
  const [targetProjectId, setTargetProjectId] = useState(null);
  const [targetSignalCompany, setTargetSignalCompany] = useState(null);
  const [targetClientName, setTargetClientName] = useState(null);
  const projectsGoHome                = useRef(null); // ProjectsPage registers its goHome fn here

  useEffect(() => {
    loadIcp().then(loaded => setIcp(loaded));
    loadTeamMembers().then(setTeamMembers);
    checkAndFireReminders(); // fire any due/overdue task reminders on load
  }, []);

  // Sync initial hash if missing
  useEffect(() => {
    if (!window.location.hash) window.location.replace('#' + page);
  }, []);

  // Browser back/forward
  useEffect(() => {
    const onPop = () => {
      const p = pageFromHash();
      if (p) {
        setPageKeys(prev => ({ ...prev, [p]: (prev[p] || 0) + 1 }));
        setPage(p);
        localStorage.setItem('ph_current_page', p);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Increment the refresh key for a page every time the user navigates to it,
  // so each page's load useEffect re-runs on every tab switch.
  // Optional second arg: dealId to deep-link into a specific deal card on DealsPage.
  function handleSetPage(newPage, secondArg = null, projectId = null) {
    setPageKeys(prev => ({ ...prev, [newPage]: (prev[newPage] || 0) + 1 }));
    setPage(newPage);
    if (newPage === 'signals') {
      if (secondArg) setTargetSignalCompany(secondArg);
    } else if (newPage === 'clients') {
      if (secondArg) setTargetClientName(secondArg);
    } else {
      if (secondArg) setTargetDealId(secondArg);
    }
    if (projectId) setTargetProjectId(projectId);
    localStorage.setItem('ph_current_page', newPage);
    window.history.pushState({ page: newPage }, '', '#' + newPage);
  }

  const pt = PAGE_TITLES[page] || {};

  return (
    <div className="app-shell">
      {/* Global orange top stripe */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: 'var(--accent)', zIndex: 200 }} />

      <aside className="sidebar">
        <div className="sidebar-logo" style={{ cursor: 'pointer' }} onClick={() => handleSetPage('projects')}>
          <img src="/ph-logo.svg" alt="Part Human" className="sidebar-logo-img" />
          <div className="sidebar-logo-tag">Sales Intelligence</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((n, i) => n.divider
            ? <div key={`divider-${i}`} style={{ height: 1, background: 'var(--border)', margin: '6px 12px' }} />
            : (
              <button
                key={n.id}
                className={`nav-item${page === n.id ? ' active' : ''}`}
                onClick={() => { handleSetPage(n.id); if (n.id === 'projects') projectsGoHome.current?.(); }}
              >
                {n.label}
              </button>
            )
          )}
        </nav>
        <div className="sidebar-footer">v1.7</div>
      </aside>

      <main className="main-content">
        {/* Unified page header driven by page state */}
        <div className="app-page-header">
          <div>
            <h2 className="app-page-title">{pt.title}</h2>
            <p className="app-page-sub">{pt.sub}</p>
          </div>
        </div>
        <PageSlot active={page === 'clients'}>
          <ClientsPage onNavigate={handleSetPage} refreshKey={pageKeys.clients || 0} icp={icp} targetClientName={targetClientName} onTargetClientConsumed={() => setTargetClientName(null)} />
        </PageSlot>
        <PageSlot active={page === 'signals'}>
          <SignalWatchPage onNavigate={handleSetPage} icp={icp} refreshKey={pageKeys.signals || 0} isActive={page === 'signals'} targetCompany={targetSignalCompany} onTargetCompanyConsumed={() => setTargetSignalCompany(null)} />
        </PageSlot>
        <PageSlot active={page === 'pipeline'}>
          <PipelinePage icp={icp} refreshKey={pageKeys.pipeline || 0} onNavigate={handleSetPage} />
        </PageSlot>
        <PageSlot active={page === 'deals'}>
          <DealsPage refreshKey={pageKeys.deals || 0} targetDealId={targetDealId} onTargetDealConsumed={() => setTargetDealId(null)} teamMembers={teamMembers} />
        </PageSlot>
        <PageSlot active={page === 'support'}>
          <SupportPage teamMembers={teamMembers} />
        </PageSlot>
        <PageSlot active={page === 'projects'}>
          <ProjectsPage goHomeRef={projectsGoHome} refreshKey={pageKeys.projects || 0} teamMembers={teamMembers} targetProjectId={targetProjectId} onTargetProjectConsumed={() => setTargetProjectId(null)} />
        </PageSlot>
        <PageSlot active={page === 'discover'}>
          <DiscoverPage icp={icp} refreshKey={pageKeys.discover || 0} />
        </PageSlot>
        <PageSlot active={page === 'oldgold'}>
          <OldGoldPage isActive={page === 'oldgold'} onNavigate={handleSetPage} icp={icp} />
        </PageSlot>
        <PageSlot active={page === 'report'}>
          <WeeklyReportPage icp={icp} refreshKey={pageKeys.report || 0} />
        </PageSlot>
        <PageSlot active={page === 'chat'}>
          <ChatPage />
        </PageSlot>
        <PageSlot active={page === 'documents'}>
          <DocumentsPage refreshKey={pageKeys.documents || 0} onNavigate={handleSetPage} />
        </PageSlot>
        <PageSlot active={page === 'settings'}>
          <SettingsPage icp={icp} onIcpSaved={setIcp} teamMembers={teamMembers} onTeamMembersSaved={setTeamMembers} />
        </PageSlot>
      </main>
    </div>
  );
}
