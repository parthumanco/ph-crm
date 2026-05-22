import { useState, useEffect, useCallback, useRef } from 'react';
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

function DealCard({ deal, onClick, onDragStart, onDragEnd }) {
  const rv = parseFloat(deal.retainer_value) || 0;
  const pv = parseFloat(deal.project_value) || 0;
  const days = daysSince(deal.stage_entered_at);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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

function KanbanColumn({ stage, deals, onCardClick, onDrop, isDragOver, onDragOver, onDragLeave, onCardDragStart, onCardDragEnd }) {
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
            onDragStart={e => { e.dataTransfer.setData('dealId', d.id); onCardDragStart?.(); }}
            onDragEnd={onCardDragEnd}
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
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [showNewDeal, setShowNewDeal]   = useState(false);
  const [dragOver, setDragOver]       = useState(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [trashHover, setTrashHover]   = useState(false);
  const [wonCardHover, setWonCardHover] = useState(false);
  const [lostAnim, setLostAnim]       = useState(null); // null | {dealId, phase:'fly'|'impact'}
  const [wonAnim,  setWonAnim]        = useState(null); // null | {dealId, phase:'plant'|'celebrate'}
  const [showLostPanel, setShowLostPanel] = useState(false);
  const dragDealId = useRef(null);

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

  const byStage = id => deals.filter(d => d.stage === id);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const activeDeals   = deals.filter(d => !['won','lost'].includes(d.stage));
  const wonDeals      = deals.filter(d => d.stage === 'won');
  const lostDeals     = deals.filter(d => d.stage === 'lost');
  const totalPipeline = activeDeals.reduce((s, d) => s + dealValue(d), 0);
  const totalWon      = wonDeals.reduce((s, d) => s + dealValue(d), 0);
  const winRate       = (wonDeals.length + lostDeals.length) > 0
    ? Math.round(wonDeals.length / (wonDeals.length + lostDeals.length) * 100)
    : null;

  // ── Win fanfare (ascending square-wave arpeggio) ──────────────────────────
  function playWinSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [
        // Rising arpeggio
        { freq: 261, t: 0,    dur: 0.11, vol: 0.10 },  // C4
        { freq: 329, t: 0.12, dur: 0.11, vol: 0.10 },  // E4
        { freq: 392, t: 0.24, dur: 0.11, vol: 0.10 },  // G4
        { freq: 523, t: 0.36, dur: 0.30, vol: 0.12 },  // C5 hold
        // Harmony on the hold
        { freq: 329, t: 0.38, dur: 0.26, vol: 0.07 },  // E4
        { freq: 392, t: 0.38, dur: 0.26, vol: 0.07 },  // G4
        // Second stab — higher
        { freq: 523, t: 0.72, dur: 0.10, vol: 0.10 },  // C5
        { freq: 659, t: 0.83, dur: 0.10, vol: 0.10 },  // E5
        { freq: 784, t: 0.94, dur: 0.50, vol: 0.12 },  // G5 hold
        { freq: 659, t: 0.96, dur: 0.45, vol: 0.07 },  // E5 harmony
        { freq: 523, t: 0.96, dur: 0.45, vol: 0.07 },  // C5 harmony
      ];
      notes.forEach(({ freq, t, dur, vol }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + t);
        gain.gain.setValueAtTime(vol, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + dur + 0.01);
      });
      setTimeout(() => ctx.close(), 2200);
    } catch { /* audio unavailable */ }
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const handleDrop = async (e, stageId) => {
    e.preventDefault();
    setDragOver(null);
    const dealId = e.dataTransfer.getData('dealId');
    if (!dealId) return;
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === stageId) return;

    // 🏆 Won — trigger arcade celebration
    if (stageId === 'won') {
      setIsDragging(false);
      setWonAnim({ dealId, phase: 'plant' });
      playWinSound();
      setTimeout(() => setWonAnim({ dealId, phase: 'celebrate' }), 750);
      setTimeout(async () => {
        setWonAnim(null);
        setDeals(prev => prev.map(d => d.id === dealId
          ? { ...d, stage: 'won', stage_entered_at: new Date().toISOString(), won_date: new Date().toISOString().slice(0, 10) }
          : d));
        try { await moveStage(dealId, 'won'); } catch { load(); }
      }, 2750);
      return;
    }

    // Normal stage move
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: stageId, stage_entered_at: new Date().toISOString() } : d));
    try {
      await moveStage(dealId, stageId);
    } catch (e) {
      console.error('Stage move failed:', e);
      load();
    }
  };

  // ── Retro arcade lose sound ────────────────────────────────────────────────
  function playLoseSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Descending 4-note "wah wah wah waaah" in square wave
      const notes = [
        { freq: 523, t: 0,    dur: 0.13 },
        { freq: 415, t: 0.14, dur: 0.13 },
        { freq: 330, t: 0.28, dur: 0.13 },
        { freq: 196, t: 0.42, dur: 0.35 },
      ];
      notes.forEach(({ freq, t, dur }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + t);
        gain.gain.setValueAtTime(0.09, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + dur + 0.01);
      });
      setTimeout(() => ctx.close(), 1400);
    } catch { /* audio unavailable */ }
  }

  // ── Trash bin (Lost) ──────────────────────────────────────────────────────
  const handleTrashDrop = async (e) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData('dealId');
    if (!dealId) return;
    setTrashHover(false);
    setIsDragging(false);
    // Phase 1: ball flies in (0–680ms)
    setLostAnim({ dealId, phase: 'fly' });
    // Phase 2: impact effects + sound (680ms–2150ms)
    setTimeout(() => {
      setLostAnim({ dealId, phase: 'impact' });
      playLoseSound();
    }, 680);
    // Done: update deal, clear animation
    setTimeout(async () => {
      setLostAnim(null);
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: 'lost', stage_entered_at: new Date().toISOString() } : d));
      try { await moveStage(dealId, 'lost'); } catch { load(); }
    }, 2150);
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
          <button className="btn btn-primary" onClick={() => { setSelectedDeal(null); setShowNewDeal(true); }}>
            + New Deal
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-row cols-3" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-val">{fmt$(totalPipeline)}</div>
            <div className="stat-label">Pipeline Value</div>
            <div className="stat-sub">Active deals (annualized)</div>
          </div>
          <div
            className="stat-card"
            onDragOver={e => { if (isDragging) { e.preventDefault(); setWonCardHover(true); } }}
            onDragLeave={() => setWonCardHover(false)}
            onDrop={e => { setWonCardHover(false); handleDrop(e, 'won'); }}
            style={{
              border: `2px solid ${wonCardHover ? '#10b981' : 'var(--border)'}`,
              boxShadow: wonCardHover ? '0 0 18px rgba(16,185,129,0.25)' : 'var(--shadow)',
              background: wonCardHover ? '#f0fdf4' : 'var(--surface)',
              transition: 'all .18s',
              cursor: isDragging ? 'copy' : 'default',
              position: 'relative',
            }}
          >
            <div className="stat-val" style={{ color: 'var(--green)' }}>{fmt$(totalWon)}</div>
            <div className="stat-label" style={{ color: wonCardHover ? '#059669' : undefined }}>
              {wonCardHover ? '🏆 Drop to close!' : 'Won This Year'}
            </div>
            <div className="stat-sub">{wonDeals.length} deal{wonDeals.length !== 1 ? 's' : ''} closed</div>
            {isDragging && !wonCardHover && (
              <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 10, fontWeight: 700, color: '#10b981', opacity: 0.6 }}>
                ← drag here to win
              </div>
            )}
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: winRate === null ? 'var(--text-faint)' : winRate >= 50 ? 'var(--green)' : 'var(--amber)' }}>
              {winRate === null ? '—' : `${winRate}%`}
            </div>
            <div className="stat-label">Win Rate</div>
            <div className="stat-sub">{wonDeals.length}W · {lostDeals.length}L</div>
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
                    onCardDragStart={() => { setIsDragging(true); }}
                    onCardDragEnd={() => { setIsDragging(false); setTrashHover(false); setWonCardHover(false); }}
                  />
                ))}
              </div>
            </div>

            {/* Won deals — below the kanban board */}
            {wonDeals.length > 0 && (
              <div style={{ marginTop: 32, borderTop: '2px solid #bbf7d0', paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 14 }}>🏆</span>
                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#059669' }}>Won</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginLeft: 2 }}>· {wonDeals.length} deal{wonDeals.length !== 1 ? 's' : ''}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#059669', marginLeft: 'auto' }}>{fmt$(totalWon)}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {wonDeals.map(d => (
                    <div
                      key={d.id}
                      onClick={() => { setShowNewDeal(false); setSelectedDeal(d); }}
                      style={{
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: 8,
                        padding: '10px 14px',
                        cursor: 'pointer',
                        minWidth: 180,
                        flex: '1 1 160px',
                        maxWidth: 260,
                        transition: 'border-color .15s, box-shadow .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(16,185,129,0.18)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#bbf7d0'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{d.company_name}</div>
                      {d.contact_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{d.contact_name}</div>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        {dealValue(d) > 0
                          ? <span style={{ fontSize: 11, fontWeight: 800, color: '#059669' }}>{fmt$(dealValue(d))}</span>
                          : <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No value</span>}
                        {d.won_date && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{d.won_date}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Closed section — Won is shown above; only Nurture here */}
            {CLOSED_STAGES.filter(s => s.id !== 'won').some(s => byStage(s.id).length > 0) && (
              <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 16 }}>Nurture</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {CLOSED_STAGES.filter(s => s.id !== 'won').map(stage => {
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
                              onDragStart={e => { e.dataTransfer.setData('dealId', d.id); setIsDragging(true); }}
                              onDragEnd={() => { setIsDragging(false); setTrashHover(false); setWonCardHover(false); }}
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

      {/* ═══ Retro Arcade Trash Bin ═══════════════════════════════════════════ */}
      <div style={{
        position: 'fixed', bottom: 28, right: 32, zIndex: 600,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      }}>

        {/* ── Flying paper ball (phase: fly) ── */}
        {lostAnim?.phase === 'fly' && (
          <div className="retro-ball-fly" style={{
            position: 'absolute', bottom: 18, right: 18,
            pointerEvents: 'none', zIndex: 20,
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="12" fill="#e5e7eb" />
              <circle cx="14" cy="14" r="12" fill="none" stroke="#9ca3af" strokeWidth="1" />
              {/* Crumple lines */}
              <line x1="5"  y1="10" x2="14" y2="17" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="5"  x2="21" y2="17" stroke="#9ca3af" strokeWidth="1"   strokeLinecap="round" />
              <line x1="7"  y1="18" x2="18" y2="23" stroke="#9ca3af" strokeWidth="1"   strokeLinecap="round" />
              <line x1="16" y1="7"  x2="23" y2="13" stroke="#6b7280" strokeWidth="1"   strokeLinecap="round" />
              <line x1="4"  y1="15" x2="10" y2="20" stroke="#9ca3af" strokeWidth="1"   strokeLinecap="round" />
              {/* Highlight */}
              <circle cx="9" cy="9" r="3.5" fill="rgba(255,255,255,0.55)" />
            </svg>
          </div>
        )}

        {/* ── Impact effects (phase: impact) ── */}
        {lostAnim?.phase === 'impact' && (<>
          {/* Shockwave ring */}
          <div className="retro-impact-ring" style={{
            position: 'absolute', bottom: 8, right: 8,
            width: 50, height: 50,
            border: '4px solid #ef4444',
            borderRadius: '50%',
            pointerEvents: 'none', zIndex: 20,
          }} />
          {/* Sparks — pixel squares in 6 arcade colors */}
          {['#ef4444','#f59e0b','#10b981','#3b82f6','#ec4899','#f97316'].map((color, i) => (
            <div key={i} className={`retro-spark-${i + 1}`} style={{
              position: 'absolute', bottom: 22, right: 22,
              width: 8, height: 8,
              background: color,
              borderRadius: 1,
              pointerEvents: 'none', zIndex: 20,
            }} />
          ))}
          {/* DEAL LOST! popup */}
          <div className="retro-popup-anim" style={{
            position: 'absolute',
            bottom: 95, left: '50%', /* retro-popup-anim handles the translateX(-50%) */
            pointerEvents: 'none', zIndex: 30,
            background: '#0f0a1e',
            border: '3px solid #ef4444',
            borderRadius: 3,
            padding: '11px 18px 13px',
            boxShadow: [
              '4px 4px 0 #7f1d1d',
              '0 0 24px rgba(239,68,68,0.5)',
              'inset 0 0 0 1px #450a0a',
            ].join(', '),
          }}>
            <div style={{
              fontFamily: '"Press Start 2P", "Courier New", monospace',
              fontSize: 13,
              color: '#fca5a5',
              textShadow: '0 0 10px rgba(239,68,68,0.9), 2px 2px 0 #450a0a',
              textAlign: 'center',
              letterSpacing: '0.04em',
              lineHeight: 1.7,
            }}>
              DEAL<br />LOST!
            </div>
            <div style={{
              fontFamily: '"Press Start 2P", "Courier New", monospace',
              fontSize: 6,
              color: '#4b5563',
              textAlign: 'center',
              marginTop: 6,
              letterSpacing: '0.06em',
            }}>
              CONTINUE?
            </div>
          </div>
        </>)}

        {/* ── Bin (drag target + click to view) ── */}
        <div
          onDragOver={e => { if (isDragging) { e.preventDefault(); setTrashHover(true); } }}
          onDragLeave={() => setTrashHover(false)}
          onDrop={handleTrashDrop}
          onClick={() => { if (!isDragging && !lostAnim) setShowLostPanel(true); }}
          style={{ cursor: isDragging ? 'default' : 'pointer', position: 'relative', userSelect: 'none' }}
        >
          <div
            className={
              lostAnim?.phase === 'impact' ? 'retro-bin-bounce'
              : trashHover ? 'trash-bin-hover'
              : ''
            }
            style={{
              fontSize: isDragging || lostAnim ? 52 : 38,
              lineHeight: 1,
              filter: trashHover
                ? 'drop-shadow(0 0 14px rgba(239,68,68,0.7))'
                : lostAnim?.phase === 'impact'
                  ? 'drop-shadow(0 0 18px rgba(239,68,68,0.9))'
                  : 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))',
              transition: 'font-size .2s, filter .2s',
              opacity: isDragging || lostAnim ? 1 : 0.72,
            }}
          >
            🗑️
          </div>
          {/* Lost count badge */}
          {lostDeals.length > 0 && !isDragging && !lostAnim && (
            <span style={{
              position: 'absolute', top: -5, right: -7,
              fontSize: 10, fontWeight: 800,
              background: '#ef4444', color: '#fff',
              borderRadius: 10, padding: '1px 5px',
              minWidth: 17, textAlign: 'center',
              boxShadow: '0 1px 4px rgba(239,68,68,0.4)',
            }}>
              {lostDeals.length}
            </span>
          )}
        </div>

        {/* Label */}
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: trashHover ? '#ef4444' : 'var(--text-muted)',
          background: trashHover ? '#fef2f2' : 'var(--surface)',
          border: `1px solid ${trashHover ? '#fca5a5' : 'var(--border)'}`,
          borderRadius: 6, padding: '2px 7px',
          transition: 'all .2s', whiteSpace: 'nowrap',
        }}>
          {lostAnim ? '…' : isDragging ? (trashHover ? 'Drop to lose' : 'Drag here') : `${lostDeals.length} lost`}
        </span>
      </div>

      {/* ═══ Win Celebration Overlay ════════════════════════════════════════════ */}
      {wonAnim && (() => {
        const winDeal = deals.find(d => d.id === wonAnim.dealId);
        const winVal  = winDeal ? dealValue(winDeal) : 0;
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 700,
            background: 'rgba(2, 26, 12, 0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'win-overlay-in 0.25s ease-out',
            pointerEvents: 'none',
          }}>
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

              {/* Dollar bills — all start at character center, fly outward */}
              {[1,2,3,4,5,6,7,8].map(i => (
                <div key={i} className={`bill-fly-${i}`} style={{
                  position: 'absolute', top: 28, left: '50%', marginLeft: -12,
                  fontSize: 24, pointerEvents: 'none', zIndex: 2,
                }}>💵</div>
              ))}

              {/* ── Minotaur pixel-art character ── */}
              <div className={wonAnim.phase === 'celebrate' ? 'char-celebrate' : ''} style={{ position: 'relative', zIndex: 3 }}>
                {/* SVG Minotaur */}
                <svg width="80" height="104" viewBox="0 0 80 104" style={{ imageRendering: 'pixelated', display: 'block', overflow: 'visible' }}>
                  {/* Horns */}
                  <rect x="4"  y="0"  width="14" height="22" rx="3" fill="#92400e" />
                  <rect x="2"  y="0"  width="8"  height="10" rx="2" fill="#a16207" />
                  <rect x="62" y="0"  width="14" height="22" rx="3" fill="#92400e" />
                  <rect x="70" y="0"  width="8"  height="10" rx="2" fill="#a16207" />
                  {/* Head */}
                  <rect x="12" y="12" width="56" height="36" rx="4" fill="#b45309" />
                  <rect x="12" y="12" width="56" height="8"  rx="3" fill="#c2410c" />
                  {/* Eyes — red (fierce) */}
                  <rect x="18" y="20" width="12" height="12" rx="1" fill="#fef3c7" />
                  <rect x="50" y="20" width="12" height="12" rx="1" fill="#fef3c7" />
                  <rect x="21" y="22" width="6"  height="7"  rx="1" fill="#dc2626" />
                  <rect x="53" y="22" width="6"  height="7"  rx="1" fill="#dc2626" />
                  <rect x="22" y="23" width="3"  height="3"  fill="#7f1d1d" />
                  <rect x="54" y="23" width="3"  height="3"  fill="#7f1d1d" />
                  {/* Snout */}
                  <rect x="22" y="34" width="36" height="16" rx="4" fill="#9a3412" />
                  <rect x="26" y="37" width="10" height="6"  rx="2" fill="#7f1d1d" />
                  <rect x="44" y="37" width="10" height="6"  rx="2" fill="#7f1d1d" />
                  {/* Body — blue tunic */}
                  <rect x="14" y="48" width="52" height="34" rx="2" fill="#1d4ed8" />
                  <rect x="14" y="48" width="52" height="7"  rx="1" fill="#2563eb" />
                  {/* Chest stripe */}
                  <rect x="32" y="52" width="16" height="5"  fill="#1e40af" />
                  {/* Belt */}
                  <rect x="14" y="74" width="52" height="8"  fill="#78350f" />
                  <rect x="32" y="75" width="16" height="6"  rx="1" fill="#d97706" />
                  <rect x="36" y="76" width="8"  height="4"  rx="0" fill="#fbbf24" />
                  {/* Left arm (hanging) */}
                  <rect x="0"  y="50" width="14" height="26" rx="4" fill="#b45309" />
                  <rect x="0"  y="70" width="14" height="10" rx="4" fill="#9a3412" />
                  {/* Right arm (raised — gripping flag pole) */}
                  <rect x="66" y="38" width="14" height="26" rx="4" fill="#b45309" />
                  <rect x="66" y="36" width="14" height="10" rx="4" fill="#9a3412" />
                  {/* Legs */}
                  <rect x="16" y="82" width="20" height="22" rx="2" fill="#1e40af" />
                  <rect x="44" y="82" width="20" height="22" rx="2" fill="#1e40af" />
                  {/* Hooves */}
                  <rect x="12" y="96" width="28" height="8"  rx="3" fill="#111827" />
                  <rect x="40" y="96" width="28" height="8"  rx="3" fill="#111827" />
                </svg>

                {/* Flag — plants down from raised position */}
                <div
                  className={wonAnim.phase === 'plant' ? 'flag-plant-anim' : ''}
                  style={{
                    position: 'absolute', top: 20, right: -48,
                    transformOrigin: 'bottom left',
                    transform: wonAnim.phase === 'celebrate' ? 'rotate(0deg)' : undefined,
                  }}
                >
                  <svg width="48" height="70" viewBox="0 0 48 70" style={{ imageRendering: 'pixelated', display: 'block' }}>
                    {/* Pole */}
                    <rect x="20" y="0"  width="5" height="70" fill="#d1d5db" />
                    <rect x="22" y="0"  width="2" height="70" fill="rgba(255,255,255,0.4)" />
                    {/* Flag — green with $ */}
                    <polygon points="25,4 25,32 48,18" fill="#10b981" />
                    <polygon points="25,4 25,32 48,18" fill="none" stroke="#059669" strokeWidth="1.5" />
                    <text x="32" y="22" fontFamily="monospace" fontSize="13" fontWeight="800" fill="#fff" textAnchor="middle">$</text>
                  </svg>
                </div>
              </div>

              {/* Ground bar */}
              <div style={{
                width: 180, height: 5, marginTop: 2,
                background: 'linear-gradient(90deg, transparent, #10b981 20%, #fbbf24 50%, #10b981 80%, transparent)',
                borderRadius: 3,
              }} />

              {/* DEAL WON! popup — appears on celebrate phase */}
              {wonAnim.phase === 'celebrate' && (
                <div className="win-popup-anim" style={{
                  marginTop: 20,
                  background: '#052e16',
                  border: '3px solid #fbbf24',
                  borderRadius: 3,
                  padding: '14px 26px 16px',
                  textAlign: 'center',
                  boxShadow: [
                    '4px 4px 0 #78350f',
                    '0 0 32px rgba(251,191,36,0.55)',
                    'inset 0 0 0 1px #14532d',
                  ].join(', '),
                }}>
                  <div style={{
                    fontFamily: '"Press Start 2P", "Courier New", monospace',
                    fontSize: 16,
                    color: '#fde68a',
                    textShadow: '0 0 14px rgba(251,191,36,0.9), 2px 2px 0 #78350f',
                    letterSpacing: '0.04em',
                    lineHeight: 1.7,
                  }}>
                    DEAL WON!
                  </div>
                  {winVal > 0 && (
                    <div style={{
                      fontFamily: '"Press Start 2P", "Courier New", monospace',
                      fontSize: 9,
                      color: '#86efac',
                      marginTop: 8,
                      textShadow: '0 0 8px rgba(16,185,129,0.7)',
                    }}>
                      {fmt$(winVal)}
                    </div>
                  )}
                  <div style={{
                    fontFamily: '"Press Start 2P", "Courier New", monospace',
                    fontSize: 6,
                    color: '#4b5563',
                    marginTop: 8,
                    letterSpacing: '0.06em',
                  }}>
                    ACHIEVEMENT UNLOCKED
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Lost deals panel */}
      {showLostPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.target === e.currentTarget && setShowLostPanel(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowLostPanel(false)} />
          <div style={{ position: 'relative', zIndex: 1, width: 380, background: 'var(--bg)', boxShadow: '-6px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>🗑️ Lost Deals</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{lostDeals.length} deal{lostDeals.length !== 1 ? 's' : ''}</p>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowLostPanel(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lostDeals.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', paddingTop: 24 }}>No lost deals yet.</p>
              )}
              {lostDeals.map(d => (
                <div
                  key={d.id}
                  onClick={() => { setShowLostPanel(false); setSelectedDeal(d); }}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#fca5a5'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{d.company_name}</div>
                  {d.contact_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{d.contact_name}</div>}
                  {d.lost_reason && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Reason: {d.lost_reason}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Lost {d.lost_date || d.updated_at?.slice(0,10) || ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
