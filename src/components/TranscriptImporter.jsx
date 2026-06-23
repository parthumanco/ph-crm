import { useState, useRef, useEffect } from 'react';
import { parseMeetingWithAI, saveProjectMeeting, OWNERS } from '../lib/projects';

const today = new Date().toISOString().slice(0, 10);

/**
 * Best-effort: score a task title against milestone names and return the
 * milestone id that has the most word overlap. Falls back to the first milestone.
 */
function suggestMilestoneId(taskTitle, milestones) {
  if (!milestones?.length) return '';
  const stopWords = new Set(['the','and','for','with','that','this','from','will','have','been','are','was','our','all','can','not','but','its','your']);
  const taskWords = taskTitle.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
  if (!taskWords.length) return milestones[0].id;
  let bestId = milestones[0].id;
  let bestScore = 0;
  for (const ms of milestones) {
    const msWords = ms.title.toLowerCase().split(/\W+/).filter(w => !stopWords.has(w));
    const score = taskWords.reduce((s, tw) =>
      s + (msWords.some(mw => mw.includes(tw) || tw.includes(mw)) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestId = ms.id; }
  }
  return bestId;
}

/**
 * TranscriptImporter
 *
 * Props:
 *   projectId     — string (for project meetings)
 *   dealId        — string (for pre-project deal meetings; omit milestones/tasks)
 *   milestones    — array of { id, title } (project mode only)
 *   owners        — string[] (team members)
 *   defaultMsId   — optional pre-selected milestone id (for per-milestone entry point)
 *   onImported    — fn({ meeting, tasks }) called after save
 *   onClose       — fn()
 *
 *   — Prospect mode (no dealId or projectId) —
 *   prospectMode  — bool: true to enable company detection + deal linking
 *   allDeals      — array of deal objects [{ id, company_name }] for matching
 *   resolveDealId — async fn(companyName, contactName, contactEmail) => dealId
 *                   called before saving; creates or finds the deal
 */
export default function TranscriptImporter({ projectId, dealId, milestones = [], owners = OWNERS, existingTasks = [], defaultMsId, onImported, onClose, prospectMode = false, allDeals = [], resolveDealId, initialTranscript = '' }) {
  const isDealMode     = !!dealId && !projectId;
  const isProspectMode = prospectMode && !dealId && !projectId;

  const [step, setStep]             = useState('paste');   // paste | parsing | preview | saving
  const [transcript, setTranscript] = useState(initialTranscript);
  const [error, setError]           = useState('');
  const [parsed, setParsed]         = useState(null);      // raw AI output
  const [draggingOver, setDraggingOver] = useState(false);
  const fileInputRef = useRef(null);

  const stripRtf = (rtf) => {
    let s = rtf;
    // Remove non-text header groups (fonttbl, colortbl, stylesheet, pict, info)
    // These never contain readable text — do one pass before anything else
    s = s.replace(/\{\\(?:fonttbl|colortbl|stylesheet|pict|info)(?:[^{}]|\{[^{}]*\})*\}/g, '');
    // Remove {\* ...} ignored destination groups
    s = s.replace(/\{\\?\*(?:[^{}]|\{[^{}]*\})*\}/g, '');
    // Remove hex char escapes like \'e9
    s = s.replace(/\\'[0-9a-fA-F]{2}/g, ' ');
    // Remove control words (\word or \word123) and lone control symbols
    s = s.replace(/\\[a-zA-Z]+[-]?\d* ?/g, '');
    s = s.replace(/\\[^a-zA-Z\r\n]/g, '');
    // Strip remaining RTF delimiters — text content is now exposed
    s = s.replace(/[{}]/g, '');
    return s.replace(/\r\n|\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  const readFileAsText = (file) => new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      reject(new Error('PDF detected — please copy the transcript text from Granola and paste it here instead.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const isRtf = file.name.toLowerCase().endsWith('.rtf') || file.type === 'application/rtf' || file.type === 'text/rtf';
      resolve(isRtf ? stripRtf(text) : text);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });

  // ── Document-level drag-and-drop (active while modal is mounted) ─────────────
  useEffect(() => {
    if (step === 'parsing' || step === 'saving') {
      setDraggingOver(false); // clear any stuck overlay when drag is disabled
      return;
    }
    const onDragOver = e => { e.preventDefault(); setDraggingOver(true); };
    const onDragLeave = e => { if (!e.relatedTarget) setDraggingOver(false); };
    const onDrop = async e => {
      e.preventDefault();
      setDraggingOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        try {
          const text = await readFileAsText(file);
          setTranscript(text);
          setError('');
        } catch (err) {
          setError(err.message);
        }
      } else {
        // Text drag (e.g. dragging directly from Granola)
        const text = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text');
        if (text) { setTranscript(text); setError(''); }
      }
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [step]);

  const handleFileDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingOver(false);
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) {
      const text = e.dataTransfer?.getData?.('text/plain') || e.dataTransfer?.getData?.('text');
      if (text) { setTranscript(text); setError(''); }
      return;
    }
    try {
      const text = await readFileAsText(file);
      setTranscript(text);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  // Prospect mode: company + contact fields
  const [companyName, setCompanyName]   = useState('');
  const [contactName, setContactName]   = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [linkedDealId, setLinkedDealId] = useState('');    // '' = create new

  // Editable task list derived from parsed
  const [items, setItems] = useState([]);   // { ...action_item, selected, milestoneId, owner }

  // ── Step 1: Parse ─────────────────────────────────────────────────────────
  const handleParse = async () => {
    if (!transcript.trim()) { setError('Please paste a meeting transcript.'); return; }
    setError('');
    setStep('parsing');
    try {
      const result = await parseMeetingWithAI(transcript, existingTasks);
      setParsed(result);

      // Populate prospect fields from AI extraction
      if (isProspectMode) {
        const aiCompany = result.company_name || '';
        setCompanyName(aiCompany);
        setContactName(result.contact_name || '');
        setContactEmail(result.contact_email || '');
        // Auto-match to an existing deal (case-insensitive)
        if (aiCompany) {
          const match = allDeals.find(d => d.company_name.toLowerCase() === aiCompany.toLowerCase());
          setLinkedDealId(match ? match.id : '');
        }
      }

      setItems(
        (result.action_items || []).map(ai => ({
          ...ai,
          selected:         true,
          // In project mode: use the explicit defaultMsId (per-milestone entry point) if set,
          // otherwise auto-suggest the best milestone based on keyword overlap.
          milestoneId:      (isDealMode || isProspectMode)
            ? ''
            : (defaultMsId || suggestMilestoneId(ai.title, milestones)),
          owner:            ai.owner && owners.includes(ai.owner) ? ai.owner : '',
          estimated_hours:  '',
        }))
      );
      setStep('preview');
    } catch (e) {
      setError(e.message || 'Failed to parse transcript');
      setStep('paste');
    }
  };

  // ── Step 2: Save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    setStep('saving');
    try {
      // Prospect mode: resolve (find or create) the deal first
      let resolvedDealId = dealId || null;
      if (isProspectMode) {
        if (!companyName.trim()) {
          setError('Please enter a company name.');
          setStep('preview');
          return;
        }
        resolvedDealId = linkedDealId || await resolveDealId(companyName.trim(), contactName.trim(), contactEmail.trim());
      }

      const selectedItems = items.filter(it => it.selected);

      // Build tasks for each selected action item
      const now = new Date().toISOString();
      const tasks = selectedItems.map(it => ({
        id:               crypto.randomUUID(),
        project_id:       projectId,
        milestone_id:     it.milestoneId || null,
        title:            it.title,
        assigned_to:      it.owner || null,
        due_date:         it.due_date || null,
        notes:            it.notes || null,
        estimated_hours:  it.estimated_hours !== '' && it.estimated_hours != null
                            ? parseFloat(it.estimated_hours) : null,
        completed:        false,
        order_index:      999,
        created_at:       now,
      }));

      // Save meeting record
      const meeting = await saveProjectMeeting({
        projectId:    projectId || null,
        dealId:       resolvedDealId || null,
        title:        parsed.title || 'Meeting',
        meetingDate:  parsed.meeting_date || null,
        meetingTime:  parsed.meeting_time || null,
        attendees:    parsed.attendees || [],
        summary:      parsed.summary || null,
        transcript,
        actionItems:  selectedItems.map(({ title, owner, due_date, notes }) => ({ title, owner, due_date, notes })),
      });

      onImported({ meeting, tasks, suggestedUpdates: parsed.suggested_updates || [], milestoneId: defaultMsId, dealId: resolvedDealId, companyName: companyName.trim() });
    } catch (e) {
      setError(e.message || 'Failed to save');
      setStep('preview');
    }
  };

  const updateItem = (i, patch) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={step === 'parsing' || step === 'saving' ? undefined : onClose} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: '28px 28px 24px', width: 600, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              {isProspectMode ? '📝 Log a Meeting' : '📝 Import from transcript'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>
              {step === 'paste'   && (isProspectMode ? 'Paste a transcript — we\'ll detect the company automatically' : 'Paste a Granola (or any meeting) transcript')}
              {step === 'parsing' && 'Analyzing transcript…'}
              {step === 'preview' && (isProspectMode ? 'Confirm the company and review extracted tasks' : 'Review extracted tasks before adding to the project')}
              {step === 'saving'  && 'Saving…'}
            </div>
          </div>
          {step !== 'parsing' && step !== 'saving' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px', flexShrink: 0 }}>✕</button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* ── Paste step ── */}
          {(step === 'paste' || step === 'parsing') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ position: 'relative' }}>
                <textarea
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="Paste your Granola transcript or drag a .txt / .md file here…"
                  rows={14}
                  disabled={step === 'parsing'}
                  style={{ width: '100%', resize: 'vertical', fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit', padding: '10px 12px', borderRadius: 8, border: `1px solid ${draggingOver ? 'var(--accent)' : 'var(--border)'}`, background: draggingOver ? '#fffbeb' : 'var(--surface)', color: 'var(--text)', outline: 'none', opacity: step === 'parsing' ? 0.6 : 1, boxSizing: 'border-box', transition: 'border-color .15s' }}
                />
                {draggingOver && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 8, border: '2px dashed var(--accent)', background: 'rgba(251,191,36,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Drop file to import</span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}
                >📎 Or browse for file…</button>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>(.txt, .md, .rtf — for PDF, copy &amp; paste from Granola)</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.rtf" style={{ display: 'none' }} onChange={handleFileDrop} />
              {error && <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>{error}</div>}
            </div>
          )}

          {/* ── Preview step ── */}
          {(step === 'preview' || step === 'saving') && parsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── Prospect: company + deal linking ── */}
              {isProspectMode && (
                <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Company</div>

                  {/* Company name + deal picker */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Company Name</label>
                      <input
                        value={companyName}
                        onChange={e => { setCompanyName(e.target.value); setLinkedDealId(''); }}
                        placeholder="e.g. Acme Corp"
                        style={{ width: '100%', fontSize: 13, fontWeight: 700, padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Link to Deal</label>
                      <select
                        value={linkedDealId}
                        onChange={e => {
                          setLinkedDealId(e.target.value);
                          if (e.target.value) {
                            const d = allDeals.find(d => d.id === e.target.value);
                            if (d) setCompanyName(d.company_name);
                          }
                        }}
                        style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                      >
                        <option value="">✦ New prospect</option>
                        {allDeals.map(d => (
                          <option key={d.id} value={d.id}>{d.company_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Contact info */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Contact Name</label>
                      <input
                        value={contactName}
                        onChange={e => setContactName(e.target.value)}
                        placeholder="First Last"
                        style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Contact Email</label>
                      <input
                        value={contactEmail}
                        onChange={e => setContactEmail(e.target.value)}
                        placeholder="email@company.com"
                        style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                      />
                    </div>
                  </div>

                  {/* New prospect badge */}
                  {!linkedDealId && companyName && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                      A new deal card will be created for <strong>{companyName}</strong>
                    </div>
                  )}
                  {linkedDealId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#059669', fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                      Meeting will be added to the existing deal
                    </div>
                  )}
                </div>
              )}

              {/* Meeting meta */}
              <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{parsed.title}</div>
                {parsed.meeting_date && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8 }}>
                    {new Date(parsed.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
                {parsed.summary && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{parsed.summary}</div>
                )}
              </div>

              {/* Action items */}
              {items.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '24px 0' }}>
                  No action items found in this transcript.<br />
                  <span style={{ fontSize: 11 }}>The meeting summary will still be saved.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Action items ({items.filter(i => i.selected).length} of {items.length} selected)
                  </div>
                  {items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 14px', background: it.selected ? 'var(--surface)' : 'transparent', border: `1px solid ${it.selected ? 'var(--border)' : 'var(--border-light)'}`, borderRadius: 8, opacity: it.selected ? 1 : 0.45, transition: 'all .15s' }}>

                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={it.selected}
                        onChange={e => updateItem(i, { selected: e.target.checked })}
                        style={{ marginTop: 3, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />

                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* Task title */}
                        <input
                          value={it.title}
                          onChange={e => updateItem(i, { title: e.target.value })}
                          disabled={!it.selected}
                          style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'none', border: 'none', outline: 'none', padding: 0, width: '100%' }}
                        />

                        {it.notes && (
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>{it.notes}</div>
                        )}

                        {/* Milestone + Owner + Due date row */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>

                          {/* Milestone picker — project mode only */}
                          {!isDealMode && !isProspectMode && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Milestone</label>
                              <select
                                value={it.milestoneId}
                                onChange={e => updateItem(i, { milestoneId: e.target.value })}
                                disabled={!it.selected}
                                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                              >
                                <option value="">— No milestone —</option>
                                {milestones.map(ms => (
                                  <option key={ms.id} value={ms.id}>{ms.title}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Owner picker */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Owner</label>
                            <select
                              value={it.owner}
                              onChange={e => updateItem(i, { owner: e.target.value })}
                              disabled={!it.selected}
                              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                            >
                              <option value="">— Unassigned —</option>
                              {owners.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>

                          {/* Due date */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Due date</label>
                            <input
                              type="date"
                              value={it.due_date || ''}
                              onChange={e => updateItem(i, { due_date: e.target.value || null })}
                              disabled={!it.selected}
                              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                            />
                          </div>

                          {/* Estimated hours — project mode only */}
                          {!isDealMode && !isProspectMode && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Hrs</label>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={it.estimated_hours}
                                onChange={e => updateItem(i, { estimated_hours: e.target.value })}
                                disabled={!it.selected}
                                placeholder="—"
                                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 64 }}
                              />
                            </div>
                          )}

                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>{error}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end', flexShrink: 0, borderTop: '1px solid var(--border-light)', paddingTop: 16 }}>
          {step === 'paste' && (
            <>
              <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleParse} disabled={!transcript.trim()} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: transcript.trim() ? 'pointer' : 'default', opacity: transcript.trim() ? 1 : 0.5 }}>Analyze transcript →</button>
            </>
          )}
          {step === 'parsing' && (
            <div style={{ fontSize: 13, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Extracting tasks…
            </div>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('paste'); setError(''); }} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>← Back</button>
              <button
                onClick={handleSave}
                disabled={isProspectMode && !companyName.trim()}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (!isProspectMode || companyName.trim()) ? 'pointer' : 'default', opacity: (!isProspectMode || companyName.trim()) ? 1 : 0.5 }}
              >
                {items.filter(i => i.selected).length > 0
                  ? `Save meeting + ${items.filter(i => i.selected).length} task${items.filter(i => i.selected).length !== 1 ? 's' : ''}`
                  : 'Save meeting'}
              </button>
            </>
          )}
          {step === 'saving' && (
            <div style={{ fontSize: 13, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Saving…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
