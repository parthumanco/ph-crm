import { useState, useEffect } from 'react';
import SignalWatchPage from './pages/SignalWatchPage';
import PipelinePage from './pages/PipelinePage';
import DealsPage from './pages/DealsPage';
import SupportPage from './pages/SupportPage';
import ProjectsPage from './pages/ProjectsPage';
import DiscoverPage from './pages/DiscoverPage';
import WeeklyReportPage from './pages/WeeklyReportPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import { loadIcp, DEFAULT_ICP } from './lib/settings';

const NAV = [
  { id: 'projects', label: 'Projects',       icon: '🗂️'  },
  { id: 'pipeline', label: 'Pipeline',       icon: '🔥' },
  { id: 'deals',    label: 'Deals',          icon: '💵' },
  { divider: true },
  { id: 'signals',  label: 'Signal Watch',  icon: '🔭' },
  { id: 'discover', label: 'Discover',       icon: '🧭' },
  { id: 'report',   label: 'Weekly Report',  icon: '📋' },
  { id: 'chat',     label: 'Little Stevie',  icon: '💬' },
  { divider: true },
  { id: 'settings', label: 'ICP Settings',   icon: '⚙️'  },
  { id: 'support',  label: 'Support',        icon: '🎧' },
];

const PAGE_TITLES = {
  signals:  { title: 'Signal Watch',  sub: 'Company intelligence & outreach triggers' },
  pipeline: { title: 'Pipeline',      sub: 'Active prospects & touch cadence' },
  deals:    { title: 'Deals',         sub: 'CRM pipeline, activities & revenue tracking' },
  support:  { title: 'Support',       sub: 'Case management & client communication' },
  projects: { title: 'Projects',      sub: 'Timelines, milestones & deliverables' },
  discover: { title: 'Discover',      sub: 'Find new companies to add to your watch list' },
  report:   { title: 'Weekly Report', sub: 'AI briefing & draft outreach' },
  chat:     { title: 'Little Stevie', sub: 'Ask anything about your pipeline' },
  settings: { title: 'ICP Settings',  sub: 'Ideal customer profile & outreach voice' },
};

// Keeps a page mounted but invisible so background work (scans, report generation) isn't interrupted.
function PageSlot({ active, children }) {
  return (
    <div style={{ display: active ? 'contents' : 'none' }}>
      {children}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('projects');
  const [icp, setIcp]   = useState(DEFAULT_ICP);

  useEffect(() => {
    loadIcp().then(loaded => setIcp(loaded));
  }, []);

  const pt = PAGE_TITLES[page] || {};

  return (
    <div className="app-shell">
      {/* Global orange top stripe */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: 'var(--accent)', zIndex: 200 }} />

      <aside className="sidebar">
        <div className="sidebar-logo" style={{ cursor: 'pointer' }} onClick={() => setPage('projects')}>
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
                onClick={() => setPage(n.id)}
              >
                <span className="nav-icon">{n.icon}</span>
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
          <button
            onClick={() => setPage('projects')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <h2 className="app-page-title">{pt.title}</h2>
            <p className="app-page-sub">{pt.sub}</p>
          </button>
        </div>
        <PageSlot active={page === 'signals'}>
          <SignalWatchPage onNavigate={setPage} icp={icp} />
        </PageSlot>
        <PageSlot active={page === 'pipeline'}>
          <PipelinePage icp={icp} />
        </PageSlot>
        <PageSlot active={page === 'deals'}>
          <DealsPage />
        </PageSlot>
        <PageSlot active={page === 'support'}>
          <SupportPage />
        </PageSlot>
        <PageSlot active={page === 'projects'}>
          <ProjectsPage />
        </PageSlot>
        <PageSlot active={page === 'discover'}>
          <DiscoverPage icp={icp} />
        </PageSlot>
        <PageSlot active={page === 'report'}>
          <WeeklyReportPage icp={icp} />
        </PageSlot>
        <PageSlot active={page === 'chat'}>
          <ChatPage />
        </PageSlot>
        <PageSlot active={page === 'settings'}>
          <SettingsPage icp={icp} onIcpSaved={setIcp} />
        </PageSlot>
      </main>
    </div>
  );
}
