import { useState, useEffect, useRef } from 'react';
import { saveIcp, loadTeamEmails, saveTeamEmails, saveTeamMembers, DEFAULT_BRAND_BRAIN, loadBrandBrain, saveBrandBrain } from '../lib/settings';
import { invalidateBrandCache } from '../lib/anthropic';
import { supabase } from '../lib/supabase';
import { loadGranolaApiKey, saveGranolaApiKey, testGranolaConnection } from '../lib/granola';

// ── Reference document helpers ────────────────────────────────────────────────
async function loadRefDocs() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'reference_docs').single();
  return data?.value || [];
}
async function saveRefDocs(docs) {
  await supabase.from('app_settings').upsert({ key: 'reference_docs', value: docs }, { onConflict: 'key' });
}
async function uploadRefDoc(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `reference-docs/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('project-files').upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  const { data: { publicUrl } } = supabase.storage.from('project-files').getPublicUrl(path);
  return { name: file.name, url: publicUrl, path, size: file.size, uploaded_at: new Date().toISOString() };
}
async function deleteRefDoc(doc) {
  await supabase.storage.from('project-files').remove([doc.path]);
}
function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Brand Brain field definitions ─────────────────────────────────────────────
const BRAND_FIELDS = [
  {
    key: 'studioOverview',
    label: 'Studio Overview',
    hint: 'Who Part Human is — used as context in every AI call. Keep it current.',
    rows: 5,
  },
  {
    key: 'brandVoice',
    label: 'Brand Voice & Tone',
    hint: 'How we write and sound. Rules applied to all outreach emails, thesis copy, and AI drafts.',
    rows: 5,
  },
  {
    key: 'corePhilosophy',
    label: 'Core Philosophy & Positioning',
    hint: 'Key beliefs, taglines, and foundational statements. Shapes how the AI frames our value.',
    rows: 7,
  },
  {
    key: 'services',
    label: 'Services We Offer',
    hint: 'Full service list with brief descriptions. Referenced when recommending angles and next steps.',
    rows: 6,
  },
  {
    key: 'clientSegments',
    label: 'Client Segments',
    hint: 'How we describe the types of clients we work with. Used to match prospects to our language.',
    rows: 5,
  },
  {
    key: 'messagingRules',
    label: 'Messaging Rules',
    hint: "Do's and don'ts applied to all outreach and AI-generated content.",
    rows: 7,
  },
  {
    key: 'proofPoints',
    label: 'Key Work & Proof Points',
    hint: 'Client names and brief project descriptions. Used when the AI needs credibility anchors.',
    rows: 5,
  },
];

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

  // Brand Brain state
  const [brainDraft, setBrainDraft]   = useState({ ...DEFAULT_BRAND_BRAIN });
  const [brainSaving, setBrainSaving] = useState(false);
  const [brainSaved, setBrainSaved]   = useState(false);

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

  // Granola integration state
  const [granolaKey, setGranolaKey]       = useState('');
  const [granolaKeyDraft, setGranolaKeyDraft] = useState('');
  const [granolaSaving, setGranolaSaving] = useState(false);
  const [granolaSaved, setGranolaSaved]   = useState(false);
  const [granolaTesting, setGranolaTesting] = useState(false);
  const [granolaTestResult, setGranolaTestResult] = useState(null); // { ok, message } | null
  const [showGranolaKey, setShowGranolaKey] = useState(false);

  // Forecast PIN
  const [forecastPin, setForecastPin]         = useState('');
  const [forecastPinDraft, setForecastPinDraft] = useState('');
  const [forecastPinSaving, setForecastPinSaving] = useState(false);
  const [forecastPinSaved, setForecastPinSaved]   = useState(false);

  // Reference documents (uploaded files + external links)
  const [refDocs, setRefDocs]         = useState([]);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState('');
  const [deletingDoc, setDeletingDoc] = useState(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [refDocTab, setRefDocTab]     = useState('files'); // 'files' | 'links'
  const [linkDraftUrl, setLinkDraftUrl]   = useState('');
  const [linkDraftName, setLinkDraftName] = useState('');
  const refDocInputRef                = useRef(null);

  // Load brand brain on mount
  useEffect(() => { loadBrandBrain().then(b => setBrainDraft({ ...DEFAULT_BRAND_BRAIN, ...b })); }, []);

  // Keep member draft in sync if parent reloads
  useEffect(() => { setMemberDraft(teamMembers); }, [teamMembers]);
  useEffect(() => {
    if (teamMembers.length && !testOwner) setTestOwner(teamMembers[0].name);
  }, [teamMembers]);

  useEffect(() => { loadTeamEmails().then(setTeamEmails); }, []);
  useEffect(() => { loadRefDocs().then(setRefDocs); }, []);
  useEffect(() => {
    loadGranolaApiKey().then(k => { setGranolaKey(k); setGranolaKeyDraft(k); });
  }, []);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'forecast_pin').single()
      .then(({ data }) => { const p = data?.value || ''; setForecastPin(p); setForecastPinDraft(p); });
  }, []);

  // ── Brand Brain handlers ─────────────────────────────────────────────────────
  const handleSaveBrain = async () => {
    setBrainSaving(true);
    try {
      await saveBrandBrain(brainDraft);
      invalidateBrandCache(); // next AI call will pick up the new values
      setBrainSaved(true);
      setTimeout(() => setBrainSaved(false), 2500);
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setBrainSaving(false);
    }
  };

  const handleResetBrain = () => {
    if (window.confirm('Reset Brand Voice to defaults?')) setBrainDraft({ ...DEFAULT_BRAND_BRAIN });
  };

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
      const draft = newMemberName.trim()
        ? [...memberDraft, { name: newMemberName.trim(), role: newMemberRole.trim(), hourlyRate: parseFloat(newMemberRate) || 0, costRate: parseFloat(newMemberCostRate) || 0 }]
        : memberDraft;
      if (newMemberName.trim()) {
        setMemberDraft(draft);
        setNewMemberName(''); setNewMemberRole(''); setNewMemberRate(''); setNewMemberCostRate('');
      }
      const cleaned = draft.map(m => ({
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
          SECTION 0 — Brand Voice & Positioning
      ════════════════════════════════════════════════════════════════ */}
      <SectionHeader
        title="🧠 Brand Voice & Positioning"
        description="The Part Human brand brain — injected into every AI call across the app. Shapes how the AI writes outreach, scores companies, builds theses, and recommends next steps. Keep it current and honest."
      >
        <button className="btn btn-ghost btn-sm" onClick={handleResetBrain}>↺ Reset defaults</button>
        <button className="btn btn-primary" onClick={handleSaveBrain} disabled={brainSaving}>
          {brainSaving ? <><span className="spinner" /> Saving…</> : brainSaved ? '✅ Saved!' : '💾 Save'}
        </button>
      </SectionHeader>

      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        <span>🧠</span>
        <span>This context is passed to every AI scan, thesis build, email draft, and outreach suggestion. The more accurate and specific it is, the better the AI performs on your behalf.</span>
      </div>

      <div className="card" style={{ padding: '20px 24px' }}>
        {BRAND_FIELDS.map((f, idx) => (
          <div key={f.key} style={{ marginBottom: idx < BRAND_FIELDS.length - 1 ? 28 : 0 }}>
            <label style={{ fontWeight: 700, marginBottom: 4, display: 'block', fontSize: 14 }}>{f.label}</label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, marginTop: 0, lineHeight: 1.5 }}>{f.hint}</p>
            <textarea
              rows={f.rows}
              value={brainDraft[f.key] || ''}
              onChange={e => setBrainDraft(d => ({ ...d, [f.key]: e.target.value }))}
              style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, width: '100%' }}
            />
            {idx < BRAND_FIELDS.length - 1 && (
              <div style={{ height: 1, background: 'var(--border-light)', marginTop: 22 }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={handleSaveBrain} disabled={brainSaving}>
          {brainSaving ? <><span className="spinner" /> Saving…</> : brainSaved ? '✅ Saved!' : '💾 Save Brand Voice'}
        </button>
      </div>

      <SectionDivider />

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

      <SectionDivider />

      {/* ════════════════════════════════════════════════════════════════
          SECTION 4 — Sales Methodology
      ════════════════════════════════════════════════════════════════ */}
      <SectionHeader
        title="📖 Sales Methodology"
        description="The Dan Allard 5-touch outreach framework this program is built on. Reference this when writing emails or coaching the cadence."
      />

      {/* Touch cadence cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          {
            num: 1, day: 'Day 0', channel: 'Email',
            label: 'Cold outreach',
            desc: 'Lead with the specific trigger event. 4 paragraphs: Trigger → Brand gap → Human cost → Low-pressure CTA for a Sprint call.',
            color: '#3b82f6',
          },
          {
            num: 2, day: 'Day 7', channel: 'Email',
            label: 'Follow-up',
            desc: 'Reply on the same thread. 3–4 sentences. Soft nudge only — no new pitch. Keep it brief.',
            color: '#8b5cf6',
          },
          {
            num: 3, day: 'Day 14', channel: 'LinkedIn',
            label: 'Connect + DM',
            desc: 'Connection request (300 chars, no pitch). After acceptance, DM referencing a specific recent post of theirs.',
            color: '#0ea5e9',
          },
          {
            num: 4, day: 'Day 21', channel: 'Email',
            label: 'Goodwill',
            desc: 'Share a relevant market observation or competitor move that genuinely helps them. Zero pitch, zero CTA. Just value.',
            color: '#10b981',
          },
          {
            num: 5, day: 'Day 28', channel: 'Email',
            label: 'Close the loop',
            desc: 'Acknowledge the silence gracefully. No guilt. Leave the door open and promise to check back next quarter.',
            color: '#f59e0b',
          },
        ].map(t => (
          <div key={t.num} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: t.color, color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{t.num}</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', letterSpacing: '.01em' }}>{t.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{t.day} · {t.channel}</div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>{t.desc}</p>
          </div>
        ))}
      </div>

      {/* Key principles */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 12 }}>Core principles</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { icon: '🎯', title: 'Trigger required', body: 'Never reach out cold without a specific, named reason — funding, rebrand, leadership change, expansion, award, etc.' },
            { icon: '🧠', title: 'Specificity wins', body: 'Reference the exact trigger in T1, reference a specific LinkedIn post in T3. Generic outreach gets deleted.' },
            { icon: '🤝', title: 'Relationship over pitch', body: 'T4 adds value with no ask. The goal is to be remembered as someone who brings insight, not just a vendor.' },
            { icon: '🚪', title: 'Graceful exits', body: 'T5 closes the loop with warmth. Silence is fine — next quarter\'s trigger is another entry point.' },
            { icon: '⚡', title: 'Sprint as entry point', body: 'Every touch frames a low-risk, high-value Sprint engagement. Never lead with the full retainer.' },
            { icon: '📊', title: 'Score before you send', body: 'Only T1–T3 companies with a real signal and ICP score 7+ make the weekly send list.' },
          ].map(p => (
            <div key={p.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.4 }}>{p.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{p.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Additional Reference Documents */}
      {(() => {
        const fileDocs = refDocs.filter(d => d.type !== 'link');
        const linkDocs = refDocs.filter(d => d.type === 'link');

        const handleFiles = async (files) => {
          if (!files.length) return;
          setUploading(true);
          setUploadErr('');
          try {
            const uploaded = await Promise.all(files.map(f => uploadRefDoc(f).then(d => ({ ...d, type: 'file' }))));
            const next = [...refDocs, ...uploaded];
            setRefDocs(next);
            await saveRefDocs(next);
          } catch (err) {
            setUploadErr(`Upload failed: ${err.message}`);
          } finally {
            setUploading(false);
          }
        };

        const removeDoc = async (i) => {
          const doc = refDocs[i];
          if (!window.confirm(`Remove "${doc.name}"?`)) return;
          setDeletingDoc(doc.path || doc.url);
          try {
            if (doc.type !== 'link') await deleteRefDoc(doc);
            const next = refDocs.filter((_, j) => j !== i);
            setRefDocs(next);
            await saveRefDocs(next);
          } catch (err) {
            setUploadErr(`Remove failed: ${err.message}`);
          } finally {
            setDeletingDoc(null);
          }
        };

        const docIcon = (doc) => {
          if (doc.type === 'link') return '🔗';
          if (doc.name?.endsWith('.pdf')) return '📄';
          if (doc.name?.match(/\.(ppt|pptx)$/)) return '📊';
          if (doc.name?.match(/\.(doc|docx)$/)) return '📝';
          return '📁';
        };

        return (
          <div className="card" style={{ padding: '16px 20px' }}>
            {/* Header + tabs */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Additional Reference Documents</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Upload files or add links — stored here for permanent reference.</div>
              </div>
              <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                {['files', 'links'].map(tab => (
                  <button key={tab} onClick={() => setRefDocTab(tab)} style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: refDocTab === tab ? 'var(--accent)' : 'transparent', color: refDocTab === tab ? '#fff' : 'var(--text-muted)', transition: 'all .15s' }}>
                    {tab === 'files' ? `📁 Files${fileDocs.length ? ` (${fileDocs.length})` : ''}` : `🔗 Links${linkDocs.length ? ` (${linkDocs.length})` : ''}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Hidden file input */}
            <input ref={refDocInputRef} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg" style={{ display: 'none' }}
              onChange={async e => { await handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
            />

            {uploadErr && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{uploadErr}</div>}

            {/* ── FILES TAB ── */}
            {refDocTab === 'files' && (
              <>
                {/* Uploaded file list */}
                {fileDocs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {fileDocs.map((doc) => {
                      const i = refDocs.indexOf(doc);
                      return (
                        <div key={doc.path || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7 }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{docIcon(doc)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</a>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
                              {fmtFileSize(doc.size)}{doc.uploaded_at ? ` · ${new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                            </div>
                          </div>
                          <button onClick={() => removeDoc(i)} disabled={deletingDoc === doc.path} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 15, padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}>
                            {deletingDoc === doc.path ? '⏳' : '✕'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Compact drag-and-drop zone — always at the bottom */}
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={async e => { e.preventDefault(); setIsDragging(false); await handleFiles(Array.from(e.dataTransfer.files)); }}
                  onClick={() => !uploading && refDocInputRef.current?.click()}
                  style={{
                    border: `1px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 7, padding: '10px 16px', cursor: uploading ? 'default' : 'pointer',
                    background: isDragging ? 'var(--accent-light, #eff6ff)' : 'transparent',
                    transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <span style={{ fontSize: 14 }}>📎</span>
                  <span style={{ fontSize: 12, color: uploading ? 'var(--accent)' : 'var(--text-faint)', fontWeight: 600 }}>
                    {uploading ? '⏳ Uploading…' : 'Drop files here or click to add more'}
                  </span>
                </div>
              </>
            )}

            {/* ── LINKS TAB ── */}
            {refDocTab === 'links' && (
              <>
                {/* Add link form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: linkDocs.length ? 12 : 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Add a link</div>
                  <input
                    type="url"
                    value={linkDraftUrl}
                    onChange={e => setLinkDraftUrl(e.target.value)}
                    placeholder="https://drive.google.com/… or any URL"
                    style={{ fontSize: 13, padding: '7px 10px' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={linkDraftName}
                      onChange={e => setLinkDraftName(e.target.value)}
                      placeholder="Label (optional)"
                      style={{ flex: 1, fontSize: 13, padding: '7px 10px' }}
                      onKeyDown={async e => { if (e.key === 'Enter') e.currentTarget.nextSibling?.click(); }}
                    />
                    <button
                      className="btn btn-primary"
                      disabled={!linkDraftUrl.trim()}
                      onClick={async () => {
                        const label = linkDraftName.trim() || linkDraftUrl.replace(/^https?:\/\//, '').split('/')[0];
                        const newLink = { type: 'link', name: label, url: linkDraftUrl.trim(), added_at: new Date().toISOString() };
                        const next = [...refDocs, newLink];
                        setRefDocs(next);
                        await saveRefDocs(next);
                        setLinkDraftUrl('');
                        setLinkDraftName('');
                      }}
                    >Add</button>
                  </div>
                </div>

                {/* Link list */}
                {linkDocs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {linkDocs.map((doc) => {
                      const i = refDocs.indexOf(doc);
                      return (
                        <div key={doc.url + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7 }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>🔗</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</a>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.url}</div>
                          </div>
                          <button onClick={() => removeDoc(i)} disabled={deletingDoc === doc.url} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 15, padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}>
                            {deletingDoc === doc.url ? '⏳' : '✕'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {linkDocs.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
                    No links added yet
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ── Granola Integration ── */}
      <SectionDivider />
      <SectionHeader
        title="Granola Integration"
        description="Connect your Granola account so meeting notes automatically populate in deal meeting logs."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* API Key input */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 6 }}>
            API Key
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type={showGranolaKey ? 'text' : 'password'}
              value={granolaKeyDraft}
              onChange={e => { setGranolaKeyDraft(e.target.value); setGranolaTestResult(null); }}
              placeholder="grn_••••••••••••••••••••••••••••••••"
              style={{ flex: 1, fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: granolaKeyDraft ? 'monospace' : 'inherit' }}
            />
            <button
              onClick={() => setShowGranolaKey(v => !v)}
              style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
              title={showGranolaKey ? 'Hide key' : 'Show key'}
            >
              {showGranolaKey ? '🙈' : '👁'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>
            Generate your key in Granola → Settings → API. Requires a Business or Enterprise plan.
          </div>
        </div>

        {/* Test result */}
        {granolaTestResult && (
          <div style={{
            fontSize: 12, padding: '10px 14px', borderRadius: 8,
            background: granolaTestResult.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${granolaTestResult.ok ? '#bbf7d0' : '#fecaca'}`,
            color: granolaTestResult.ok ? '#166534' : '#dc2626',
            fontWeight: 600,
          }}>
            {granolaTestResult.ok ? '✅' : '❌'} {granolaTestResult.message}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            disabled={granolaTesting || !granolaKeyDraft.trim()}
            onClick={async () => {
              setGranolaTesting(true);
              setGranolaTestResult(null);
              try {
                const result = await testGranolaConnection(granolaKeyDraft.trim());
                setGranolaTestResult({ ok: true, message: `Connected — ${result.count} note${result.count !== 1 ? 's' : ''} accessible` });
              } catch (e) {
                setGranolaTestResult({ ok: false, message: e.message });
              } finally {
                setGranolaTesting(false);
              }
            }}
          >
            {granolaTesting ? <><span className="spinner" /> Testing…</> : '🔌 Test connection'}
          </button>

          <button
            className="btn btn-primary"
            disabled={granolaSaving || !granolaKeyDraft.trim()}
            onClick={async () => {
              setGranolaSaving(true);
              try {
                await saveGranolaApiKey(granolaKeyDraft.trim());
                setGranolaKey(granolaKeyDraft.trim());
                setGranolaSaved(true);
                setTimeout(() => setGranolaSaved(false), 2500);
              } catch (e) {
                alert('Save failed: ' + e.message);
              } finally {
                setGranolaSaving(false);
              }
            }}
          >
            {granolaSaving ? <><span className="spinner" /> Saving…</> : granolaSaved ? '✅ Saved!' : '💾 Save key'}
          </button>

          {granolaKey && (
            <button
              className="btn btn-secondary"
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              onClick={async () => {
                if (!window.confirm('Remove Granola API key?')) return;
                await saveGranolaApiKey('');
                setGranolaKey('');
                setGranolaKeyDraft('');
                setGranolaTestResult(null);
              }}
            >
              Remove key
            </button>
          )}
        </div>

        {/* Status */}
        {granolaKey && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-faint)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
            API key saved. Open any deal → Meetings tab to sync Granola notes for that company.
          </div>
        )}
      </div>

      <SectionDivider />
      <SectionHeader
        title="🔒 Forecast PIN"
        description="Protect the Forecast tab with a PIN. Leave blank to disable protection."
      >
        <button className="btn btn-primary" disabled={forecastPinSaving} onClick={async () => {
          setForecastPinSaving(true);
          try {
            await supabase.from('app_settings').upsert({ key: 'forecast_pin', value: forecastPinDraft.trim() }, { onConflict: 'key' });
            setForecastPin(forecastPinDraft.trim());
            setForecastPinSaved(true);
            setTimeout(() => setForecastPinSaved(false), 2500);
          } catch (e) { alert('Save failed: ' + e.message); }
          finally { setForecastPinSaving(false); }
        }}>
          {forecastPinSaving ? <><span className="spinner" /> Saving…</> : forecastPinSaved ? '✅ Saved!' : '💾 Save PIN'}
        </button>
      </SectionHeader>

      <div className="card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="password"
          value={forecastPinDraft}
          onChange={e => setForecastPinDraft(e.target.value)}
          placeholder="Enter a PIN (e.g. 1234)"
          style={{ fontSize: 14, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 200 }}
        />
        {forecastPin && (
          <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={async () => {
            if (!window.confirm('Remove forecast PIN?')) return;
            await supabase.from('app_settings').upsert({ key: 'forecast_pin', value: '' }, { onConflict: 'key' });
            setForecastPin(''); setForecastPinDraft('');
          }}>Remove PIN</button>
        )}
      </div>

      {/* bottom breathing room */}
      <div style={{ height: 48 }} />
    </div>
  );
}
