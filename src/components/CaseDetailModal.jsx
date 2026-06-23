import { useState, useEffect, useRef } from 'react';
import {
  upsertCase, deleteCase, fetchMessages, addMessage,
  CASE_STATUSES, CASE_PRIORITIES, CHANNELS,
  statusColor, priorityColor, channelIcon, slaSummary,
} from '../lib/support';
import { fetchDeals } from '../lib/deals';

const FALLBACK_OWNERS = ['Mike', 'Pete', 'Jill'];

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 4 }}>
      {children}
    </div>
  );
}

export default function CaseDetailModal({ case_, owners: ownersProp, onClose, onSaved }) {
  const owners = ownersProp?.length ? ownersProp : FALLBACK_OWNERS;
  const isNew = !case_.id;
  const [form, setForm]             = useState({ ...case_ });
  const [messages, setMessages]     = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(!isNew);
  const [wonDeals, setWonDeals]     = useState([]);
  const [saving, setSaving]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [msgForm, setMsgForm]       = useState({
    direction: 'inbound', channel: case_.channel || 'email', content: '', author: 'Mike',
  });
  const [sendingMsg, setSendingMsg] = useState(false);
  const threadRef = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!isNew && case_.id) {
      fetchMessages(case_.id)
        .then(setMessages)
        .finally(() => setLoadingMsgs(false));
    }
    fetchDeals().then(d => setWonDeals(d.filter(deal => deal.stage === 'won')));
  }, [case_.id, isNew]);

  // Auto-scroll thread to bottom
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const handleSave = async () => {
    if (!form.title?.trim()) return;
    setSaving(true);
    try {
      const saved = await upsertCase(form);
      onSaved(saved);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteCase(case_.id);
      onSaved(null);
    } catch (e) {
      console.error(e);
      setDeleting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!msgForm.content.trim() || !case_.id) return;
    setSendingMsg(true);
    try {
      await addMessage({ ...msgForm, case_id: case_.id });
      const msgs = await fetchMessages(case_.id);
      setMessages(msgs);
      setMsgForm(f => ({ ...f, content: '' }));
    } catch (e) {
      console.error(e);
    } finally {
      setSendingMsg(false);
    }
  };

  const handleCompanyPick = (e) => {
    const deal = wonDeals.find(d => d.id === e.target.value);
    if (!deal) return;
    set('company_name', deal.company_name || '');
    set('contact_name', deal.contact_name || '');
    set('contact_email', deal.contact_email || '');
  };

  const sla      = form.due_at ? slaSummary(form.due_at, form.resolved_at) : null;
  const slaColor = !sla ? '#6b7280'
    : sla.status === 'overdue'  ? '#ef4444'
    : sla.status === 'critical' ? '#ef4444'
    : sla.status === 'warning'  ? '#f59e0b'
    : '#10b981';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 800, display: 'flex', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: 640, maxWidth: '100vw',
        background: 'var(--bg)',
        boxShadow: '-6px 0 32px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
        height: '100%',
      }}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{
          padding: '18px 24px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Badges row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {!isNew && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', fontFamily: 'monospace', marginRight: 4 }}>
                    #{String(case_.case_number).padStart(4, '0')}
                  </span>
                )}

                {/* Status select */}
                <select
                  value={form.status}
                  onChange={e => set('status', e.target.value)}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    border: `1px solid ${statusColor(form.status)}50`,
                    background: `${statusColor(form.status)}18`,
                    color: statusColor(form.status), cursor: 'pointer',
                  }}
                >
                  {CASE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>

                {/* Priority select */}
                <select
                  value={form.priority}
                  onChange={e => set('priority', e.target.value)}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    border: `1px solid ${priorityColor(form.priority)}50`,
                    background: `${priorityColor(form.priority)}18`,
                    color: priorityColor(form.priority), cursor: 'pointer',
                  }}
                >
                  {CASE_PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>

                {/* SLA */}
                {sla && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: slaColor, marginLeft: 'auto' }}>
                    {sla.status === 'overdue' ? '⚠️ ' : '⏱ '}{sla.label}
                  </span>
                )}
              </div>

              {/* Title */}
              <input
                type="text"
                value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="Case subject…"
                style={{
                  fontSize: 16, fontWeight: 800, color: 'var(--text)',
                  border: 'none', outline: 'none', background: 'transparent',
                  width: '100%', padding: 0,
                }}
              />
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, marginTop: -2 }}
            >✕</button>
          </div>
        </div>

        {/* ── Scrollable body ───────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Fields */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Client prefill (new cases only) */}
            {isNew && wonDeals.length > 0 && (
              <div>
                <Label>Fill from client</Label>
                <select onChange={handleCompanyPick} defaultValue="" style={{ width: '100%' }}>
                  <option value="">Select a client to pre-fill…</option>
                  {wonDeals.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.company_name}{d.contact_name ? ` — ${d.contact_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 2-col grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <Label>Company</Label>
                <input type="text" value={form.company_name || ''} onChange={e => set('company_name', e.target.value)} placeholder="Company name" />
              </div>
              <div>
                <Label>Contact</Label>
                <input type="text" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} placeholder="Contact name" />
              </div>
              <div>
                <Label>Email</Label>
                <input type="email" value={form.contact_email || ''} onChange={e => set('contact_email', e.target.value)} placeholder="contact@company.com" />
              </div>
              <div>
                <Label>Assigned to</Label>
                <select value={form.assigned_to || ''} onChange={e => set('assigned_to', e.target.value)}>
                  <option value="">Unassigned</option>
                  {owners.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <Label>Channel</Label>
                <select value={form.channel || 'email'} onChange={e => set('channel', e.target.value)}>
                  {CHANNELS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              {!isNew && form.due_at && (
                <div>
                  <Label>SLA due by</Label>
                  <div style={{ fontSize: 13, fontWeight: 600, color: slaColor, padding: '7px 0' }}>
                    {new Date(form.due_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <Label>Description</Label>
              <textarea
                value={form.description || ''}
                onChange={e => set('description', e.target.value)}
                placeholder="Describe the issue…"
                rows={3}
                style={{ minHeight: 'unset' }}
              />
            </div>

            {/* Internal notes */}
            <div>
              <Label>Internal notes</Label>
              <textarea
                value={form.notes || ''}
                onChange={e => set('notes', e.target.value)}
                placeholder="Not visible to the client…"
                rows={2}
                style={{ minHeight: 'unset' }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.title?.trim()}
              >
                {saving ? 'Saving…' : isNew ? 'Create Case' : 'Save Changes'}
              </button>
              {!isNew && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: confirmDelete ? '#ef4444' : 'var(--surface-2)',
                    color: confirmDelete ? '#fff' : '#ef4444',
                    fontWeight: 700, fontSize: 12, transition: 'all .15s',
                  }}
                >
                  {deleting ? 'Deleting…' : confirmDelete ? 'Confirm delete' : 'Delete case'}
                </button>
              )}
            </div>
          </div>

          {/* ── Communication thread ──────────────────────────────────── */}
          {!isNew && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '14px 24px 10px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)' }}>
                  Communication Thread
                </span>
              </div>

              {/* Messages */}
              <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {loadingMsgs ? (
                  <div className="spinner" style={{ margin: '24px auto' }} />
                ) : messages.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', paddingTop: 20 }}>
                    No messages yet. Log the first interaction below.
                  </p>
                ) : messages.map(msg => {
                  const isOut = msg.direction === 'outbound';
                  return (
                    <div key={msg.id} style={{ display: 'flex', gap: 10, flexDirection: isOut ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
                      {/* Avatar */}
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                        background: isOut ? 'var(--accent)' : 'var(--surface-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800,
                        color: isOut ? '#fff' : 'var(--text-muted)',
                      }}>
                        {(msg.author || '?').slice(0, 1).toUpperCase()}
                      </div>
                      {/* Bubble */}
                      <div style={{ maxWidth: '74%' }}>
                        <div style={{
                          fontSize: 13, lineHeight: 1.55, padding: '9px 14px',
                          background: isOut ? 'var(--accent)' : 'var(--surface)',
                          color: isOut ? '#fff' : 'var(--text)',
                          border: isOut ? 'none' : '1px solid var(--border)',
                          borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          whiteSpace: 'pre-wrap',
                        }}>
                          {msg.content}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 3, textAlign: isOut ? 'right' : 'left' }}>
                          {channelIcon(msg.channel)} {msg.author} · {fmtDate(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Log message form */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 24px 20px', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select
                    value={msgForm.direction}
                    onChange={e => setMsgForm(f => ({ ...f, direction: e.target.value }))}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    <option value="inbound">← Inbound</option>
                    <option value="outbound">→ Outbound</option>
                  </select>
                  <select
                    value={msgForm.channel}
                    onChange={e => setMsgForm(f => ({ ...f, channel: e.target.value }))}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    {CHANNELS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                  </select>
                  <select
                    value={msgForm.author}
                    onChange={e => setMsgForm(f => ({ ...f, author: e.target.value }))}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    {owners.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <textarea
                    value={msgForm.content}
                    onChange={e => setMsgForm(f => ({ ...f, content: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage(); }}
                    placeholder="Log a message, call notes, or update… (⌘↵ to log)"
                    rows={2}
                    style={{ flex: 1, resize: 'none', minHeight: 'unset', fontSize: 13 }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleSendMessage}
                    disabled={sendingMsg || !msgForm.content.trim()}
                    style={{ alignSelf: 'flex-end' }}
                  >
                    {sendingMsg ? '…' : 'Log'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
