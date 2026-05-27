import { useState, useEffect } from 'react';
import { saveIcp, loadTeamEmails, saveTeamEmails } from '../lib/settings';
import { OWNERS } from '../lib/projects';
import { supabase } from '../lib/supabase';

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

export default function SettingsPage({ icp, onIcpSaved }) {
  const [draft, setDraft]           = useState({ ...icp });
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  // Team emails state
  const [teamEmails, setTeamEmails]     = useState({});
  const [emailSaving, setEmailSaving]   = useState(false);
  const [emailSaved, setEmailSaved]     = useState(false);
  const [testOwner, setTestOwner]       = useState(OWNERS[0]);
  const [testStatus, setTestStatus]     = useState(''); // '', 'sending', 'ok', 'error'
  const [testMsg, setTestMsg]           = useState('');

  useEffect(() => {
    loadTeamEmails().then(setTeamEmails);
  }, []);

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
      import('../lib/settings').then(({ DEFAULT_ICP }) => {
        setDraft({ ...DEFAULT_ICP });
      });
    }
  };

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
      // Get session token to call edge function
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/weekly-task-digest?owner=${encodeURIComponent(testOwner)}`,
        { method: 'POST', headers }
      );
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

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>⚙️ ICP Settings</h2>
          <p>Edit your Ideal Customer Profile. Changes apply to all future scans and email drafts.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleReset}>↺ Reset to defaults</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : saved ? '✅ Saved!' : '💾 Save Settings'}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          <span>ℹ️</span>
          <span>Settings are shared — changes here affect both Mike and Pete's scans and drafts.</span>
        </div>

        <div className="card" style={{ padding: '20px 24px' }}>
          {FIELD_META.map(f => (
            <div key={f.key} className="form-row" style={{ marginBottom: 20 }}>
              <label style={{ fontWeight: 700, marginBottom: 4 }}>{f.label}</label>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{f.hint}</p>
              <textarea
                rows={f.rows}
                value={draft[f.key] || ''}
                onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, marginBottom: 32 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : saved ? '✅ Saved!' : '💾 Save Settings'}
          </button>
        </div>

        {/* ── Weekly Task Digest ──────────────────────────────────────── */}
        <div className="card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>📬 Weekly Task Digest</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Every Monday at 9 AM each person receives an email with their incomplete tasks due that week.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleSaveEmails}
              disabled={emailSaving}
              style={{ flexShrink: 0 }}
            >
              {emailSaving ? <><span className="spinner" /> Saving…</> : emailSaved ? '✅ Saved!' : '💾 Save Emails'}
            </button>
          </div>

          {/* Email inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            {OWNERS.map(owner => (
              <div key={owner} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 56, fontSize: 13, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                  {owner}
                </div>
                <input
                  type="email"
                  value={teamEmails[owner] || ''}
                  onChange={e => setTeamEmails(prev => ({ ...prev, [owner]: e.target.value }))}
                  placeholder={`${owner.toLowerCase()}@yourcompany.com`}
                  style={{ flex: 1, maxWidth: 320, fontSize: 13, padding: '6px 10px' }}
                />
              </div>
            ))}
          </div>

          {/* Test send */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Test send:</span>
            <select
              value={testOwner}
              onChange={e => setTestOwner(e.target.value)}
              style={{ fontSize: 13, padding: '5px 8px', width: 'auto' }}
            >
              {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <button
              className="btn"
              onClick={handleTestSend}
              disabled={testStatus === 'sending'}
              style={{ fontSize: 13 }}
            >
              {testStatus === 'sending' ? <><span className="spinner" /> Sending…</> : '📤 Send Test Now'}
            </button>
            {testMsg && (
              <span style={{ fontSize: 13, color: testStatus === 'ok' ? '#16a34a' : testStatus === 'error' ? '#dc2626' : 'var(--text-muted)' }}>
                {testMsg}
              </span>
            )}
          </div>

          {/* Setup instructions */}
          <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 10 }}>
              One-time setup required
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
            <pre style={{ margin: '12px 0 0', padding: '10px 14px', background: 'var(--bg)', borderRadius: 6, fontSize: 12, color: 'var(--text)', overflow: 'auto', lineHeight: 1.6, border: '1px solid var(--border-light)' }}>{`select cron.schedule(
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
      </div>
    </>
  );
}
