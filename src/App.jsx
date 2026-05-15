import { useState, useEffect } from 'react';
import SignalWatchPage from './pages/SignalWatchPage';
import PipelinePage from './pages/PipelinePage';
import WeeklyReportPage from './pages/WeeklyReportPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import { loadIcp, DEFAULT_ICP } from './lib/settings';

const NAV = [
  { id: 'signals',  label: 'Signal Watch',  icon: '📡' },
  { id: 'pipeline', label: 'Pipeline',       icon: '🎯' },
  { id: 'report',   label: 'Weekly Report',  icon: '📋' },
  { id: 'chat',     label: 'AI Assistant',   icon: '💬' },
  { id: 'settings', label: 'ICP Settings',   icon: '⚙️' },
];

// Keeps a page mounted but invisible so background work (scans, report generation) isn't interrupted.
function PageSlot({ active, children }) {
  return (
    <div style={{ display: active ? 'contents' : 'none' }}>
      {children}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('signals');
  const [icp, setIcp]   = useState(DEFAULT_ICP);

  useEffect(() => {
    loadIcp().then(loaded => setIcp(loaded));
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>Part Human</h1>
          <p>Sales Intelligence</p>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-item${page === n.id ? ' active' : ''}`}
              onClick={() => setPage(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          Part Human CRM · v1.1
        </div>
      </aside>

      <main className="main-content">
        <PageSlot active={page === 'signals'}>
          <SignalWatchPage onNavigate={setPage} icp={icp} />
        </PageSlot>
        <PageSlot active={page === 'pipeline'}>
          <PipelinePage icp={icp} />
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
