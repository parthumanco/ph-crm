import { useState, useEffect } from 'react';
import { fetchProjectByToken, approveMilestone, approveTask, rejectTask, fetchMilestones, fetchProjectTasks, fetchProjectFiles } from '../lib/projects';

const ACCENT = '#E8541E';

// ── Proposal text helpers ─────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a','an','the','and','or','to','of','in','for','with','on','at','by','from','is','are','be','that','this','it','as','will','we','our','your','their','its','any','all','can','not','have','has','had']);

function titleWords(str) {
  return str.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function pdfSearchParam(title) {
  const words = titleWords(title);
  return encodeURIComponent(words.slice(0, 4).join(' '));
}

function findPageHint(pageHints, taskTitle) {
  if (!pageHints || !taskTitle) return null;
  const keys = Object.keys(pageHints);
  if (!keys.length) return null;
  if (pageHints[taskTitle] != null) return pageHints[taskTitle];
  const lower = taskTitle.toLowerCase();
  const ciKey = keys.find(k => k.toLowerCase() === lower);
  if (ciKey) return pageHints[ciKey];
  const words = titleWords(taskTitle);
  if (words.length) {
    let bestKey = null, bestScore = 0;
    keys.forEach(k => {
      const score = titleWords(k).filter(w => words.includes(w)).length;
      if (score > bestScore) { bestScore = score; bestKey = k; }
    });
    if (bestScore > 0) return pageHints[bestKey];
  }
  return null;
}

function findRelevantParaIndex(proposalText, taskTitle) {
  if (!proposalText || !taskTitle) return -1;
  const paras = proposalText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return -1;
  const words = titleWords(taskTitle);
  if (!words.length) return -1;
  let bestIdx = -1, bestScore = -1;
  paras.forEach((p, i) => {
    const lower = p.toLowerCase();
    const paraWordCount = p.split(/\s+/).filter(Boolean).length;
    const overlap = words.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
    if (overlap === 0) return;
    const lengthFactor = paraWordCount >= 20 ? Math.log2(paraWordCount) : 0.3;
    const score = overlap * lengthFactor;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime) {
  if (!mime) return '📎';
  if (mime === 'link') return '🔗';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  return '📎';
}

const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Complete',
  blocked: 'Blocked',
};

const STATUS_COLORS = {
  not_started: '#94a3b8',
  in_progress: '#f59e0b',
  completed: '#10b981',
  blocked: '#ef4444',
};

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#94a3b8';
  const label = STATUS_LABELS[status] || status;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
      background: color + '20', color, border: `1px solid ${color}40`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function PortalGantt({ milestones, projectStart, projectEnd }) {
  if (!projectStart || !projectEnd || !milestones.length) return null;
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const totalDays = daysBetween(projectStart, projectEnd);
  if (totalDays <= 0) return null;

  const LABEL_W = 130;
  const ROW_H   = 18;
  const BAR_H   = 10;

  const todayStr  = new Date().toISOString().slice(0, 10);
  const todayPct  = Math.min(100, Math.max(0, daysBetween(projectStart, todayStr) / totalDays * 100));
  const showToday = todayStr >= projectStart && todayStr <= projectEnd;

  // Month ticks — use short "Jun 26" style
  const months = [];
  const d = new Date(projectStart);
  d.setDate(1);
  while (d.toISOString().slice(0, 10) <= projectEnd) {
    const pct = daysBetween(projectStart, d.toISOString().slice(0, 10)) / totalDays * 100;
    if (pct >= 0 && pct <= 102)
      months.push({ label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }), pct: Math.max(0, pct) });
    d.setMonth(d.getMonth() + 1);
  }

  const visibleMs = milestones.filter(m => m.start_date && m.due_date);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 440, position: 'relative' }}>
        {/* Axis labels */}
        <div style={{ display: 'flex', marginBottom: 6 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={{ flex: 1, position: 'relative', height: 14 }}>
            {months.map((m, i) => (
              <span key={i} style={{
                position: 'absolute', left: `${m.pct}%`,
                fontSize: 10, color: '#b0b7c3', fontWeight: 600,
                transform: 'translateX(-50%)', whiteSpace: 'nowrap',
              }}>{m.label}</span>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div style={{ position: 'relative' }}>
          {showToday && (
            <div style={{
              position: 'absolute',
              left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${todayPct / 100})`,
              top: -2, bottom: 0, width: 1.5,
              background: '#ef4444', zIndex: 4, pointerEvents: 'none',
            }}>
              <span style={{
                position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                fontSize: 8, fontWeight: 800, color: '#ef4444', whiteSpace: 'nowrap', letterSpacing: '.06em',
              }}>TODAY</span>
            </div>
          )}

          {visibleMs.map(ms => {
            const lPct = daysBetween(projectStart, ms.start_date) / totalDays * 100;
            const wPct = daysBetween(ms.start_date, ms.due_date)  / totalDays * 100;
            const color = STATUS_COLORS[ms.status] || '#94a3b8';
            return (
              <div key={ms.id} style={{ display: 'flex', alignItems: 'center', height: ROW_H, marginBottom: 5 }}>
                <div style={{
                  width: LABEL_W, flexShrink: 0, paddingRight: 10,
                  fontSize: 11, fontWeight: 500, color: '#6b7280',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={ms.title}>{ms.title}</div>
                <div style={{ flex: 1, height: BAR_H, background: '#f0f1f3', borderRadius: 4, position: 'relative' }}>
                  <div style={{
                    position: 'absolute',
                    left:  `${Math.max(0, lPct)}%`,
                    width: `${Math.min(wPct, 100 - Math.max(0, lPct))}%`,
                    minWidth: 4, height: '100%',
                    background: color, borderRadius: 4,
                    opacity: ms.status === 'completed' ? 0.5 : 0.8,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color = ACCENT, height = 6 }) {
  return (
    <div style={{ height, background: '#e5e7eb', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: height, transition: 'width .4s' }} />
    </div>
  );
}

// ── Password Gate ─────────────────────────────────────────────────────────────

function PasswordGate({ token, password, onSuccess }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = () => {
    if (input === password) {
      sessionStorage.setItem(`portal_pw_${token}`, '1');
      onSuccess();
    } else {
      setError(true);
      setInput('');
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#f9fafb',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, sans-serif', padding: 20,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px', maxWidth: 400, width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: '"Playfair Display", serif', fontWeight: 700,
          fontSize: 24, color: ACCENT, marginBottom: 24, letterSpacing: '-0.02em',
        }}>Part Human</div>

        <div style={{ fontSize: 36, marginBottom: 16 }}>🔒</div>

        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          This project requires a password
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 28 }}>
          Enter the password provided by your project team.
        </div>

        <input
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter password"
          autoFocus
          style={{
            width: '100%', padding: '11px 14px', fontSize: 15, borderRadius: 8,
            border: `1.5px solid ${error ? '#ef4444' : '#d1d5db'}`,
            outline: 'none', marginBottom: 12, boxSizing: 'border-box',
            fontFamily: 'Inter, sans-serif',
          }}
        />

        {error && (
          <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 12, fontWeight: 600 }}>
            Incorrect password. Please try again.
          </div>
        )}

        <button
          onClick={handleSubmit}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: ACCENT, color: '#fff', fontSize: 15, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          }}
        >Enter</button>
      </div>
    </div>
  );
}

// ── Celebrations ─────────────────────────────────────────────────────────────


function playRockyFanfare() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Same ascending square-wave arpeggio as the won-deal celebration
    const notes = [
      { freq: 261, t: 0,    dur: 0.11, vol: 0.10 },
      { freq: 329, t: 0.12, dur: 0.11, vol: 0.10 },
      { freq: 392, t: 0.24, dur: 0.11, vol: 0.10 },
      { freq: 523, t: 0.36, dur: 0.30, vol: 0.12 },
      { freq: 329, t: 0.38, dur: 0.26, vol: 0.07 },
      { freq: 392, t: 0.38, dur: 0.26, vol: 0.07 },
      { freq: 523, t: 0.72, dur: 0.10, vol: 0.10 },
      { freq: 659, t: 0.83, dur: 0.10, vol: 0.10 },
      { freq: 784, t: 0.94, dur: 0.50, vol: 0.12 },
      { freq: 659, t: 0.96, dur: 0.45, vol: 0.07 },
      { freq: 523, t: 0.96, dur: 0.45, vol: 0.07 },
    ];
    notes.forEach(({ freq, t, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + t);
      gain.gain.setValueAtTime(vol, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + dur + 0.01);
    });
    setTimeout(() => ctx.close(), 2200);
  } catch (_) {}
}

function HighFiveCelebration({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(2, 26, 12, 0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <style>{`
        @keyframes hf-char { 0%{transform:translateY(0)} 50%{transform:translateY(-8px)} 100%{transform:translateY(0)} }
        @keyframes hf-bill { 0%{opacity:1;transform:translate(0,0) rotate(0deg)} 100%{opacity:0;transform:translate(var(--bx),var(--by)) rotate(var(--br))} }
        @keyframes hf-popup { 0%{opacity:0;transform:scale(0.4)} 60%{transform:scale(1.08)} 100%{opacity:1;transform:scale(1)} }
      `}</style>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* Sparks flying out */}
        {[1,2,3,4,5,6,7,8].map(i => {
          const angle = (i / 8) * Math.PI * 2;
          const dist = 70 + i * 8;
          return (
            <div key={i} style={{
              position: 'absolute', top: 40, left: '50%', marginLeft: -10,
              fontSize: 16, pointerEvents: 'none', zIndex: 2,
              '--bx': `${Math.cos(angle) * dist}px`,
              '--by': `${Math.sin(angle) * dist}px`,
              '--br': `${(i % 2 === 0 ? 1 : -1) * 120}deg`,
              animation: `hf-bill 0.9s ease-out ${i * 0.06}s both`,
            }}>{'✨⭐💫🌟'[i % 4]}</div>
          );
        })}

        {/* Two pixel-art hands clapping */}
        <div style={{ animation: 'hf-char 0.6s ease-in-out infinite', display: 'flex', alignItems: 'center', gap: 6, zIndex: 3 }}>

          {/* Left hand (palm facing right) */}
          <svg width="52" height="60" viewBox="0 0 52 60" style={{ imageRendering: 'pixelated', display: 'block' }}>
            {/* Wrist */}
            <rect x="14" y="44" width="24" height="14" rx="2" fill="#b45309"/>
            {/* Palm */}
            <rect x="8"  y="20" width="36" height="28" rx="2" fill="#c2410c"/>
            <rect x="8"  y="20" width="36" height="6"  fill="#d97706"/>
            {/* Fingers (4 blocks across top) */}
            <rect x="8"  y="6"  width="8"  height="16" rx="2" fill="#b45309"/>
            <rect x="18" y="4"  width="8"  height="18" rx="2" fill="#b45309"/>
            <rect x="28" y="4"  width="8"  height="18" rx="2" fill="#b45309"/>
            <rect x="38" y="6"  width="6"  height="16" rx="2" fill="#b45309"/>
            {/* Knuckle highlights */}
            <rect x="9"  y="8"  width="4" height="3" fill="#d97706"/>
            <rect x="19" y="6"  width="4" height="3" fill="#d97706"/>
            <rect x="29" y="6"  width="4" height="3" fill="#d97706"/>
            <rect x="39" y="8"  width="3" height="3" fill="#d97706"/>
            {/* Impact lines */}
            <rect x="46" y="18" width="4" height="2" fill="#fbbf24"/>
            <rect x="48" y="24" width="3" height="2" fill="#fbbf24"/>
            <rect x="46" y="30" width="5" height="2" fill="#fbbf24"/>
          </svg>

          {/* Impact flash */}
          <svg width="20" height="24" viewBox="0 0 20 24" style={{ imageRendering: 'pixelated' }}>
            <rect x="8"  y="0"  width="4" height="6"  fill="#fbbf24"/>
            <rect x="0"  y="8"  width="6" height="4"  fill="#fbbf24"/>
            <rect x="14" y="8"  width="6" height="4"  fill="#fbbf24"/>
            <rect x="8"  y="14" width="4" height="6"  fill="#fbbf24"/>
            <rect x="7"  y="7"  width="6" height="6"  fill="#fff"/>
          </svg>

          {/* Right hand (palm facing left — mirrored) */}
          <svg width="52" height="60" viewBox="0 0 52 60" style={{ imageRendering: 'pixelated', display: 'block', transform: 'scaleX(-1)' }}>
            <rect x="14" y="44" width="24" height="14" rx="2" fill="#b45309"/>
            <rect x="8"  y="20" width="36" height="28" rx="2" fill="#c2410c"/>
            <rect x="8"  y="20" width="36" height="6"  fill="#d97706"/>
            <rect x="8"  y="6"  width="8"  height="16" rx="2" fill="#b45309"/>
            <rect x="18" y="4"  width="8"  height="18" rx="2" fill="#b45309"/>
            <rect x="28" y="4"  width="8"  height="18" rx="2" fill="#b45309"/>
            <rect x="38" y="6"  width="6"  height="16" rx="2" fill="#b45309"/>
            <rect x="9"  y="8"  width="4" height="3" fill="#d97706"/>
            <rect x="19" y="6"  width="4" height="3" fill="#d97706"/>
            <rect x="29" y="6"  width="4" height="3" fill="#d97706"/>
            <rect x="39" y="8"  width="3" height="3" fill="#d97706"/>
            <rect x="46" y="18" width="4" height="2" fill="#fbbf24"/>
            <rect x="48" y="24" width="3" height="2" fill="#fbbf24"/>
            <rect x="46" y="30" width="5" height="2" fill="#fbbf24"/>
          </svg>
        </div>

        {/* Ground bar */}
        <div style={{
          width: 180, height: 5, marginTop: 4,
          background: 'linear-gradient(90deg, transparent, #10b981 20%, #fbbf24 50%, #10b981 80%, transparent)',
          borderRadius: 3,
        }}/>

        {/* HIGH FIVE popup — same style as DEAL WON / PHASE APPROVED */}
        <div style={{
          marginTop: 20,
          background: '#052e16',
          border: '3px solid #fbbf24',
          borderRadius: 3,
          padding: '14px 26px 16px',
          textAlign: 'center',
          animation: 'hf-popup 0.4s cubic-bezier(.22,1,.36,1) 0.3s both',
          boxShadow: '4px 4px 0 #78350f, 0 0 32px rgba(251,191,36,0.55), inset 0 0 0 1px #14532d',
        }}>
          <div style={{
            fontFamily: '"Press Start 2P", "Courier New", monospace',
            fontSize: 14,
            color: '#fde68a',
            textShadow: '0 0 14px rgba(251,191,36,0.9), 2px 2px 0 #78350f',
            letterSpacing: '0.04em',
            lineHeight: 1.7,
          }}>HIGH FIVE!</div>
          <div style={{
            fontFamily: '"Press Start 2P", "Courier New", monospace',
            fontSize: 7,
            color: '#86efac',
            marginTop: 8,
            textShadow: '0 0 8px rgba(16,185,129,0.7)',
            letterSpacing: '0.06em',
          }}>TASK APPROVED</div>
        </div>
      </div>
    </div>
  );
}

function RockyUnicornCelebration({ onDone }) {
  useEffect(() => {
    playRockyFanfare();
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(2, 26, 12, 0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <style>{`
        @keyframes ru-char     { 0%{transform:translateY(0)} 50%{transform:translateY(-10px)} 100%{transform:translateY(0)} }
        @keyframes ru-bill     { 0%{opacity:1;transform:translate(0,0) rotate(0deg)} 100%{opacity:0;transform:translate(var(--bx),var(--by)) rotate(var(--br))} }
        @keyframes ru-popup    { 0%{opacity:0;transform:scale(0.4)} 60%{transform:scale(1.08)} 100%{opacity:1;transform:scale(1)} }
        @keyframes win-overlay-in { from{opacity:0} to{opacity:1} }
      `}</style>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* Flying stars/gloves from character */}
        {[1,2,3,4,5,6,7,8].map(i => {
          const angle = (i / 8) * Math.PI * 2;
          const dist = 80 + Math.random() * 40;
          return (
            <div key={i} style={{
              position: 'absolute', top: 40, left: '50%', marginLeft: -10,
              fontSize: 18, pointerEvents: 'none', zIndex: 2,
              '--bx': `${Math.cos(angle) * dist}px`,
              '--by': `${Math.sin(angle) * dist}px`,
              '--br': `${(Math.random()-0.5)*180}deg`,
              animation: `ru-bill 1s ease-out ${i * 0.08}s both`,
            }}>{'⭐✨🌟🥊🏆💥'[i % 6]}</div>
          );
        })}

        {/* Pixel-art unicorn — same construction as the minotaur */}
        <div style={{ animation: 'ru-char 0.7s ease-in-out infinite', position: 'relative', zIndex: 3 }}>
          <svg width="96" height="112" viewBox="-8 0 96 112" style={{ imageRendering: 'pixelated', display: 'block', overflow: 'visible' }}>

            {/* ── Horn ── */}
            <rect x="34" y="0"  width="4"  height="4"  fill="#fbbf24"/>
            <rect x="32" y="4"  width="8"  height="4"  fill="#fbbf24"/>
            <rect x="30" y="8"  width="12" height="4"  fill="#f59e0b"/>
            <rect x="28" y="12" width="16" height="4"  fill="#f59e0b"/>

            {/* ── Mane (rainbow blocks, left side) ── */}
            <rect x="2"  y="18" width="10" height="6"  fill="#ec4899"/>
            <rect x="2"  y="24" width="10" height="6"  fill="#8b5cf6"/>
            <rect x="2"  y="30" width="10" height="6"  fill="#3b82f6"/>
            <rect x="2"  y="36" width="10" height="6"  fill="#10b981"/>
            <rect x="4"  y="42" width="8"  height="5"  fill="#fbbf24"/>

            {/* ── Left ear ── */}
            <rect x="12" y="16" width="10" height="10" fill="#f5f0e8"/>
            <rect x="14" y="18" width="6"  height="6"  fill="#f9a8d4"/>
            {/* ── Right ear ── */}
            <rect x="58" y="16" width="10" height="10" fill="#f5f0e8"/>
            <rect x="60" y="18" width="6"  height="6"  fill="#f9a8d4"/>

            {/* ── Head (cream) ── */}
            <rect x="12" y="16" width="56" height="36" rx="2" fill="#f5f0e8"/>
            <rect x="12" y="16" width="56" height="7"  fill="#fffbf0"/>

            {/* ── Eyes ── */}
            <rect x="20" y="24" width="12" height="12" rx="1" fill="white"/>
            <rect x="48" y="24" width="12" height="12" rx="1" fill="white"/>
            {/* Pupils */}
            <rect x="23" y="27" width="6"  height="7"  fill="#1e3a5f"/>
            <rect x="51" y="27" width="6"  height="7"  fill="#1e3a5f"/>
            {/* Shine */}
            <rect x="25" y="28" width="2"  height="2"  fill="white"/>
            <rect x="53" y="28" width="2"  height="2"  fill="white"/>
            {/* Fierce brows */}
            <rect x="19" y="22" width="8"  height="3"  fill="#92400e"/>
            <rect x="53" y="22" width="8"  height="3"  fill="#92400e"/>

            {/* ── Snout ── */}
            <rect x="22" y="38" width="36" height="14" rx="2" fill="#e8d5b0"/>
            <rect x="26" y="42" width="8"  height="5"  rx="1" fill="#c4a882"/>
            <rect x="46" y="42" width="8"  height="5"  rx="1" fill="#c4a882"/>

            {/* ── Body (grey Rocky hoodie) ── */}
            <rect x="14" y="52" width="52" height="34" rx="2" fill="#6b7280"/>
            <rect x="14" y="52" width="52" height="7"  fill="#9ca3af"/>
            {/* Zipper stripe */}
            <rect x="35" y="54" width="10" height="32" fill="#4b5563" opacity="0.5"/>
            {/* Belt */}
            <rect x="14" y="78" width="52" height="8"  fill="#4b5563"/>
            <rect x="30" y="79" width="20" height="6"  rx="1" fill="#78350f"/>
            <rect x="35" y="80" width="10" height="4"  fill="#d97706"/>

            {/* ── Left arm — raised straight up-left ── */}
            <rect x="0"  y="52" width="14" height="10" rx="3" fill="#9ca3af"/>
            <rect x="-2" y="40" width="12" height="14" rx="3" fill="#9ca3af"/>
            <rect x="0"  y="26" width="10" height="16" rx="3" fill="#9ca3af"/>
            {/* Left glove */}
            <rect x="-6" y="10" width="20" height="18" rx="2" fill="#ef4444"/>
            <rect x="-4" y="8"  width="16" height="6"  rx="2" fill="#dc2626"/>
            <rect x="-6" y="24" width="20" height="5"  rx="2" fill="#fbbf24"/>

            {/* ── Right arm — raised straight up-right ── */}
            <rect x="66" y="52" width="14" height="10" rx="3" fill="#9ca3af"/>
            <rect x="70" y="40" width="12" height="14" rx="3" fill="#9ca3af"/>
            <rect x="70" y="26" width="10" height="16" rx="3" fill="#9ca3af"/>
            {/* Right glove */}
            <rect x="66" y="10" width="20" height="18" rx="2" fill="#ef4444"/>
            <rect x="68" y="8"  width="16" height="6"  rx="2" fill="#dc2626"/>
            <rect x="66" y="24" width="20" height="5"  rx="2" fill="#fbbf24"/>

            {/* ── Legs ── */}
            <rect x="16" y="86" width="20" height="22" rx="2" fill="#4b5563"/>
            <rect x="44" y="86" width="20" height="22" rx="2" fill="#4b5563"/>
            {/* Hooves */}
            <rect x="12" y="100" width="28" height="8"  rx="3" fill="#111827"/>
            <rect x="40" y="100" width="28" height="8"  rx="3" fill="#111827"/>
          </svg>
        </div>

        {/* Ground bar */}
        <div style={{
          width: 180, height: 5, marginTop: 2,
          background: 'linear-gradient(90deg, transparent, #10b981 20%, #fbbf24 50%, #10b981 80%, transparent)',
          borderRadius: 3,
        }}/>

        {/* PHASE APPROVED popup — same style as DEAL WON */}
        <div className="ru-popup" style={{
          marginTop: 20,
          background: '#052e16',
          border: '3px solid #fbbf24',
          borderRadius: 3,
          padding: '14px 26px 16px',
          textAlign: 'center',
          animation: 'ru-popup 0.4s cubic-bezier(.22,1,.36,1) 0.3s both',
          boxShadow: '4px 4px 0 #78350f, 0 0 32px rgba(251,191,36,0.55), inset 0 0 0 1px #14532d',
        }}>
          <div style={{
            fontFamily: '"Press Start 2P", "Courier New", monospace',
            fontSize: 14,
            color: '#fde68a',
            textShadow: '0 0 14px rgba(251,191,36,0.9), 2px 2px 0 #78350f',
            letterSpacing: '0.04em',
            lineHeight: 1.7,
          }}>PHASE APPROVED!</div>
          <div style={{
            fontFamily: '"Press Start 2P", "Courier New", monospace',
            fontSize: 7,
            color: '#86efac',
            marginTop: 8,
            textShadow: '0 0 8px rgba(16,185,129,0.7)',
            letterSpacing: '0.06em',
          }}>ACHIEVEMENT UNLOCKED</div>
        </div>
      </div>
    </div>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────

export default function ClientPortalPage({ token }) {
  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [proposalPanel, setProposalPanel] = useState(null);
  const [approveModal, setApproveModal] = useState(null); // { task } or { milestone }
  const [approveName, setApproveName] = useState('');
  const [approving, setApproving] = useState(false);
  const [showHighFive, setShowHighFive] = useState(false);
  const [showRocky, setShowRocky] = useState(false);
  const [rejectModal, setRejectModal]   = useState(null); // { task }
  const [rejectName, setRejectName]     = useState('');
  const [rejectNotes, setRejectNotes]   = useState('');
  const [rejecting, setRejecting]       = useState(false);
  const [rejectError, setRejectError]   = useState('');
  const [expandedRejections, setExpandedRejections] = useState(new Set());
  const [expandedChains, setExpandedChains] = useState(new Set());
  const highlightTaskId = new URLSearchParams(window.location.search).get('task');

  useEffect(() => {
    async function load() {
      try {
        const proj = await fetchProjectByToken(token);
        setProject(proj);

        // Check password gate
        if (proj.portal_password) {
          const stored = sessionStorage.getItem(`portal_pw_${token}`);
          if (stored === '1') setAuthed(true);
          // else: stay unauthenticated until password entered
        } else {
          setAuthed(true);
        }

        // Load all data regardless (so it's ready after auth)
        const [ms, ts, fs] = await Promise.all([
          fetchMilestones(proj.id),
          fetchProjectTasks(proj.id),
          fetchProjectFiles(proj.id).catch(() => []),
        ]);
        setMilestones(ms);
        setTasks(ts);
        setFiles(fs);
        // Auto-expand milestone containing the highlighted task
        const hid = new URLSearchParams(window.location.search).get('task');
        if (hid) {
          const ht = ts.find(t => t.id === hid);
          if (ht?.milestone_id) setExpanded(e => ({ ...e, [ht.milestone_id]: true }));
        }
      } catch (e) {
        setError(e.message || 'Project not found');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const openApproveModal = (target) => {
    setApproveName('');
    setApproveModal(target);
  };

  const handleApproveSubmit = async () => {
    if (!approveName.trim()) return;
    setApproving(true);
    try {
      const now = new Date().toISOString();
      const name = approveName.trim();
      if (approveModal.task) {
        const updatedChain = await approveTask(approveModal.task.id, name);
        setTasks(prev => prev.map(t =>
          t.id === approveModal.task.id ? { ...t, approved_at: now, approved_by: name, rejected_at: null, rejected_by: null, review_chain: updatedChain } : t
        ));
        setApproveModal(null);
        setShowHighFive(true);
      } else if (approveModal.milestone) {
        await approveMilestone(approveModal.milestone.id, name);
        setMilestones(prev => prev.map(m =>
          m.id === approveModal.milestone.id ? { ...m, approved_at: now, approved_by: name } : m
        ));
        setApproveModal(null);
        setShowRocky(true);
      }
    } catch (e) {
      console.error('Approve failed:', e.message);
    } finally {
      setApproving(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectName.trim() || !rejectNotes.trim()) return;
    setRejecting(true);
    setRejectError('');
    try {
      const name  = rejectName.trim();
      const notes = rejectNotes.trim();
      const now   = new Date().toISOString();
      const updatedChain = await rejectTask(rejectModal.task.id, name, notes);
      setTasks(prev => prev.map(t =>
        t.id === rejectModal.task.id
          ? { ...t, rejected_at: now, rejected_by: name, rejection_notes: notes, approved_at: null, approved_by: null, review_chain: updatedChain }
          : t
      ));
      setRejectModal(null);
      setRejectName('');
      setRejectNotes('');
    } catch (e) {
      setRejectError(e.message || 'Something went wrong — please try again.');
    } finally {
      setRejecting(false);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: `3px solid #e5e7eb`, borderTopColor: ACCENT,
            borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Loading project…</div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: 20 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 8 }}>Project Not Found</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>
            This link may be invalid or the project may no longer be available.
          </div>
        </div>
      </div>
    );
  }

  // ── Password gate ─────────────────────────────────────────────────────────

  if (project.portal_password && !authed) {
    return (
      <PasswordGate
        token={token}
        password={project.portal_password}
        onSuccess={() => setAuthed(true)}
      />
    );
  }

  // ── Compute progress ──────────────────────────────────────────────────────

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.completed).length;
  const pct = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0;

  // ── Tasks grouped by milestone ────────────────────────────────────────────

  const tasksByMs = tasks.reduce((acc, t) => {
    if (!acc[t.milestone_id]) acc[t.milestone_id] = [];
    acc[t.milestone_id].push(t);
    return acc;
  }, {});

  // ── Files grouped ─────────────────────────────────────────────────────────

  const generalFiles = files.filter(f => !f.milestone_id && !f.task_id);
  const milestoneFiles = (msId) => files.filter(f => f.milestone_id === msId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'Inter, sans-serif', color: '#111827' }}>

      {/* Top bar */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '0 32px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{
          fontFamily: '"Playfair Display", serif', fontWeight: 700,
          fontSize: 20, color: ACCENT, letterSpacing: '-0.02em',
        }}>Part Human</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>
          {project.name}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* Project header card */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: '28px 32px', marginBottom: 28,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb',
        }}>
          {project.client_name && (
            <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
              {project.client_name}
            </div>
          )}
          <div style={{ fontSize: 16, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>
            {project.name}
          </div>

          {(project.start_date || project.end_date) && (
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>📅</span>
              {project.start_date && <span>{fmtDate(project.start_date)}</span>}
              {project.start_date && project.end_date && <span>→</span>}
              {project.end_date && <span>{fmtDate(project.end_date)}</span>}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Overall Progress</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>{pct}%</span>
          </div>
          <ProgressBar pct={pct} color={ACCENT} height={8} />
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
            {doneTasks} of {totalTasks} tasks complete
          </div>
        </div>

        {/* Milestones */}
        {milestones.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 14 }}>
              Project Timeline
            </div>
            {/* Gantt chart */}
            {(project.start_date || milestones.some(m => m.start_date)) && (
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 16px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }}>
                <PortalGantt
                  milestones={milestones}
                  projectStart={project.start_date || milestones.filter(m => m.start_date).map(m => m.start_date).sort()[0]}
                  projectEnd={project.end_date || milestones.filter(m => m.due_date).map(m => m.due_date).sort().at(-1)}
                />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {milestones.map(ms => {
                const msTasks = (tasksByMs[ms.id] || [])
                  .slice()
                  .sort((a, b) => {
                    if (a.order_index != null && b.order_index != null) return a.order_index - b.order_index;
                    if (!a.due_date && !b.due_date) return 0;
                    if (!a.due_date) return 1;
                    if (!b.due_date) return -1;
                    return a.due_date.localeCompare(b.due_date);
                  });
                const msColor = STATUS_COLORS[ms.status] || '#94a3b8';
                const isOpen = expanded[ms.id];
                const isComplete = ms.status === 'completed'
                  && msTasks.length > 0
                  && msTasks.every(t => t.completed)
                  && msTasks.every(t => t.approved_at)   // all tasks must be individually approved
                  && msTasks.every(t => !t.rejected_at); // no open change requests
                const msFiles = milestoneFiles(ms.id);

                return (
                  <div key={ms.id} style={{
                    background: '#fff', borderRadius: 12, overflow: 'hidden',
                    border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                  }}>
                    {/* Milestone header */}
                    <div
                      onClick={() => setExpanded(e => ({ ...e, [ms.id]: !e[ms.id] }))}
                      style={{
                        display: 'grid', gridTemplateColumns: '4px 1fr auto', gap: 0,
                        alignItems: 'stretch', cursor: 'pointer',
                        borderBottom: isOpen ? '1px solid #f3f4f6' : 'none',
                      }}
                    >
                      {/* Color strip */}
                      <div style={{ background: msColor, opacity: 0.8 }} />

                      {/* Content */}
                      <div style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{ms.title}</span>
                          <StatusBadge status={ms.status} />
                          {ms.due_date && (
                            <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
                              {ms.start_date ? `${fmtDate(ms.start_date)} – ` : ''}{fmtDate(ms.due_date)}
                            </span>
                          )}
                        </div>
                        {msTasks.length > 0 && (
                          <div style={{ fontSize: 12, color: '#9ca3af' }}>
                            {msTasks.filter(t => t.completed).length}/{msTasks.length} tasks
                          </div>
                        )}
                      </div>

                      {/* Chevron */}
                      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', color: '#9ca3af', fontSize: 13 }}>
                        {isOpen ? '▲' : '▼'}
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isOpen && (
                      <div>
                        {/* Tasks */}
                        {msTasks.map(task => (
                          <div key={task.id}
                            id={`task-${task.id}`}
                            ref={task.id === highlightTaskId ? el => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                            style={{
                              padding: '10px 18px 10px 22px',
                              borderBottom: '1px solid #f9fafb',
                              background: task.id === highlightTaskId ? '#fffbeb' : 'transparent',
                              transition: 'background 1s ease',
                            }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{
                              fontSize: 16, flexShrink: 0, color: task.completed ? '#10b981' : '#d1d5db',
                            }}>
                              {task.completed ? '✓' : '□'}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{
                                fontSize: 14, color: task.approved_at ? '#9ca3af' : '#374151',
                                fontWeight: task.approved_at ? 400 : 500,
                                textDecoration: task.approved_at ? 'line-through' : 'none',
                                textDecorationColor: '#9ca3af',
                              }}>
                                {task.title}
                              </span>
                            </div>
                            {task.due_date && (
                              <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                {fmtDate(task.due_date)}
                              </span>
                            )}
                            {task.completed && (
                              task.approved_at ? (
                                <span style={{
                                  fontSize: 11, fontWeight: 700, color: '#10b981',
                                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                                  borderRadius: 4, padding: '2px 8px', flexShrink: 0,
                                  whiteSpace: 'nowrap',
                                }}>✓ Approved</span>
                              ) : task.rejected_at ? (
                                <button
                                  onClick={e => { e.stopPropagation(); setExpandedRejections(s => { const n = new Set(s); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; }); }}
                                  style={{
                                    background: '#fef2f2', border: '1px solid #fca5a5',
                                    color: '#ef4444', cursor: 'pointer',
                                    fontSize: 11, fontWeight: 700, padding: '2px 8px',
                                    borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap',
                                    fontFamily: 'Inter, sans-serif',
                                  }}
                                >⚠ Changes Requested {expandedRejections.has(task.id) ? '▲' : '▼'}</button>
                              ) : (
                                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); openApproveModal({ task }); }}
                                    style={{
                                      background: 'none', border: '1px solid #10b981',
                                      color: '#10b981', cursor: 'pointer',
                                      fontSize: 11, fontWeight: 700, padding: '2px 8px',
                                      borderRadius: 4, whiteSpace: 'nowrap',
                                      fontFamily: 'Inter, sans-serif',
                                    }}
                                  >Approve ✓</button>
                                  <button
                                    onClick={e => { e.stopPropagation(); setRejectName(''); setRejectNotes(''); setRejectModal({ task }); }}
                                    style={{
                                      background: 'none', border: '1px solid #f87171',
                                      color: '#ef4444', cursor: 'pointer',
                                      fontSize: 11, fontWeight: 700, padding: '2px 8px',
                                      borderRadius: 4, whiteSpace: 'nowrap',
                                      fontFamily: 'Inter, sans-serif',
                                    }}
                                  >Not Approved ✕</button>
                                </div>
                              )
                            )}
                            {(project.proposal_text || project.proposal_pdf_url) && (
                              <button
                                onClick={e => { e.stopPropagation(); setProposalPanel({ task }); }}
                                title="See in proposal"
                                style={{
                                  background: 'none', border: `1px solid #d1d5db`,
                                  color: '#9ca3af', cursor: 'pointer',
                                  fontSize: 10, fontWeight: 700, padding: '2px 7px',
                                  borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap',
                                  letterSpacing: '.02em', fontFamily: 'Inter, sans-serif',
                                }}
                              >📄 proposal</button>
                            )}
                            </div>{/* end flex row */}
                            {/* ── Chain of custody (read-only on portal) ── */}
                            {(() => {
                              const chain = task.review_chain || [];
                              const hasApproval = task.approved_at;
                              if (chain.length === 0 && !hasApproval) return null;

                              const isExpanded  = expandedChains.has(task.id);
                              const toggleChain = () => setExpandedChains(s => { const n = new Set(s); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; });

                              let rn = 0;
                              const displayChain = chain.map(ev => ev.type === 'revised_sent' ? { ...ev, revNum: ++rn } : ev);

                              const eventLabel = ev => {
                                if (ev.type === 'sent')         return { icon: '📤', text: 'Sent for review',            color: '#9ca3af' };
                                if (ev.type === 'rejected')     return { icon: '⚠',  text: `Changes requested by ${ev.by}`, color: '#ef4444' };
                                if (ev.type === 'revised_sent') return { icon: '📤', text: `Revision ${ev.revNum} sent`,  color: '#9ca3af' };
                                if (ev.type === 'approved')     return { icon: '✓',  text: `Approved by ${ev.by}`,        color: '#10b981' };
                                return { icon: '·', text: ev.type, color: '#9ca3af' };
                              };

                              return (
                                <div style={{ margin: '6px 0 2px 28px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {hasApproval && chain.length === 0 && (
                                    <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>
                                      ✓ Approved by {task.approved_by} on {fmtDate(task.approved_at)}
                                    </div>
                                  )}
                                  {chain.length > 0 && (
                                    <>
                                      <button
                                        onClick={toggleChain}
                                        style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, color: '#9ca3af', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, fontFamily: 'Inter, sans-serif' }}
                                      >{isExpanded ? '▲ Hide' : '▼ Show'} review history ({chain.length})</button>
                                      {isExpanded && (
                                        <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                          {displayChain.map((ev, i) => {
                                            const lbl = eventLabel(ev);
                                            return (
                                              <div key={i} style={{ fontSize: 12 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                  <span style={{ color: lbl.color, fontWeight: 700 }}>{lbl.icon}</span>
                                                  <span style={{ color: lbl.color, fontWeight: ev.type === 'rejected' ? 700 : 500 }}>{lbl.text}</span>
                                                  <span style={{ color: '#d1d5db', fontSize: 11 }}>· {fmtDate(ev.at)}</span>
                                                </div>
                                                {ev.type === 'rejected' && ev.notes && (
                                                  <div style={{ marginTop: 4, marginLeft: 18, padding: '5px 9px', background: '#fef2f2', borderRadius: 5, fontSize: 11, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                                    {ev.notes}
                                                  </div>
                                                )}
                                                {ev.type === 'revised_sent' && ev.response && (
                                                  <div style={{ marginTop: 4, marginLeft: 18, padding: '5px 9px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 5, fontSize: 11, color: '#6b7280', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                                                    "{ev.response}"
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ))}

                        {/* Milestone files */}
                        {msFiles.length > 0 && msFiles.map(f => (
                          <div key={f.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 18px 9px 22px', borderBottom: '1px solid #f9fafb',
                            background: '#fafafa',
                          }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                            <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                              flex: 1, fontSize: 13, fontWeight: 600, color: ACCENT,
                              textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{f.name}</a>
                            {f.size && <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>}
                          </div>
                        ))}

                        {/* Approve section */}
                        {isComplete && (
                          <div style={{
                            padding: '14px 18px', background: '#f0fdf4', borderTop: '1px solid #dcfce7',
                            display: 'flex', alignItems: 'center', gap: 12,
                          }}>
                            {ms.approved_at ? (
                              <span style={{
                                fontSize: 13, fontWeight: 700, color: '#10b981',
                                display: 'flex', alignItems: 'center', gap: 6,
                              }}>
                                <span>✓</span> Approved on {fmtDate(ms.approved_at)}
                              </span>
                            ) : (
                              <>
                                <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>
                                  This phase is complete. Ready to sign off?
                                </span>
                                <button
                                  onClick={() => openApproveModal({ milestone: ms })}
                                  style={{
                                    padding: '8px 18px', borderRadius: 8, border: 'none',
                                    background: ACCENT, color: '#fff', fontSize: 13, fontWeight: 700,
                                    cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
                                  }}
                                >
                                  Approve this phase →
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Files section */}
        {files.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 14 }}>
              Project Files
            </div>
            <div style={{
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            }}>
              {generalFiles.length > 0 && (
                <>
                  {generalFiles.length < files.length && (
                    <div style={{ padding: '8px 18px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                      General
                    </div>
                  )}
                  {generalFiles.map((f, i) => (
                    <div key={f.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                      borderBottom: i < files.length - 1 ? '1px solid #f3f4f6' : 'none',
                    }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                        flex: 1, fontSize: 14, fontWeight: 600, color: ACCENT,
                        textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{f.name}</a>
                      {f.size && <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>}
                    </div>
                  ))}
                </>
              )}

              {/* Per-milestone files */}
              {milestones.map(ms => {
                const msFs = milestoneFiles(ms.id);
                if (!msFs.length) return null;
                return msFs.map((f, i) => (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                    borderBottom: '1px solid #f3f4f6',
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mime_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 14, fontWeight: 600, color: ACCENT,
                        textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                      }}>{f.name}</a>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{ms.title}</div>
                    </div>
                    {f.size && <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{fmtFileSize(f.size)}</span>}
                  </div>
                ));
              })}
            </div>
          </div>
        )}

      </div>

      {/* Celebrations */}
      {showHighFive && <HighFiveCelebration onDone={() => setShowHighFive(false)} />}
      {showRocky    && <RockyUnicornCelebration onDone={() => setShowRocky(false)} />}

      {/* Reject modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setRejectModal(null)} />
          <div style={{
            position: 'relative', zIndex: 1, background: '#fff', borderRadius: 16,
            padding: '28px 28px 24px', width: '100%', maxWidth: 440,
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)', fontFamily: 'Inter, sans-serif',
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 4 }}>Request changes</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>
              <strong style={{ color: '#374151' }}>{rejectModal.task.title}</strong> — let the team know what needs to be revised.
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Your name</div>
              <input
                autoFocus
                value={rejectName}
                onChange={e => setRejectName(e.target.value)}
                placeholder="e.g. Sarah"
                style={{ width: '100%', fontSize: 14, padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>What needs to change?</div>
              <textarea
                value={rejectNotes}
                onChange={e => setRejectNotes(e.target.value)}
                placeholder="Describe the specific changes needed…"
                rows={4}
                style={{ width: '100%', fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'Inter, sans-serif', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
              />
            </div>
            {rejectError && (
              <div style={{ fontSize: 12, color: '#ef4444', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
                ⚠ {rejectError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setRejectModal(null); setRejectError(''); }}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
              >Cancel</button>
              <button
                onClick={handleRejectSubmit}
                disabled={rejecting || !rejectName.trim() || !rejectNotes.trim()}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: rejecting || !rejectName.trim() || !rejectNotes.trim() ? '#fca5a5' : '#ef4444', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
              >{rejecting ? 'Submitting…' : 'Submit feedback'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Approve modal */}
      {approveModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }}
            onClick={() => setApproveModal(null)}
          />
          <div style={{
            position: 'relative', zIndex: 1,
            background: '#fff', borderRadius: 14, padding: '32px 28px',
            width: '100%', maxWidth: 400,
            boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
            fontFamily: 'Inter, sans-serif',
          }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', marginBottom: 6 }}>
              {approveModal.task ? 'Approve task' : 'Approve this phase'}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.5 }}>
              {approveModal.task
                ? <><strong style={{ color: '#374151' }}>{approveModal.task.title}</strong><br />Please enter your name to confirm approval.</>
                : <><strong style={{ color: '#374151' }}>{approveModal.milestone.title}</strong><br />Please enter your name to confirm approval of this phase.</>
              }
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
              Your name
            </label>
            <input
              type="text"
              value={approveName}
              onChange={e => setApproveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleApproveSubmit()}
              placeholder="e.g. Jane Smith"
              autoFocus
              style={{
                width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8,
                border: '1.5px solid #d1d5db', outline: 'none',
                marginBottom: 20, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setApproveModal(null)}
                style={{
                  padding: '9px 18px', borderRadius: 8, border: '1px solid #d1d5db',
                  background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                }}
              >Cancel</button>
              <button
                onClick={handleApproveSubmit}
                disabled={!approveName.trim() || approving}
                style={{
                  padding: '9px 20px', borderRadius: 8, border: 'none',
                  background: approveName.trim() ? '#10b981' : '#d1d5db',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: approveName.trim() ? 'pointer' : 'default',
                  fontFamily: 'Inter, sans-serif', transition: 'background .15s',
                }}
              >{approving ? 'Saving…' : 'Confirm approval'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Proposal side drawer */}
      {proposalPanel && (() => {
        const proposalText   = project.proposal_text    || '';
        const proposalPdfUrl = project.proposal_pdf_url || '';
        const hints          = project.proposal_page_hints;
        const isPdf          = !!proposalPdfUrl;
        const paras          = proposalText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        const highlightIdx   = findRelevantParaIndex(proposalText, proposalPanel.task.title);

        const hintsAreIndexed = hints && !Array.isArray(hints) && typeof hints === 'object';
        let pageNum = null;
        if (hintsAreIndexed) {
          pageNum = hints[proposalPanel.task.title] ?? findPageHint(hints, proposalPanel.task.title) ?? null;
        } else if (Array.isArray(hints) && highlightIdx >= 0) {
          pageNum = hints[highlightIdx] || null;
        }

        const searchParam = pdfSearchParam(proposalPanel.task.title);

        return (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 850, background: 'rgba(0,0,0,0.2)' }}
              onClick={() => setProposalPanel(null)}
            />
            {/* Drawer */}
            <div style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 860,
              width: isPdf ? 600 : 440, maxWidth: '92vw',
              background: '#fff',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column',
              borderLeft: '1px solid #e5e7eb',
              fontFamily: 'Inter, sans-serif',
            }}>
              {/* Header */}
              <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 4 }}>
                      Proposal Reference {isPdf && '· PDF'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>{proposalPanel.task.title}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {isPdf && (
                      <a
                        href={`${proposalPdfUrl}#page=${pageNum || 1}&search=${searchParam}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, fontWeight: 700, color: ACCENT, textDecoration: 'none', padding: '4px 10px', border: `1px solid ${ACCENT}`, borderRadius: 5 }}
                      >
                        ↗ Open PDF{pageNum ? ` (p.${pageNum})` : ''}
                      </a>
                    )}
                    <button
                      onClick={() => setProposalPanel(null)}
                      style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af', padding: '2px 4px', lineHeight: 1 }}
                    >✕</button>
                  </div>
                </div>
                {isPdf && pageNum && (
                  <div style={{ marginTop: 10, padding: '7px 10px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                    📄 Jumping to page {pageNum}
                  </div>
                )}
                {!isPdf && highlightIdx >= 0 && (
                  <div style={{ marginTop: 10, padding: '7px 10px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                    ✨ Most relevant section highlighted below
                  </div>
                )}
              </div>

              {/* Body */}
              {isPdf ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <embed
                    key={`${proposalPanel.task.id}-p${pageNum}`}
                    src={`${proposalPdfUrl}#page=${pageNum || 1}&search=${searchParam}&toolbar=1&navpanes=0`}
                    type="application/pdf"
                    style={{ flex: paras.length ? '0 0 55%' : 1, width: '100%', border: 'none' }}
                  />
                  {paras.length > 0 && highlightIdx >= 0 && (
                    <div style={{ borderTop: '2px solid #fde68a', background: '#fffbeb', flexShrink: 0, maxHeight: '45%', overflowY: 'auto', padding: '10px 16px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#92400e', marginBottom: 8 }}>
                        ✨ Most relevant excerpt
                      </div>
                      {[
                        highlightIdx > 0 && paras[highlightIdx - 1],
                        paras[highlightIdx],
                        highlightIdx < paras.length - 1 && paras[highlightIdx + 1],
                      ].filter(Boolean).map((para, i) => (
                        <p key={i} style={{
                          fontSize: 12, lineHeight: 1.65, marginBottom: 8,
                          padding: (i === 1 || (highlightIdx === 0 && i === 0)) ? '8px 10px' : '0',
                          borderRadius: 5,
                          background: (i === 1 || (highlightIdx === 0 && i === 0)) ? '#fef9c3' : 'transparent',
                          border: (i === 1 || (highlightIdx === 0 && i === 0)) ? '1px solid #fde68a' : 'none',
                          whiteSpace: 'pre-wrap', color: '#374151',
                        }}>{para}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key={proposalPanel.task.id} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                  {paras.length === 0 ? (
                    <p style={{ color: '#9ca3af', fontSize: 13 }}>No proposal text available.</p>
                  ) : (
                    paras.map((para, i) => (
                      <p
                        key={i}
                        ref={i === highlightIdx ? el => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                        style={{
                          fontSize: 13, lineHeight: 1.7, marginBottom: 14,
                          padding: i === highlightIdx ? '10px 12px' : '0',
                          borderRadius: i === highlightIdx ? 6 : 0,
                          background: i === highlightIdx ? '#fef9c3' : 'transparent',
                          border: i === highlightIdx ? '1px solid #fde68a' : 'none',
                          color: '#374151',
                          whiteSpace: 'pre-wrap',
                        }}
                      >{para}</p>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '24px 20px', fontSize: 12, color: '#9ca3af' }}>
        Powered by <a href="https://parthuman.com" target="_blank" rel="noopener noreferrer" style={{ color: '#9ca3af', textDecoration: 'none', fontWeight: 600 }}>Part Human</a> · parthuman.com
      </div>
    </div>
  );
}
