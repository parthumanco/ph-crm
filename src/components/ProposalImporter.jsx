import { useState, useRef } from 'react';
import { parseProposalWithAI, extractPdfTextAndPages, addDays, OWNERS } from '../lib/projects';

const today = new Date().toISOString().slice(0, 10);

export default function ProposalImporter({ projectId, projectStart, onImported, onClose }) {
  const [step, setStep]           = useState('paste');   // paste | parsing | preview | saving
  const [inputMode, setInputMode] = useState('text');    // text | pdf
  const [text, setText]           = useState('');
  const [pdfFile, setPdfFile]     = useState(null);      // File object
  const [pdfBase64, setPdfBase64] = useState(null);      // base64 string
  const [startDate, setStartDate] = useState(projectStart || today);
  const [error, setError]         = useState('');
  const [parsed, setParsed]       = useState(null);      // raw AI output
  const [preview, setPreview]     = useState([]);         // editable milestones
  const fileInputRef              = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { setError('Please select a PDF file.'); return; }
    setPdfFile(file);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Strip the data URL prefix to get raw base64
      const b64 = ev.target.result.split(',')[1];
      setPdfBase64(b64);
    };
    reader.readAsDataURL(file);
  };

  // ── Step 1: parse ─────────────────────────────────────────────────────────
  const handleParse = async () => {
    if (inputMode === 'text' && !text.trim()) { setError('Please paste your proposal text.'); return; }
    if (inputMode === 'pdf'  && !pdfBase64)   { setError('Please select a PDF file.'); return; }
    setError('');
    setStep('parsing');
    try {
      const result = await parseProposalWithAI(
        inputMode === 'text' ? text : '',
        startDate,
        inputMode === 'pdf' ? pdfBase64 : null,
      );
      setParsed(result);

      // Build editable preview — calculate dates
      let cursor = startDate;
      const rows = (result.milestones || []).map((m, i) => {
        const start = cursor;
        const end   = addDays(cursor, m.duration_days || 14);
        cursor = end;
        return {
          _id:         crypto.randomUUID(),
          title:       m.title,
          description: m.description || '',
          duration:    m.duration_days || 14,
          assigned_to: '',
          start_date:  start,
          due_date:    end,
          tasks:       (m.tasks || []).map(t => ({
            _id:         crypto.randomUUID(),
            title:       t.title,
            duration:    t.duration_days || 2,
            assigned_to: '',
          })),
        };
      });
      setPreview(rows);
      setStep('preview');
    } catch (e) {
      setError(e.message || 'Parse failed — check your API key or try again.');
      setStep('paste');
    }
  };

  // Recalculate dates when a duration changes
  const recalcDates = (rows, fromIndex = 0, base = startDate) => {
    let cursor = fromIndex === 0 ? base : rows[fromIndex - 1].due_date;
    return rows.map((r, i) => {
      if (i < fromIndex) return r;
      const start = cursor;
      const end   = addDays(cursor, r.duration);
      cursor = end;
      return { ...r, start_date: start, due_date: end };
    });
  };

  const updateMilestone = (idx, key, val) => {
    setPreview(prev => {
      const next = prev.map((r, i) => i === idx ? { ...r, [key]: val } : r);
      return key === 'duration' ? recalcDates(next, idx) : next;
    });
  };

  const updateTask = (msIdx, tIdx, key, val) => {
    setPreview(prev => prev.map((r, i) => {
      if (i !== msIdx) return r;
      const tasks = r.tasks.map((t, j) => j === tIdx ? { ...t, [key]: val } : t);
      return { ...r, tasks };
    }));
  };

  const removeMilestone = (idx) => {
    setPreview(prev => recalcDates(prev.filter((_, i) => i !== idx)));
  };

  const removeTask = (msIdx, tIdx) => {
    setPreview(prev => prev.map((r, i) => i !== msIdx ? r : {
      ...r, tasks: r.tasks.filter((_, j) => j !== tIdx),
    }));
  };

  // ── Step 3: confirm → pass back to parent ────────────────────────────────
  const handleConfirm = async () => {
    setStep('saving');
    let proposalText    = inputMode === 'text' ? text : null;
    let proposalPageHints = null;

    // For PDFs: extract full text + page hints in parallel with the save
    if (inputMode === 'pdf' && pdfBase64) {
      try {
        const allTaskTitles = preview.flatMap(m => m.tasks.map(t => t.title));
        const { text: extracted, pageArray } = await extractPdfTextAndPages(pdfBase64, allTaskTitles);
        proposalText = extracted || null;
        // Build hints keyed by the EXACT task titles we passed in — no mismatch possible
        if (pageArray.length) {
          const hints = {};
          allTaskTitles.forEach((title, i) => {
            if (pageArray[i]) hints[title] = pageArray[i];
          });
          proposalPageHints = Object.keys(hints).length ? hints : null;
        }
      } catch (e) {
        console.warn('PDF text extraction failed:', e.message);
      }
    }

    onImported({
      startDate,
      projectName: parsed.project_name || '',
      milestones:  preview,
      proposalText,
      proposalPdfFile:  inputMode === 'pdf' ? pdfFile : null,
      proposalPageHints,
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />

      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--bg)', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
        width: step === 'preview' ? 780 : 560,
        maxWidth: '95vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width .3s',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
              {step === 'paste'   && '📋 Import Proposal'}
              {step === 'parsing' && '🤖 Reading proposal…'}
              {step === 'preview' && '✏️ Review & Edit Timeline'}
              {step === 'saving'  && (inputMode === 'pdf' ? '🔍 Extracting text & building timeline…' : '💾 Creating timeline…')}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {step === 'paste'   && 'Paste your proposal and Claude will build the project timeline'}
              {step === 'parsing' && 'Extracting phases, tasks, and durations…'}
              {step === 'preview' && 'Adjust milestones, durations, and assignments before saving'}
              {step === 'saving'  && 'Writing milestones and tasks to the database…'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── PASTE step ── */}
          {step === 'paste' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>
                  Project start date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  style={{ width: 200 }}
                />
              </div>

              {/* Input mode toggle */}
              <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 8, padding: 3, alignSelf: 'flex-start' }}>
                {[{ id: 'text', label: '✏️ Paste text' }, { id: 'pdf', label: '📄 Upload PDF' }].map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setInputMode(m.id); setError(''); }}
                    style={{
                      padding: '6px 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600,
                      background: inputMode === m.id ? 'var(--surface)' : 'transparent',
                      color: inputMode === m.id ? 'var(--text)' : 'var(--text-muted)',
                      boxShadow: inputMode === m.id ? 'var(--shadow)' : 'none',
                      transition: 'all .15s',
                    }}
                  >{m.label}</button>
                ))}
              </div>

              {inputMode === 'text' ? (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>
                    Proposal text
                  </label>
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Paste your full proposal, scope of work, or project brief here…"
                    style={{ width: '100%', minHeight: 240, fontSize: 13, resize: 'vertical' }}
                  />
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>
                    PDF file
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <div
                    onClick={() => fileInputRef.current.click()}
                    style={{
                      border: '2px dashed var(--border)', borderRadius: 8, padding: '36px 24px',
                      textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s, background .15s',
                      background: pdfFile ? 'var(--surface-2)' : 'transparent',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    {pdfFile ? (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{pdfFile.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                          {(pdfFile.size / 1024).toFixed(0)} KB · Click to change
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>Click to select a PDF</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>Proposal, scope of work, or project brief</div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {error && <p style={{ fontSize: 13, color: '#ef4444', margin: 0 }}>{error}</p>}
              <button
                className="btn btn-primary"
                onClick={handleParse}
                disabled={inputMode === 'text' ? !text.trim() : !pdfBase64}
                style={{ alignSelf: 'flex-start' }}
              >
                Parse with AI →
              </button>
            </div>
          )}

          {/* ── PARSING step ── */}
          {step === 'parsing' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', gap: 16 }}>
              <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
              <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Reading your proposal…</p>
            </div>
          )}

          {/* ── PREVIEW step ── */}
          {step === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {preview.map((m, mi) => (
                <div key={m._id} style={{
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface)', overflow: 'hidden',
                }}>
                  {/* Milestone row */}
                  <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px 32px', gap: 10, alignItems: 'center', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                    <input
                      type="text"
                      value={m.title}
                      onChange={e => updateMilestone(mi, 'title', e.target.value)}
                      style={{ fontWeight: 700, fontSize: 13, border: 'none', background: 'transparent', padding: '2px 4px', outline: 'none', width: '100%' }}
                    />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 2 }}>Days</div>
                      <input
                        type="number"
                        min={1}
                        value={m.duration}
                        onChange={e => updateMilestone(mi, 'duration', parseInt(e.target.value) || 1)}
                        style={{ width: '100%', textAlign: 'center', padding: '3px 4px', fontSize: 12 }}
                      />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 2 }}>Tasks</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', paddingTop: 4 }}>{m.tasks.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 2 }}>Assigned</div>
                      <select
                        value={m.assigned_to}
                        onChange={e => updateMilestone(mi, 'assigned_to', e.target.value)}
                        style={{ fontSize: 12, padding: '3px 6px', width: '100%' }}
                      >
                        <option value="">Unassigned</option>
                        {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <button
                      onClick={() => removeMilestone(mi)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: 2 }}
                      title="Remove milestone"
                    >✕</button>
                  </div>

                  {/* Date range */}
                  <div style={{ padding: '4px 14px 6px', fontSize: 10, color: 'var(--text-faint)' }}>
                    {m.start_date} → {m.due_date}
                  </div>

                  {/* Tasks */}
                  {m.tasks.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-light)' }}>
                      {/* Task column headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 32px', gap: 10, padding: '4px 14px 4px 28px', background: 'var(--bg)' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Task</div>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'center' }}>Days</div>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Assigned</div>
                        <div />
                      </div>
                      {m.tasks.map((t, ti) => (
                        <div key={t._id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 32px', gap: 10, padding: '7px 14px 7px 28px', alignItems: 'center', borderBottom: ti < m.tasks.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                          <input
                            type="text"
                            value={t.title}
                            onChange={e => updateTask(mi, ti, 'title', e.target.value)}
                            style={{ fontSize: 12, border: 'none', background: 'transparent', outline: 'none', padding: '2px 4px', width: '100%', color: 'var(--text-muted)' }}
                          />
                          <input
                            type="number"
                            min={1}
                            value={t.duration}
                            onChange={e => updateTask(mi, ti, 'duration', parseInt(e.target.value) || 1)}
                            style={{ width: '100%', textAlign: 'center', padding: '2px 4px', fontSize: 11 }}
                          />
                          <select
                            value={t.assigned_to}
                            onChange={e => updateTask(mi, ti, 'assigned_to', e.target.value)}
                            style={{ fontSize: 11, padding: '2px 6px', width: '100%' }}
                          >
                            <option value="">Unassigned</option>
                            {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                          <button
                            onClick={() => removeTask(mi, ti)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 14, cursor: 'pointer', padding: 2 }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── SAVING step ── */}
          {step === 'saving' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', gap: 16 }}>
              <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
              <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Creating your timeline…</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'preview' && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <button onClick={() => setStep('paste')} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
              ← Re-paste
            </button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {preview.length} milestones · {preview.reduce((s, m) => s + m.tasks.length, 0)} tasks
              </span>
              <button className="btn btn-primary" onClick={handleConfirm}>
                Create Timeline →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
