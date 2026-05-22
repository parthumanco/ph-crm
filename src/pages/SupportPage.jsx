import { useState, useEffect, useCallback } from 'react';
import {
  fetchCases,
  CASE_STATUSES, CASE_PRIORITIES,
  statusColor, statusLabel, priorityColor, priorityLabel,
  channelIcon, channelLabel, slaSummary,
} from '../lib/support';
import CaseDetailModal from '../components/CaseDetailModal';

const OWNERS = ['Mike', 'Pete'];

function PriorityBadge({ priority }) {
  const color = priorityColor(priority);
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10,
      background: `${color}18`, color, border: `1px solid ${color}35`,
      textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap',
    }}>
      {priorityLabel(priority)}
    </span>
  );
}

function StatusBadge({ status }) {
  const color = statusColor(status);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: `${color}18`, color, whiteSpace: 'nowrap',
    }}>
      {statusLabel(status)}
    </span>
  );
}

function SlaChip({ dueAt, resolvedAt, status }) {
  if (['resolved', 'closed'].includes(status)) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>✓ Done</span>;
  }
  const s = slaSummary(dueAt, resolvedAt);
  if (!s) return <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>;
  const color = s.status === 'ok' ? '#10b981' : s.status === 'warning' ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color }}>
      {s.status === 'overdue' ? '⚠️ ' : ''}{s.label}
    </span>
  );
}

