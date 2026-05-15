import { useState } from 'react';
import { saveIcp } from '../lib/settings';

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

export default function SettingsPage({ icp, onIcpSaved }) {
  const [draft, setDraft]     = useState({ ...icp });
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

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

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner" /> Saving…</> : saved ? '✅ Saved!' : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </>
  );
}
