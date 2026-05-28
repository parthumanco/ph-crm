import { useState, useEffect } from 'react';
import { saveIcp, loadTeamEmails, saveTeamEmails, saveTeamMembers } from '../lib/settings';
import { supabase } from '../lib/supabase';

// ── ICP field definitions ─────────────────────────────────────────────────────
const FIELD_META = [
  {
    key: 'aboutCompany',
    label: 'About Part Human',
    hint: 'Who you are, what you sell, your entry product.',
    rows: 4,
  },
  {
    key: 'icpCriteria',
    label: 'Ideal Customer Profile',
    hint: 'Revenue range, employee count, stage, pain points, best triggers.',
    rows: 5,
  },
  {
    key: 'icpScoring',
    label: 'ICP Scoring Guide (1–10)',
    hint: 'What earns a 9–10 vs 7–8 vs 5–6 etc. Used by every scan.',
    rows: 5,
  },
  {
    key: 'icpTiers',
    label: 'ICP Tiers',
    hint: 'Named segments (e.g. "Ambitious Scale-Up"). Each scan assigns a tier.',
    rows: 4,
  },
  {
    key: 'outreachVoice',
    label: 'Outreach Voice',
    hint: 'Tone and style rules applied to every generated email.',
    rows: 3,
  },
  {
    key: 'emailSignature',
    label: 'Email Signature',
    hint: 'Appended automatically when opening Gmail. Include your name, title, and any links.',
    rows: 4,
  },
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// ── Section header component ──────────────────────────────────────────────────
function SectionHeader({ title, description, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', marginBottom: 6,
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {title}
          </h3>
          {description && (
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {description}
            </p>
          )}
        </div>
        {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>{children}</div>}
      </div>
      <div style={{ height: 2, background: 'var(--border)', borderRadius: 1, marginTop: 12 }} />
    </div>
  );
}

// ── Section divider (between sections) ───────────────────────────────────────
function SectionDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '40px 0' }} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SettingsPage({ icp, onIcpSaved, teamMembers = [], onTeamMembersSaved }) {

  // ICP state
  const [draft, setDraft]   = useState({ ...icp });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // Team members / billing rates state
  const [memberDraft, setMemberDraft]         = useState(teamMembers);
  const [memberSaving, setMemberSaving]       = useState(false);
  const [memberSaved, setMemberSaved]         = useState(false);
  const [newMemberName, setNewMemberName]     = useState('');
  const [newMemberRole, setNewMemberRole]     = useState('');
  const [newMemberRate, setNewMemberRate]     = useState('');
  const [newMemberCostRate, setNewMemberCostRate] = useState('');

  // Team emails state
  const [teamEmails, setTeamEmails]   = useState({});
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved]   = useState(false);
  const [testOwner, setTestOwner]     = useState('');
  const [testStatus, setTestStatus]   = useState('');
  const [testMsg, setTestMsg]         = useState('');

  // Keep member draft in sync if parent reloads
  useEffect(() => { setMemberDraft(teamMembers); }, [teamMembers]);
  useEffect(() => {
    if (teamMembers.length && !testOwner) setTestOwner(teamMembers[0].name);
  }, [teamMembers]);

  useEffect(() => { loadTeamEmails().then(setTeamEmails); }, []);

  // ── ICP handlers ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveIcp(draft);
      onIcpSaved(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset all ICP settings to defaults?')) {
      import('../lib/settings').then(({ DEFAULT_ICP }) => setDraft({ ...DEFAULT_ICP }));
    }
  };

  // ── Team member handlers ─────────────────────────────────────────────────────
  const handleSaveMembers = async () => {
    setMemberSaving(true);
    try {
      const cleaned = memberDraft.map(m => ({
        name: m.name.trim(),
        role: m.role?.trim() || '',
        hourlyRate: parseFloat(m.hourlyRate) || 0,
        costRate: parseFloat(m.costRate) || 0,
      })).filter(m => m.name);
      await saveTeamMembers(cleaned);
      onTeamMembersSaved?.(cleaned);
      setMemberSaved(true);
      setTimeout(() => setMemberSaved(false), 2500);
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setMemberSaving(false);
    }
  };

  const handleAddMember = () => {
    if (!newMemberName.trim()) return;
    setMemberDraft(prev => [...prev, {
      name: newMemberName.trim(),
      role: newMemberRole.trim(),
      hourlyRate: parseFloat(newMemberRate) || 0,
      costRate: parseFloat(newMemberCostRate) || 0,
    }]);
    setNewMemberName(''); setNewMemberRole(''); setNewMemberRate(''); setNewMemberCostRate('');
  };

  const handleRemoveMember = (idx) => setMemberDraft(prev => prev.filter((_, i) => i !== idx));

  // ── Email handlers ───────────────────────────────────────────────────────────
  const handleSaveEmails = async () => {
    setEmailSaving(true);
    try {
      await saveTeamEmails(teamEmails);
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2500);
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setEmailSaving(false);
    }
  };

  const handleTestSend = async () => {
    setTestStatus('sending');
    setTestMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const res  = await fetch(`${SUPABASE_URL}/functions/v1/weekly-task-digest?owner=${encodeURIComponent(testOwner)}`, { method: 'POST', headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unknown error');
      const result = json.results?.[0];
      setTestStatus('ok');
      setTestMsg(result?.skipped
        ? `⚠️ No email configured for ${testOwner}`
        : `✅ Sent to ${result?.email} (${result?.tasks} tasks)`);
    } catch (e) {
      setTestStatus('error');
      setTestMsg(`❌ ${e.message}`);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="page-body">

      {/* ════════════════════════════════════════════════════════════════
          SECTION 1 — AI & Outreach Intelligence
      ════════════════════════════════════════════════════════════════ */}
      <SectionHeader
        title="🤖 AI & Outreach Intelligence"
        description="Controls how the AI scores companies, assigns tiers, and writes outreach emails. Changes apply to all future scans and drafts."
      >
        <button className="btn btn-ghost btn-sm" onClick={handleReset}>↺ Reset defaults</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : saved ? '✅ Saved!' : '💾 Save'}
        </button>
      </SectionHeader>

      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        <span>ℹ️</span>
        <span>These settings are shared — changes here affect both Mike and Pete's scans and drafts.</span>
      </div>

      <div className="card" style={{ padding: '20px 24px' }}>
        {FIELD_META.map((f, idx) => (
          <div key={f.key} style={{ marginBottom: idx < FIELD_META.length - 1 ? 24 : 0 }}>
            <label style={{ fontWeight: 700, marginBottom: 4, display: 'block' }}>{f.label}</label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, marginTop: 0 }}>{f.hint}</p>
            <textarea
              rows={f.rows}
              value={draft[f.key] || ''}
              onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, width: '100%' }}
            />
            {idx < FIELD_META.length - 1 && (
              <div style={{ height: 1, background: 'var(--border-light)', marginTop: 20 }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : saved ? '✅ Saved!' : '💾 Save AI Settings'}
        </button>
      </div>

      <SectionDivider />

      {/* ════════════════════════════════════════════════════════════════
          SECTION 2 — Team & Billing Rates
      ════════════════════════════════════════════════════════════════ */}
      <SectionHeader
        title="👥 Team & Billing Rates"
        description="Team members appear in project task assignment dropdowns. Billing and cost rates power project estimates and profitability forecasts."
      />

      <div className="card" style={{ padding: '20px 24px' }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 88px 88px 36px', gap: 8, marginBottom: 8, padding: '0 4px' }}>
          {[
            { label: 'Name',      hint: null },
            { label: 'Role / Title', hint: null },
            { label: 'Bill $/hr', hint: 'What you charge the client per hour' },
            { label: 'Cost $/hr', hint: 'Fully-loaded internal cost (salary + overhead)' },
            { label: '',          hint: null },
          ].map(({ label, hint }) => (
            <div
              key={label}
              title={hint || undefined}
              style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', cursor: hint ? 'help' : 'default' }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Existing members */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {memberDraft.map((m, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 88px 88px 36px', gap: 8, alignItems: 'center' }}>
              <input type="text"   value={m.name}             onChange={e => setMemberDraft(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value }       : x))} style={{ fontSize: 13, padding: '5px 10px' }} placeholder="Name" />
              <input type="text"   value={m.role || ''}       onChange={e => setMemberDraft(prev => prev.map((x, j) => j === i ? { ...x, role: e.target.value }       : x))} style={{ fontSize: 13, padding: '5px 10px' }} placeholder="e.g. Creative Director" />
              <input type="number" value={m.hourlyRate || ''} onChange={e => setMemberDraft(prev => prev.map((x, j) => j === i ? { ...x, hourlyRate: e.target.value } : x))} style={{ fontSize: 13, padding: '5px 10px' }} min="0" step="5" placeholder="0" />
              <input type="number" value={m.costRate || ''}   onChange={e => setMemberDraft(prev => prev.map((x, j) => j === i ? { ...x, costRate: e.target.value }   : x))} style={{ fontSize: 13, padding: '5px 10px' }} min="0" step="5" placeholder="0" />
              <button onClick={() => handleRemoveMember(i)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, padding: '4px', borderRadius: 4, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>

        {/* Add new member row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 88px 88px 36px', gap: 8, alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
          <input type="text"   value={newMemberName}     onChange={e => setNewMemberName(e.target.value)}     onKeyDown={e => e.key === 'Enter' && handleAddMember()} placeholder="New name…"      style={{ fontSize: 13, padding: '5px 10px' }} />
          <input type="text"   value={newMemberRole}     onChange={e => setNewMemberRole(e.target.value)}     onKeyDown={e => e.key === 'Enter' && handleAddMember()} placeholder="Role (optional)" style={{ fontSize: 13, padding: '5px 10px' }} />
          <input type="number" value={newMemberRate}     onChange={e => setNewMemberRate(e.target.value)}     onKeyDown={e => e.key === 'Enter' && handleAddMember()} placeholder="0" min="0" step="5" style={{ fontSize: 13, padding: '5px 10px' }} />
          <input type="number" value={newMemberCostRate} onChange={e => setNewMemberCostRate(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddMember()} placeholder="0" min="0" step="5" style={{ fontSize: 13, padding: '5px 10px' }} />
          <button
            onClick={handleAddMember}
            disabled={!newMemberName.trim()}
            title="Add member"
            style={{ background: 'var(--accent)', border: 'none', color: '#fff', cursor: newMemberName.trim() ? 'pointer' : 'default', fontSize: 18, padding: '2px', borderRadius: 4, lineHeight: 1, opacity: newMemberName.trim() ? 1 : 0.3 }}
          >+</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={handleSaveMembers} disabled={memberSaving}>
          {memberSaving ? <><span className="spinner" /> Saving…</> : memberSaved ? '✅ Saved!' : '💾 Save Team'}
        </button>
      </div>

      <SectionDivider />

      {/* ════════════════════════════════════════════════════════════════
          SECTION 3 — Notifications
      ════════════════════════════════════════════════════════════════ */}
      <SectionHeader
        title="📬 Notifications"
        description="Every Monday at 9 AM each person receives an email digest of their incomplete tasks due that week."
      >
        <button className="btn btn-primary" onClick={handleSaveEmails} disabled={emailSaving}>
          {emailSaving ? <><span className="spinner" /> Saving…</> : emailSaved ? '✅ Saved!' : '💾 Save Emails'}
        </button>
      </SectionHeader>

      <div className="card" style={{ padding: '20px 24px' }}>
        {/* Email inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {memberDraft.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Add team members in the section above first.
            </p>
          )}
          {memberDraft.map(member => (
            <div key={member.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 64, fontSize: 13, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                {member.name}
              </div>
              <input
                type="email"
                value={teamEmails[member.name] || ''}
                onChange={e => setTeamEmails(prev => ({ ...prev, [member.name]: e.target.value }))}
                placeholder={`${member.name.toLowerCase()}@yourcompany.com`}
                style={{ flex: 1, maxWidth: 320, fontSize: 13, padding: '6px 10px' }}
              />
            </div>
          ))}
        </div>

        {/* Test send */}
        {memberDraft.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Test send:</span>
            <select value={testOwner} onChange={e => setTestOwner(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', width: 'auto' }}>
              {memberDraft.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
            <button className="btn" onClick={handleTestSend} disabled={testStatus === 'sending'} style={{ fontSize: 13 }}>
              {testStatus === 'sending' ? <><span className="spinner" /> Sending…</> : '📤 Send Test Now'}
            </button>
            {testMsg && (
              <span style={{ fontSize: 13, color: testStatus === 'ok' ? '#16a34a' : testStatus === 'error' ? '#dc2626' : 'var(--text-muted)' }}>
                {testMsg}
              </span>
            )}
          </div>
        )}

        {/* Setup instructions */}
        <div style={{ marginTop: 24, padding: '16px 18px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 12 }}>
            One-time setup required
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { n: 1, text: <>Sign up free at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>resend.com</a> and create an API key</> },
              { n: 2, text: <>In <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Supabase Dashboard</a> → Edge Functions → Secrets, add <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>RESEND_API_KEY</code></> },
              { n: 3, text: <>Also add <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>DIGEST_FROM_EMAIL</code> (e.g. <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>hello@yourcompany.com</code>) — must be a verified Resend domain</> },
              { n: 4, text: <>Deploy the function: <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>supabase functions deploy weekly-task-digest</code></> },
              { n: 5, text: <>In Supabase → Database → Extensions, enable <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>pg_cron</code>, then run this SQL:</> },
            ].map(({ n, text }) => (
              <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{n}</div>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{text}</span>
              </div>
            ))}
          </div>
          <pre style={{ margin: '14px 0 0', padding: '10px 14px', background: 'var(--bg)', borderRadius: 6, fontSize: 12, color: 'var(--text)', overflow: 'auto', lineHeight: 1.6, border: '1px solid var(--border-light)' }}>{`select cron.schedule(
  'weekly-task-digest',
  '0 14 * * 1',  -- 9 AM ET (UTC-5) every Monday
  $$
  select net.http_post(
    url := '${SUPABASE_URL}/functions/v1/weekly-task-digest',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);`}</pre>
        </div>
      </div>

      {/* bottom breathing room */}
      <div style={{ height: 48 }} />
    </div>
  );
}
