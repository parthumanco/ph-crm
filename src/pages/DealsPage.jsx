import { useState, useEffect, useCallback } from 'react';
import {
  fetchDeals, moveStage,
  ACTIVE_STAGES, CLOSED_STAGES,
  stageColor, stageLabel, dealValue, fmt$, daysSince,
} from '../lib/deals';
import DealDetailModal from '../components/DealDetailModal';

const OWNER_COLORS = {
  Mike: { bg: '#f3e8ff', color: '#7c3aed' },
  Pete: { bg: '#eff6ff', color: '#1d4ed8' },
};

function OwnerPill({ owner }) {
  if (!owner) return null;
  const c = OWNER_COLORS[owner] || { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: c.bg, color: c.color, flexShrink: 0 }}>
      {owner}
    </span>
  );
}

function DealCard({ deal, onClick, onDragStart }) {
  const rv = parseFloat(deal.retainer_value) || 0;
  const pv = parseFloat(deal.project_value) || 0;
  const days = daysSince(deal.stage_entered_at);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', userSelect: 'none', transition: 'box-shadow .15s' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{deal.company_name}</span>
        <OwnerPill owner={deal.assigned_to} />
      </div>
      {deal.contact_name && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{deal.contact_name}</div>
      )}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        {rv > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#ccfbf1', color: '#0f766e' }}>{fmt$(rv)}/mo</span>
        )}
        {pv > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#fff7ed', color: '#c2410c' }}>{fmt$(pv)}</span>
        )}
        {rv === 0 && pv === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No value set</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: days > 14 ? '#ef4444' : 'var(--text-faint)', fontWeight: days > 14 ? 700 : 400 }}>
          {days}d
        </span>
      </div>
      {deal.close_date_estimate && (
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
          Close: {deal.close_date_estimate}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ stage, deals, onCardClick, onDrop, isDragOver, onDragOver, onDragLeave }) {
  const total = deals.reduce((s, d) => s + dealValue(d), 0);
  return (
    <div
      style={{ minWidth: 200, flex: '1 1 180px', maxWidth: 260 }}
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>{stage.label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 'auto', color: 'var(--text-faint)' }}>{deals.length}</span>
      </div>

      {/* Drop zone */}
      <div
        style={{
          minHeight: 80,
          borderRadius: 8,
          border: `2px dashed ${isDragOver ? stage.color : 'transparent'}`,
          background: isDragOver ? `${stage.color}12` : 'transparent',
          transition: 'all .15s',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: isDragOver ? 6 : 0,
        }}
      >
        {deals.map(d => (
          <DealCard
            key={d.id}
            deal={d}
            onClick={() => onCardClick(d)}
            onDragStart={e => e.dataTransfer.setData('dealId', d.id)}
          />
        ))}
        {deals.length === 0 && !isDragOver && (
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', padding: '12px 0' }}>—</div>
        )}
      </div>

      {/* Column total */}
      {total > 0 && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
          {fmt$(total)}
        </div>
      )}
    </div>
  );
}