function daysSince(dateStr) {
  if (!dateStr) return '—';
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

export default function SupportPage() {
  const [cases, setCases]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedCase, setSelectedCase] = useState(null);
  const [showNew, setShowNew]       = useState(false);
  const [filters, setFilters]       = useState({ status: '', priority: '', assigned: '', search: '' });

  const load = useCallback(async () => {
    try {
      const data = await fetchCases();
      setCases(data);
    } catch (e) {
      console.error('Failed to load cases:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const open        = cases.filter(c => c.status === 'open').length;
  const inProgress  = cases.filter(c => c.status === 'in_progress').length;
  const waiting     = cases.filter(c => c.status === 'waiting').length;
  const today       = new Date().toISOString().slice(0, 10);
  const resolvedToday = cases.filter(c => c.resolved_at?.slice(0, 10) === today).length;
  const resolved    = cases.filter(c => ['resolved', 'closed'].includes(c.status) && c.due_at && c.resolved_at);
  const slaOk       = resolved.filter(c => new Date(c.resolved_at) <= new Date(c.due_at)).length;
  const slaRate     = resolved.length > 0 ? Math.round(slaOk / resolved.length * 100) : null;

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = cases.filter(c => {
    if (filters.status   && c.status      !== filters.status)   return false;
    if (filters.priority && c.priority    !== filters.priority) return false;
    if (filters.assigned && c.assigned_to !== filters.assigned) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (
        !c.title?.toLowerCase().includes(q) &&
        !c.company_name?.toLowerCase().includes(q) &&
        !c.contact_name?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSaved = (saved) => {
    if (!saved) {
      setCases(prev => prev.filter(c => c.id !== selectedCase?.id));
      setSelectedCase(null);
    } else if (cases.find(c => c.id === saved.id)) {
      setCases(prev => prev.map(c => c.id === saved.id ? saved : c));
      setSelectedCase(saved);
    } else {
      setCases(prev => [saved, ...prev]);
      setShowNew(false);
      setSelectedCase(saved);
    }
  };

  const newTemplate = {
    title: '', description: '', notes: '',
    company_name: '', contact_name: '', contact_email: '',
    channel: 'email', status: 'open', priority: 'normal', assigned_to: 'Mike',
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>🎧 Support</h2>
          <p>{open + inProgress} active · {cases.length} total</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => { setSelectedCase(null); setShowNew(true); }}>
            + New Case
          </button>
        </div>
      </div>

      <div className="page-body">

        {/* Stats */}
        <div className="stats-row cols-4" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-val" style={{ color: '#3b82f6' }}>{open}</div>
            <div className="stat-label">Open</div>
            <div className="stat-sub">Awaiting response</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: '#f59e0b' }}>{inProgress}</div>
            <div className="stat-label">In Progress</div>
            <div className="stat-sub">Actively being worked</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: '#8b5cf6' }}>{waiting}</div>
            <div className="stat-label">Waiting on Client</div>
            <div className="stat-sub">Pending their reply</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{
              color: slaRate === null ? 'var(--text-faint)' : slaRate >= 80 ? '#10b981' : '#ef4444',
            }}>
              {slaRate === null ? '—' : `${slaRate}%`}
            </div>
            <div className="stat-label">SLA On-Time</div>
            <div className="stat-sub">{resolvedToday} resolved today</div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {/* Status tabs */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 8, padding: 3 }}>
            {[{ id: '', label: 'All', color: 'var(--text)' }, ...CASE_STATUSES].map(s => (
              <button
                key={s.id}
                onClick={() => setFilters(f => ({ ...f, status: s.id }))}
                style={{
                  padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600,
                  background: filters.status === s.id ? 'var(--surface)' : 'transparent',
                  color: filters.status === s.id ? (s.color || 'var(--text)') : 'var(--text-muted)',
                  boxShadow: filters.status === s.id ? 'var(--shadow)' : 'none',
                  transition: 'all .15s',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Priority */}
          <select
            value={filters.priority}
            onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
            style={{ width: 'auto', fontSize: 12, padding: '5px 10px' }}
          >
            <option value="">All Priorities</option>
            {CASE_PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          {/* Assigned */}
          <select
            value={filters.assigned}
            onChange={e => setFilters(f => ({ ...f, assigned: e.target.value }))}
            style={{ width: 'auto', fontSize: 12, padding: '5px 10px' }}
          >
            <option value="">All Owners</option>
            {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search cases…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            style={{ marginLeft: 'auto', width: 200, fontSize: 12, padding: '5px 12px', minHeight: 'unset' }}
          />
        </div>

        {/* Case list */}
        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
            <p style={{ marginTop: 12 }}>Loading cases…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎧</div>
            <h3>No cases found</h3>
            <p>{cases.length === 0 ? 'Create your first support case to get started.' : 'Try adjusting your filters.'}</p>
            {cases.length === 0 && (
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowNew(true)}>
                + New Case
              </button>
            )}
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '76px 1fr 100px 120px 130px 72px 64px',
              gap: 12, padding: '8px 16px',
              background: 'var(--surface-2)',
              borderBottom: '1px solid var(--border)',
              fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
              letterSpacing: '.05em', color: 'var(--text-faint)',
            }}>
              <div>Case</div>
              <div>Subject · Company</div>
              <div>Priority</div>
              <div>Status</div>
              <div>SLA</div>
              <div>Owner</div>
              <div>Age</div>
            </div>

            {/* Data rows */}
            {filtered.map((c, i) => (
              <div
                key={c.id}
                onClick={() => { setShowNew(false); setSelectedCase(c); }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '76px 1fr 100px 120px 130px 72px 64px',
                  gap: 12, padding: '11px 16px',
                  background: i % 2 === 0 ? 'var(--surface)' : 'var(--bg)',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border-light)' : 'none',
                  cursor: 'pointer', alignItems: 'center',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'var(--surface)' : 'var(--bg)'}
              >
                {/* Case # + channel icon */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', fontFamily: 'monospace', letterSpacing: '-.02em' }}>
                    #{String(c.case_number).padStart(4, '0')}
                  </div>
                  <div style={{ fontSize: 14, marginTop: 2 }} title={channelLabel(c.channel)}>
                    {channelIcon(c.channel)}
                  </div>
                </div>

                {/* Subject + company */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || '(No subject)'}
                  </div>
                  {(c.company_name || c.contact_name) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.company_name}{c.contact_name ? ` · ${c.contact_name}` : ''}
                    </div>
                  )}
                </div>

                <div><PriorityBadge priority={c.priority} /></div>
                <div><StatusBadge status={c.status} /></div>
                <div><SlaChip dueAt={c.due_at} resolvedAt={c.resolved_at} status={c.status} /></div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{c.assigned_to || '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{daysSince(c.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Case detail modal */}
      {(selectedCase || showNew) && (
        <CaseDetailModal
          case_={selectedCase || newTemplate}
          onClose={() => { setSelectedCase(null); setShowNew(false); }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
