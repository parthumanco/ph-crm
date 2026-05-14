import { useState, useEffect } from 'react';
import { generateEmailDraft, generateLinkedInDrafts } from '../lib/anthropic';
import { supabase } from '../lib/supabase';

const TOUCH_META = {
  1: { label: 'Touch 1 — Initial Email',    type: 'email',    desc: 'Trigger → pain → human truth → Strategic Sprint CTA' },
  2: { label: 'Touch 2 — Follow-Up Email',  type: 'email',    desc: 'Short reply on same thread, Day 7.' },
  3: { label: 'Touch 3 — LinkedIn',         type: 'linkedin', desc: 'Connection request note + post-acceptance DM, Day 14.' },
  4: { label: 'Touch 4 — Goodwill',         type: 'email',    desc: 'Market insight, no hard ask, Day 21.' },
  5: { label: 'Touch 5 — Close the Loop',   type: 'email',    desc: 'Graceful final note, leave door open, Day 28.' },
};

export default function EmailDraftModal({ entry, company, touchNumber, contacts, existingTouch, onClose, onMarkSent, onSave, t1Subject }) {
  const meta = TOUCH_META[touchNumber] || {};
  const [selectedContact, setSelectedContact] = useState(0);
  const [draft, setDraft]           = useState(null);
  const [generating, setGenerating] = useState(false);
  const [editedBody, setEditedBody] = useState('');
  const [editedSubject, setEditedSubject] = useState('');
  const [copied, setCopied]         = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [angle, setAngle]           = useState(company.recommended_angle || '');

  const contact = contacts[selectedContact] || { name: 'the decision-maker', title: '', email: '' };

  const isSent = existingTouch?.status === 'sent';

  // Load existing saved draft on open (including sent)
  useEffect(() => {
    if (existingTouch?.draft_content) {
      if (existingTouch.touch_type === 'linkedin') {
        const parts = existingTouch.draft_content.split('\n\n---\nPOST-ACCEPTANCE DM:\n');
        const connNote = parts[0]?.replace('CONNECTION NOTE:\n', '') || '';
        const dm = parts[1] || '';
        setDraft({ type: 'linkedin', connection_note: connNote, acceptance_dm: dm });
      } else {
        setDraft({ type: 'email', subject: existingTouch.subject_line || '', body: existingTouch.draft_content });
        setEditedSubject(existingTouch.subject_line || '');
        setEditedBody(existingTouch.draft_content);
      }
    }
  }, [existingTouch]);

  const generate = async () => {
    setGenerating(true);
    try {
      let result;
      if (touchNumber === 3) {
        result = await generateLinkedInDrafts(company, contact);
      } else {
        result = await generateEmailDraft(touchNumber, company, contact, angle, undefined, t1Subject);
      }
      setDraft(result);
      setEditedSubject(result.subject || '');
      setEditedBody(result.body || result.connection_note || '');
    } catch (e) {
      alert('Error generating draft: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const body = touchNumber === 3
        ? `CONNECTION NOTE:\n${draft.connection_note}\n\n---\nPOST-ACCEPTANCE DM:\n${draft.acceptance_dm}`
        : editedBody;
      const subject = touchNumber === 3 ? '' : editedSubject;

      if (existingTouch?.id) {
        await supabase.from('touches').update({
          draft_content: body,
          subject_line: subject,
          contact_name: contact.name,
          contact_title: contact.title,
          status: 'ready',
          updated_at: new Date().toISOString(),
        }).eq('id', existingTouch.id);
      } else {
        await supabase.from('touches').insert({
          pipeline_entry_id: entry.id,
          touch_number: touchNumber,
          touch_type: meta.type || 'email',
          contact_name: contact.name,
          contact_title: contact.title,
          subject_line: subject,
          draft_content: body,
          status: 'ready',
        });
      }
      setSaveConfirmed(true);
      setTimeout(() => setSaveConfirmed(false), 2000);
      onSave?.();
    } catch (e) {
      alert('Error saving: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const markSent = () => {
    onMarkSent({
      id: existingTouch?.id,
      pipeline_entry_id: entry.id,
      touch_number: touchNumber,
      touch_type: meta.type || 'email',
      contact_name: contact.name,
      contact_title: contact.title,
      subject_line: editedSubject,
      draft_content: editedBody,
    });
  };

  const hasDraft = draft && !draft.error;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <div>
            <h3>{meta.label} — {company.name}</h3>
            <p>{meta.desc}{existingTouch?.status === 'ready' ? ' · Saved draft loaded' : ''}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {contacts.length > 1 && (
            <div className="form-row">
              <label>Contact</label>
              <select value={selectedContact} onChange={e => { setSelectedContact(Number(e.target.value)); setDraft(null); }}>
                {contacts.map((c, i) => (
                  <option key={i} value={i}>{c.name}{c.title ? ` — ${c.title}` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {touchNumber === 1 && (
            <div className="form-row">
              <label>Outreach Angle (edit if needed)</label>
              <textarea rows={2} value={angle} onChange={e => setAngle(e.target.value)} placeholder="e.g. You just raised your Series B. Your product is ahead of your brand." />
            </div>
          )}

          {isSent && (
            <div className="alert alert-success" style={{ marginBottom: 12 }}>
              <span>✅</span>
              <span><strong>Sent{existingTouch?.sent_date ? ` on ${existingTouch.sent_date}` : ''}</strong> — this touch is locked for reference.</span>
            </div>
          )}

          {!isSent && (
            <button className="btn btn-primary" onClick={generate} disabled={generating} style={{ marginBottom: 16 }}>
              {generating ? <><span className="spinner" /> Generating…</> : hasDraft ? '🔄 Regenerate' : '✨ Generate Draft'}
            </button>
          )}

          {hasDraft && (
            <>
              {touchNumber === 3 ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ marginBottom: 0 }}>Connection Request Note (300 char max)</label>
                      <button className="btn btn-ghost btn-xs" onClick={() => copyToClipboard(draft.connection_note)}>
                        {copied ? '✅ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={draft.connection_note}
                      onChange={e => !isSent && setDraft(d => ({ ...d, connection_note: e.target.value }))}
                      readOnly={isSent}
                      style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, background: isSent ? 'var(--surface)' : undefined }}
                    />
                    <p style={{ fontSize: 11, color: (draft.connection_note || '').length > 300 ? 'var(--red)' : 'var(--text-muted)', marginTop: 4 }}>
                      {(draft.connection_note || '').length} / 300 characters
                    </p>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ marginBottom: 0 }}>Post-Acceptance DM</label>
                      <button className="btn btn-ghost btn-xs" onClick={() => copyToClipboard(draft.acceptance_dm)}>📋 Copy DM</button>
                    </div>
                    <textarea
                      rows={5}
                      value={draft.acceptance_dm}
                      onChange={e => !isSent && setDraft(d => ({ ...d, acceptance_dm: e.target.value }))}
                      readOnly={isSent}
                      style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, background: isSent ? 'var(--surface)' : undefined }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="form-row">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ marginBottom: 0 }}>Subject Line</label>
                    </div>
                    <input type="text" value={editedSubject} onChange={e => !isSent && setEditedSubject(e.target.value)} readOnly={isSent} style={{ fontWeight: 600, background: isSent ? 'var(--surface)' : undefined }} />
                  </div>
                  <div className="form-row">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ marginBottom: 0 }}>Email Body</label>
                      <button className="btn btn-ghost btn-xs" onClick={() => copyToClipboard(`Subject: ${editedSubject}\n\n${editedBody}`)}>
                        {copied ? '✅ Copied!' : '📋 Copy to Clipboard'}
                      </button>
                    </div>
                    <textarea
                      rows={14}
                      value={editedBody}
                      onChange={e => !isSent && setEditedBody(e.target.value)}
                      readOnly={isSent}
                      style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, background: isSent ? 'var(--surface)' : undefined }}
                    />
                  </div>
                </>
              )}

              <div className="alert alert-info" style={{ marginTop: 8 }}>
                <span>📌</span>
                <span>
                  <strong>To:</strong> {contact.name}{contact.title ? `, ${contact.title}` : ''}
                  {contact.email ? ` · ${contact.email}` : ''}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {hasDraft && !isSent && (
            <button className="btn btn-secondary" onClick={saveDraft} disabled={saving}>
              {saving ? 'Saving…' : saveConfirmed ? '✅ Saved!' : '💾 Save Draft'}
            </button>
          )}
          {hasDraft && !isSent && (
            <button className="btn btn-green" onClick={markSent}>✅ Mark as Sent</button>
          )}
          {isSent && (
            <button className="btn btn-secondary" onClick={async () => {
              if (!existingTouch?.id) return;
              await supabase.from('touches').update({ status: 'ready', sent_date: null, updated_at: new Date().toISOString() }).eq('id', existingTouch.id);
              // Roll back pipeline touch counter if needed
              const entry2 = entry;
              if (entry2 && touchNumber >= entry2.current_touch) {
                await supabase.from('pipeline_entries').update({ current_touch: Math.max(touchNumber - 1, 0), updated_at: new Date().toISOString() }).eq('id', entry2.id);
              }
              onSave?.();
              onClose();
            }}>
              ↩ Undo Sent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