export default function DealsPage() {
  const [deals, setDeals]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [showNewDeal, setShowNewDeal]   = useState(false);
  const [dragOver, setDragOver]     = useState(null); // stage id being dragged over

  const load = useCallback(async () => {
    try {
      const data = await fetchDeals();
      setDeals(data);
    } catch (e) {
      console.error('Failed to load deals:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = ownerFilter === 'all' ? deals : deals.filter(d => d.assigned_to === ownerFilter);

  const byStage = id => filtered.filter(d => d.stage === id);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const activeDeals  = deals.filter(d => !['won','lost'].includes(d.stage));
  const wonDeals     = deals.filter(d => d.stage === 'won');
  const lostDeals    = deals.filter(d => d.stage === 'lost');
  const totalPipeline = activeDeals.reduce((s, d) => s + dealValue(d), 0);
  const totalWon      = wonDeals.reduce((s, d) => s + dealValue(d), 0);
  const winRate       = (wonDeals.length + lostDeals.length) > 0
    ? Math.round(wonDeals.length / (wonDeals.length + lostDeals.length) * 100)
    : null;
  const mikeCount = filtered.filter(d => d.assigned_to === 'Mike' && !['won','lost'].includes(d.stage)).length;
  const peteCount = filtered.filter(d => d.assigned_to === 'Pete' && !['won','lost'].includes(d.stage)).length;

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const handleDrop = async (e, stageId) => {
    e.preventDefault();
    setDragOver(null);
    const dealId = e.dataTransfer.getData('dealId');
    if (!dealId) return;
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === stageId) return;
    // Optimistic update
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: stageId, stage_entered_at: new Date().toISOString() } : d));
    try {
      await moveStage(dealId, stageId);
    } catch (e) {
      console.error('Stage move failed:', e);
      load(); // revert
    }
  };

  // ── Modal handlers ─────────────────────────────────────────────────────────
  const handleSaved = (saved) => {
    if (!saved) {
      // deleted
      setDeals(prev => prev.filter(d => d.id !== selectedDeal?.id));
    } else if (deals.find(d => d.id === saved.id)) {
      setDeals(prev => prev.map(d => d.id === saved.id ? saved : d));
    } else {
      setDeals(prev => [saved, ...prev]);
    }
    setSelectedDeal(saved);
  };

  const newDealTemplate = { company_name: '', stage: 'prospect', assigned_to: 'Mike' };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>💼 Deals</h2>
          <p>{activeDeals.length} active deal{activeDeals.length !== 1 ? 's' : ''} · {fmt$(totalPipeline)} pipeline</p>
        </div>
        <div className="page-header-actions">
          {/* Owner filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {['all','Mike','Pete'].map(o => (
              <button
                key={o}
                onClick={() => setOwnerFilter(o)}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer', background: ownerFilter === o ? (o === 'Mike' ? '#7c3aed' : o === 'Pete' ? '#1d4ed8' : 'var(--accent)') : 'var(--surface)', color: ownerFilter === o ? '#fff' : 'var(--text-muted)', transition: 'all .15s' }}
              >
                {o === 'all' ? 'All' : o}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => { setSelectedDeal(null); setShowNewDeal(true); }}>
            + New Deal
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-row cols-4" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-val">{fmt$(totalPipeline)}</div>
            <div className="stat-label">Pipeline Value</div>
            <div className="stat-sub">Active deals (annualized)</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: 'var(--green)' }}>{fmt$(totalWon)}</div>
            <div className="stat-label">Won This Year</div>
            <div className="stat-sub">{wonDeals.length} deal{wonDeals.length !== 1 ? 's' : ''} closed</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: winRate === null ? 'var(--text-faint)' : winRate >= 50 ? 'var(--green)' : 'var(--amber)' }}>
              {winRate === null ? '—' : `${winRate}%`}
            </div>
            <div className="stat-label">Win Rate</div>
            <div className="stat-sub">{wonDeals.length}W · {lostDeals.length}L</div>
          </div>
          <div className="stat-card">
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-val" style={{ color: '#7c3aed' }}>{mikeCount}</div>
                <div className="stat-sub">Mike</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="stat-val" style={{ color: '#1d4ed8' }}>{peteCount}</div>
                <div className="stat-sub">Pete</div>
              </div>
            </div>
            <div className="stat-label">Active by Owner</div>
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading deals…</p></div>
        ) : (
          <>
            {/* Kanban — active stages */}
            <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
              <div style={{ display: 'flex', gap: 12, minWidth: 'max-content', paddingBottom: 4 }}>
                {ACTIVE_STAGES.map(stage => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    deals={byStage(stage.id)}
                    onCardClick={d => { setShowNewDeal(false); setSelectedDeal(d); }}
                    isDragOver={dragOver === stage.id}
                    onDragOver={() => setDragOver(stage.id)}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => handleDrop(e, stage.id)}
                  />
                ))}
              </div>
            </div>

            {/* Closed section */}
            {CLOSED_STAGES.some(s => byStage(s.id).length > 0) && (
              <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 16 }}>Closed / Nurture</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {CLOSED_STAGES.map(stage => {
                    const stageDeals = byStage(stage.id);
                    if (!stageDeals.length) return null;
                    return (
                      <div key={stage.id} style={{ minWidth: 200, flex: '1 1 180px', maxWidth: 280 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block' }} />
                          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>{stage.label}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 'auto', color: 'var(--text-faint)' }}>{stageDeals.length}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {stageDeals.map(d => (
                            <DealCard
                              key={d.id}
                              deal={d}
                              onClick={() => { setShowNewDeal(false); setSelectedDeal(d); }}
                              onDragStart={e => e.dataTransfer.setData('dealId', d.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {deals.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">💼</div>
                <h3>No deals yet</h3>
                <p>Create your first deal to start tracking the pipeline.</p>
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowNewDeal(true)}>+ New Deal</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Deal detail modal */}
      {(selectedDeal || showNewDeal) && (
        <DealDetailModal
          deal={selectedDeal || newDealTemplate}
          onClose={() => { setSelectedDeal(null); setShowNewDeal(false); }}
          onSaved={saved => {
            handleSaved(saved);
            if (showNewDeal && saved) {
              setShowNewDeal(false);
              setSelectedDeal(saved);
            }
          }}
        />
      )}
    </>
  );
}
