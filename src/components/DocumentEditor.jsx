import { useState, useEffect } from 'react';
import { upsertDocument, deleteDocument, defaultSections, DOC_TYPES, DOC_STATUSES, SOW_STANDARD_TERMS, docType, docStatus, saveDocToCompanyFiles, deleteCompanyFile } from '../lib/documents';
import { generateDocumentSections } from '../lib/anthropic';

// ── Helpers ───────────────────────────────────────────────────────────────────

const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const escRaw = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PH_ADDR = 'P.O. Box 5185, Andover, Massachusetts 01810';

// ── Section editors ───────────────────────────────────────────────────────────

function TextBlock({ label, value, onChange, rows = 5, hint }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>
        {label}
      </label>
      {hint && <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>{hint}</p>}
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', color: '#111', background: '#fff', outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );
}

function ListEditor({ label, value = [], onChange, hint, placeholder = 'One item per line' }) {
  const text = Array.isArray(value) ? value.join('\n') : '';
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>
        {label}
      </label>
      {hint && <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>{hint}</p>}
      <textarea
        value={text}
        onChange={e => onChange(e.target.value.split('\n').filter(l => l.trim() || true))}
        rows={6}
        placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, lineHeight: 1.7, resize: 'vertical', fontFamily: 'inherit', color: '#111', background: '#fff', outline: 'none', boxSizing: 'border-box' }}
      />
      <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>One item per line</p>
    </div>
  );
}

function DeliverablesEditor({ value = [], onChange }) {
  const cats = Array.isArray(value) ? value : [];

  const addCat = () => onChange([...cats, { category: '', items: [] }]);
  const removeCat = i => onChange(cats.filter((_, idx) => idx !== i));
  const updateCat = (i, field, val) => {
    const next = cats.map((c, idx) => idx === i ? { ...c, [field]: val } : c);
    onChange(next);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af' }}>
          Activities + Deliverables
        </label>
        <button onClick={addCat} style={{ fontSize: 12, color: '#6d28d9', background: 'none', border: '1px dashed #c4b5fd', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
          + Add Category
        </button>
      </div>
      {cats.length === 0 && (
        <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No deliverable categories yet. Generate with AI or add manually.</p>
      )}
      {cats.map((cat, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              value={cat.category || ''}
              onChange={e => updateCat(i, 'category', e.target.value)}
              placeholder="Category title (e.g. Brand Strategy, Website Design)"
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
            />
            <button onClick={() => removeCat(i)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
          </div>
          <textarea
            value={Array.isArray(cat.items) ? cat.items.join('\n') : ''}
            onChange={e => updateCat(i, 'items', e.target.value.split('\n').filter(l => l.trim() || true))}
            placeholder="One deliverable per line"
            rows={4}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      ))}
    </div>
  );
}

function PhasesEditor({ value = [], onChange }) {
  const phases = Array.isArray(value) ? value : [];

  const addPhase = () => onChange([...phases, { title: '', duration: '', deliverables: [] }]);
  const removePhase = i => onChange(phases.filter((_, idx) => idx !== i));
  const updatePhase = (i, field, val) => {
    const next = phases.map((p, idx) => idx === i ? { ...p, [field]: val } : p);
    onChange(next);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af' }}>
          Sprint / Phase Breakdown
        </label>
        <button onClick={addPhase} style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: '1px dashed #93c5fd', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
          + Add Phase
        </button>
      </div>
      {phases.map((phase, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={phase.title || ''}
              onChange={e => updatePhase(i, 'title', e.target.value)}
              placeholder="Phase title (e.g. Sprint 1: Brand Strategy)"
              style={{ flex: 2, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
            />
            <input
              value={phase.duration || ''}
              onChange={e => updatePhase(i, 'duration', e.target.value)}
              placeholder="Duration (e.g. Weeks 1–2)"
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}
            />
            <button onClick={() => removePhase(i)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
          </div>
          <textarea
            value={Array.isArray(phase.deliverables) ? phase.deliverables.join('\n') : ''}
            onChange={e => updatePhase(i, 'deliverables', e.target.value.split('\n').filter(l => l.trim() || true))}
            placeholder="Core deliverables — one per line"
            rows={4}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      ))}
    </div>
  );
}

function GoalObjEditor({ value = [], onChange }) {
  const items = Array.isArray(value) ? value : [];

  const addItem = () => onChange([...items, { title: '', description: '' }]);
  const removeItem = i => onChange(items.filter((_, idx) => idx !== i));
  const updateItem = (i, field, val) => {
    const next = items.map((item, idx) => idx === i ? { ...item, [field]: val } : item);
    onChange(next);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af' }}>
          Objectives
        </label>
        <button onClick={addItem} style={{ fontSize: 12, color: '#8b5cf6', background: 'none', border: '1px dashed #c4b5fd', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
          + Add Objective
        </button>
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#8b5cf6', lineHeight: '32px', minWidth: 20 }}>{i + 1}.</span>
            <input
              value={item.title || ''}
              onChange={e => updateItem(i, 'title', e.target.value)}
              placeholder="Objective title (starts with a verb)"
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
            />
            <button onClick={() => removeItem(i)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          <textarea
            value={item.description || ''}
            onChange={e => updateItem(i, 'description', e.target.value)}
            placeholder="1–2 sentences of context"
            rows={2}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      ))}
      {items.length === 0 && (
        <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No objectives yet. Generate with AI or add manually.</p>
      )}
    </div>
  );
}

// ── Section editors per doc type ──────────────────────────────────────────────

function ProposalEditor({ sections, onChange }) {
  const s = sections || {};
  const upd = (key, val) => onChange({ ...s, [key]: val });
  return (
    <>
      <TextBlock label="Prepared For" value={s.prepared_for} onChange={v => upd('prepared_for', v)} rows={2}
        hint="Name, title, company" />
      <TextBlock label="Date" value={s.date} onChange={v => upd('date', v)} rows={1} />
      <TextBlock label="Understanding of the Project" value={s.understanding} onChange={v => upd('understanding', v)} rows={8}
        hint="2–3 paragraphs showing you understand what's at stake." />
      <TextBlock label="Our Strategic Approach" value={s.strategic_approach} onChange={v => upd('strategic_approach', v)} rows={5}
        hint="1–2 paragraphs on why this approach is right for this client." />
      <ListEditor label="Strategic Objectives" value={s.objectives} onChange={v => upd('objectives', v)}
        hint="What we're setting out to accomplish." />
      <ListEditor label="Expected Outcomes" value={s.outcomes} onChange={v => upd('outcomes', v)}
        hint="What the client will have at the end." />
      <PhasesEditor value={s.phases} onChange={v => upd('phases', v)} />
      <TextBlock label="Investment" value={s.investment} onChange={v => upd('investment', v)} rows={3}
        hint="Frame the value and engagement type — not the price itself." />
      <TextBlock label="Next Steps" value={s.next_steps} onChange={v => upd('next_steps', v)} rows={2}
        hint="Clear, specific, single action." />
    </>
  );
}

function GOOEditor({ sections, onChange }) {
  const s = sections || {};
  const upd = (key, val) => onChange({ ...s, [key]: val });
  return (
    <>
      <TextBlock label="Prepared For" value={s.prepared_for} onChange={v => upd('prepared_for', v)} rows={2} />
      <TextBlock label="Date" value={s.date} onChange={v => upd('date', v)} rows={1} />
      <TextBlock label="What We Heard" value={s.what_we_heard} onChange={v => upd('what_we_heard', v)} rows={7}
        hint="Narrate back what you understood about their situation — with added insight." />
      <TextBlock label="The Goal" value={s.the_goal} onChange={v => upd('the_goal', v)} rows={2}
        hint="One sentence. The clearest possible statement of what you're doing together." />
      <GoalObjEditor value={s.objectives} onChange={v => upd('objectives', v)} />
      <ListEditor label="Outcomes" value={s.outcomes} onChange={v => upd('outcomes', v)}
        hint="What they'll have when this phase is done." />
      <TextBlock label="What This Is Not" value={s.what_this_is_not} onChange={v => upd('what_this_is_not', v)} rows={3}
        hint="Explicit scope guardrails." />
      <TextBlock label="Next Step" value={s.next_step} onChange={v => upd('next_step', v)} rows={2}
        hint="Single, concrete action." />
    </>
  );
}

function SOWEditor({ sections, onChange }) {
  const s = sections || {};
  const upd = (key, val) => onChange({ ...s, [key]: val });
  return (
    <>
      <TextBlock label="Prepared For" value={s.prepared_for} onChange={v => upd('prepared_for', v)} rows={2} />
      <TextBlock label="Date" value={s.date} onChange={v => upd('date', v)} rows={1} />
      <TextBlock label="Approach / Overview" value={s.approach} onChange={v => upd('approach', v)} rows={4}
        hint="1 paragraph on the overall approach for this engagement." />
      <TextBlock label="Goals" value={s.goals} onChange={v => upd('goals', v)} rows={4}
        hint="What this SOW accomplishes." />
      <DeliverablesEditor value={s.deliverables} onChange={v => upd('deliverables', v)} />
      <TextBlock label="Estimated Duration / Timeline" value={s.timeline} onChange={v => upd('timeline', v)} rows={2} />
      <TextBlock label="Start Date" value={s.start_date} onChange={v => upd('start_date', v)} rows={1} />
      <TextBlock label="Total Cost" value={s.cost} onChange={v => upd('cost', v)} rows={1}
        hint="e.g. $24,000" />
      <TextBlock label="Payment Schedule" value={s.payment_schedule} onChange={v => upd('payment_schedule', v)} rows={2}
        hint="e.g. 50% upon initiation, 50% at completion." />
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 12 }}>
        <p style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
          📋 Standard terms (Invoicing, Scope, Pausing, Ownership, Dependencies) are automatically appended to the SOW in Preview and PDF export.
        </p>
      </div>
    </>
  );
}

function MSAEditor({ sections, onChange }) {
  const s = sections || {};
  const upd = (key, val) => onChange({ ...s, [key]: val });
  const field = (label, key, placeholder = '') => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>{label}</label>
      <input
        value={s[key] || ''}
        onChange={e => upd(key, e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
    </div>
  );
  return (
    <>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: '#92400e' }}>
          The MSA legal text is fixed and will populate from the fields below. Part Human's entity information is pre-filled.
        </p>
      </div>
      {field('Client / Company Name', 'client_name', 'e.g. Acme Corp., Inc.')}
      {field('Client Entity Type', 'client_entity_type', 'e.g. Massachusetts Limited Liability Company')}
      {field('Client Address', 'client_address', 'e.g. 123 Main St., Boston, MA 02101')}
      {field('Effective Date', 'effective_date', 'e.g. 1st day of January, 2026')}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>
          Non-Solicitation Period (years)
        </label>
        <select
          value={s.non_solicitation_period || '1'}
          onChange={e => upd('non_solicitation_period', e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
        >
          <option value="1">1 year (mutual)</option>
          <option value="3">3 years</option>
        </select>
      </div>
    </>
  );
}

function MNDAEditor({ sections, onChange }) {
  const s = sections || {};
  const upd = (key, val) => onChange({ ...s, [key]: val });
  const field = (label, key, placeholder = '') => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>{label}</label>
      <input
        value={s[key] || ''}
        onChange={e => upd(key, e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
    </div>
  );
  return (
    <>
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: '#991b1b' }}>
          The MNDA legal text is fixed. Fill in counterparty details — Part Human's information is pre-filled.
        </p>
      </div>
      {field('Counterparty Name', 'counterparty_name', 'e.g. Acme Corp., LLC')}
      {field('Counterparty Address', 'counterparty_address', 'e.g. 456 Market St., San Francisco, CA 94105')}
      {field('Effective Date', 'effective_date', 'e.g. Monday, January 1, 2026')}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>
          Purpose of Disclosure
        </label>
        <input
          value={s.purpose || ''}
          onChange={e => upd('purpose', e.target.value)}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>
    </>
  );
}

// ── Preview renderers ─────────────────────────────────────────────────────────

function buildProposalHtml(doc, sections) {
  const s = sections || {};
  const objectives = (s.objectives || []).filter(o => String(o).trim());
  const outcomes   = (s.outcomes   || []).filter(o => String(o).trim());
  const phases     = s.phases || [];

  return `
<h1 style="font-size:26px;font-weight:800;color:#111;margin-bottom:4px;">${escRaw(doc.title)}</h1>
<div style="font-size:13px;color:#6b7280;margin-bottom:20px;">
  ${s.prepared_for ? `<strong>Prepared for:</strong> ${escRaw(s.prepared_for)}<br>` : ''}
  <strong>Prepared by:</strong> Part Human<br>
  ${s.date ? `<strong>Date:</strong> ${escRaw(s.date)}` : ''}
</div>

${s.understanding ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Understanding of the Project</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;white-space:pre-wrap;">${esc(s.understanding)}</p>
` : ''}

${s.strategic_approach ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Our Strategic Approach</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;white-space:pre-wrap;">${esc(s.strategic_approach)}</p>
` : ''}

${objectives.length > 0 ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Primary Objectives</h2>
<ul style="padding-left:20px;color:#374151;font-size:14px;line-height:2;">
  ${objectives.map(o => `<li>${esc(String(o))}</li>`).join('')}
</ul>
` : ''}

${outcomes.length > 0 ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Expected Outcomes</h2>
<ul style="padding-left:20px;color:#374151;font-size:14px;line-height:2;">
  ${outcomes.map(o => `<li>${esc(String(o))}</li>`).join('')}
</ul>
` : ''}

${phases.length > 0 ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Sprint Breakdown</h2>
${phases.map(p => `
  <div style="margin-bottom:16px;">
    <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px;">${escRaw(p.title || '')} ${p.duration ? `<span style="font-weight:400;color:#9ca3af;font-size:12px;">(${escRaw(p.duration)})</span>` : ''}</div>
    ${(p.deliverables || []).length > 0 ? `<ul style="padding-left:20px;color:#374151;font-size:13px;line-height:1.9;">${(p.deliverables || []).map(d => `<li>${esc(String(d))}</li>`).join('')}</ul>` : ''}
  </div>
`).join('')}
` : ''}

${s.investment ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Investment</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;">${esc(s.investment)}</p>
` : ''}

${s.next_steps ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Next Steps</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;">${esc(s.next_steps)}</p>
` : ''}

<div style="margin-top:60px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
  Prepared by Part Human · ${escRaw(PH_ADDR)}
</div>`;
}

function buildGooHtml(doc, sections) {
  const s = sections || {};
  const objectives = Array.isArray(s.objectives) ? s.objectives : [];
  const outcomes   = Array.isArray(s.outcomes)   ? s.outcomes.filter(o => String(o).trim()) : [];

  return `
<h1 style="font-size:26px;font-weight:800;color:#111;margin-bottom:4px;">${escRaw(doc.title)}</h1>
<div style="font-size:13px;color:#6b7280;margin-bottom:20px;">
  ${s.prepared_for ? `<strong>Prepared for:</strong> ${escRaw(s.prepared_for)}<br>` : ''}
  <strong>Prepared by:</strong> Part Human<br>
  ${s.date ? `<strong>Date:</strong> ${escRaw(s.date)}` : ''}
</div>
<p style="font-size:12px;color:#9ca3af;font-style:italic;margin-bottom:24px;">This is the napkin, not the proposal. Its only job is to make sure we heard you right and that we're aiming at the same thing before anyone spends a dollar.</p>

${s.what_we_heard ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">What We Heard</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;white-space:pre-wrap;">${esc(s.what_we_heard)}</p>
` : ''}

${s.the_goal ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">The Goal</h2>
<p style="font-size:16px;font-weight:600;color:#111;line-height:1.6;">${esc(s.the_goal)}</p>
` : ''}

${objectives.length > 0 ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Objectives</h2>
${objectives.map((obj, i) => {
  const o = typeof obj === 'object' ? obj : { title: String(obj), description: '' };
  return `<div style="margin-bottom:14px;">
    <div style="font-size:14px;font-weight:700;color:#111;">${i + 1}. ${escRaw(o.title || '')}</div>
    ${o.description ? `<p style="font-size:13px;color:#374151;line-height:1.65;margin-left:18px;margin-top:4px;">${esc(o.description)}</p>` : ''}
  </div>`;
}).join('')}
` : ''}

${outcomes.length > 0 ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Outcomes</h2>
<ul style="padding-left:20px;color:#374151;font-size:14px;line-height:2;">
  ${outcomes.map(o => `<li>${esc(String(o))}</li>`).join('')}
</ul>
` : ''}

${s.what_this_is_not ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">What This Is Not</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;">${esc(s.what_this_is_not)}</p>
` : ''}

${s.next_step ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Next Step</h2>
<p style="font-size:14px;font-weight:600;color:#111;line-height:1.6;">${esc(s.next_step)}</p>
` : ''}

<div style="margin-top:60px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
  Part Human · ${escRaw(PH_ADDR)}
</div>`;
}

function buildSowHtml(doc, sections) {
  const s = sections || {};
  const deliverables = Array.isArray(s.deliverables) ? s.deliverables : [];

  const termsHtml = SOW_STANDARD_TERMS.map(section => `
    <h3 style="font-size:13px;font-weight:700;color:#374151;margin:16px 0 6px;">${escRaw(section.heading)}</h3>
    <ol style="padding-left:20px;color:#374151;font-size:12px;line-height:1.7;margin:0;">
      ${section.items.map(item => `<li style="margin-bottom:4px;">${escRaw(item)}</li>`).join('')}
    </ol>
  `).join('');

  return `
<h1 style="font-size:26px;font-weight:800;color:#111;margin-bottom:4px;">${escRaw(doc.title)}</h1>
<div style="font-size:13px;color:#6b7280;margin-bottom:20px;">
  ${s.prepared_for ? `<strong>Prepared for:</strong> ${escRaw(s.prepared_for)}<br>` : ''}
  <strong>Prepared by:</strong> Part Human<br>
  ${s.date ? `<strong>Date:</strong> ${escRaw(s.date)}` : ''}
</div>

${s.goals ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Project Goals</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;white-space:pre-wrap;">${esc(s.goals)}</p>
` : ''}

${s.approach ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Approach</h2>
<p style="font-size:14px;color:#374151;line-height:1.75;">${esc(s.approach)}</p>
` : ''}

${deliverables.length > 0 ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Activities + Deliverables</h2>
${deliverables.map(cat => `
  <div style="margin-bottom:16px;">
    <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:6px;">${escRaw(cat.category || '')}</div>
    <ul style="padding-left:20px;color:#374151;font-size:13px;line-height:1.85;">
      ${(cat.items || []).filter(i => String(i).trim()).map(item => `<li>${esc(String(item))}</li>`).join('')}
    </ul>
  </div>
`).join('')}
` : ''}

${(s.timeline || s.start_date) ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Timeline</h2>
${s.timeline ? `<p style="font-size:14px;color:#374151;">${esc(s.timeline)}</p>` : ''}
${s.start_date ? `<p style="font-size:14px;color:#374151;"><strong>Start Date:</strong> ${esc(s.start_date)}</p>` : ''}
` : ''}

${(s.cost || s.payment_schedule) ? `
<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:28px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Investment</h2>
${s.cost ? `<p style="font-size:16px;font-weight:700;color:#111;margin-bottom:6px;">${esc(s.cost)}</p>` : ''}
${s.payment_schedule ? `<p style="font-size:13px;color:#374151;">${esc(s.payment_schedule)}</p>` : ''}
` : ''}

<h2 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:36px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #e5e7eb;">Terms + Conditions</h2>
<p style="font-size:12px;color:#6b7280;margin-bottom:12px;">Over the years, we've found that setting expectations upfront reduces ambiguity and increases the likelihood of a successful project. Below you will find a series of items that address specific areas of the project agreement.</p>
${termsHtml}

<div style="margin-top:40px;padding-top:20px;border-top:2px solid #111;">
  <h3 style="font-size:14px;font-weight:700;margin-bottom:16px;">Acceptance + Approval</h3>
  <p style="font-size:12px;color:#6b7280;margin-bottom:24px;">Ready to move forward? Please notify us and we will forward a copy of this contract through DocuSign for your electronic signature.</p>
  <div style="display:flex;gap:60px;">
    <div style="flex:1;">
      <p style="font-size:13px;font-weight:700;margin-bottom:20px;">${escRaw(s.prepared_for || 'CLIENT')}</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:30px;"></div><p style="font-size:11px;color:#9ca3af;">Signature</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Name</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Title</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Date</p>
    </div>
    <div style="flex:1;">
      <p style="font-size:13px;font-weight:700;margin-bottom:20px;">Part Human</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:30px;"></div><p style="font-size:11px;color:#9ca3af;">Signature</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Name</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Title</p>
      <div style="border-bottom:1px solid #111;margin-bottom:6px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Date</p>
    </div>
  </div>
</div>

<div style="margin-top:40px;font-size:11px;color:#9ca3af;text-align:center;">Part Human · ${escRaw(PH_ADDR)}</div>`;
}

function buildMsaHtml(doc, sections) {
  const s = sections || {};
  const nonSol = s.non_solicitation_period === '3' ? 'three (3)' : 'one (1)';
  const expenseThreshold = '$50.00';

  return `
<div style="font-size:14px;color:#374151;line-height:1.75;">

<p>This Master Services Agreement (the "Agreement") between, <strong>Part Human, LLC,</strong> a Massachusetts limited liability company with a principal address of <strong>${escRaw(PH_ADDR)}</strong> ("Company") and <strong>${escRaw(s.client_name || '[CLIENT NAME]')}</strong>, ${s.client_entity_type ? `a ${escRaw(s.client_entity_type)},` : ''} with a principal address of <strong>${escRaw(s.client_address || '[CLIENT ADDRESS]')}</strong> ("Client") is made effective this <strong>${escRaw(s.effective_date || '[EFFECTIVE DATE]')}</strong>. Each of the entities is also referred to herein as "Party" and, collectively, they are sometimes referred to as "Parties."</p>

<p style="margin-top:16px;">In consideration of the mutual promises and agreements contained herein, the receipt and sufficiency of which are hereby acknowledged, the Parties agree as follows:</p>

<p style="margin-top:20px;"><strong>1.&nbsp;&nbsp;Marketing and Brand Development Services.</strong> Company will perform services for Client in connection with the planning, provision, creation and/or placing of branding, research, advertising, marketing, consulting, creative and/or digital services for Client, during the Term, as more fully detailed in the attached Statement of Work ("SOW"), which is incorporated herein by reference (such services are collectively referred to as "Services"). If any terms and conditions expressly set forth in such SOW conflict with the terms of this Agreement, the terms of the Agreement shall control unless such SOW expressly provides that it shall control with respect to such conflict. Any such conflicting terms and conditions apply only to the Services described in that particular SOW and have no application to Services provided pursuant to other SOWs. During the term of this agreement, Client may wish to assign additional projects, products, or services to Company beyond the Services outlined in the SOW ("Out-of-Scope Assignments"). Company agrees to accept such Out-of-Scope Assignments only upon a separate written agreement or as an Addendum to this Agreement with Client regarding additional compensation to be paid to Company and other relevant terms and conditions. Nothing in this Agreement will be deemed to require Company to undertake any act or perform any services which in its good faith judgment would be misleading, false, libelous, unlawful, in breach of a contract, or otherwise prejudicial to Client's or Company's interests.</p>

<p style="margin-top:16px;"><strong>2.&nbsp;&nbsp;"Content"</strong> means all text, pictures, sound, graphics, video and other data supplied by Client to Company for use in connection with the Deliverables (as defined below) and each Project. Any Content given to Company by Client under this Agreement or otherwise shall at all times remain the property of Client or its licensor. Company shall have no rights in such Content, other than the limited right to use such Content for the purposes expressly set forth in this Agreement. Upon Client's acceptance of the Deliverables, or upon the cancellation of the Project, Company shall provide Client with all copies and originals of the Content provided by Client to Company, or destroy said copies, at Client's option.</p>

<p style="margin-top:16px;"><strong>3.&nbsp;&nbsp;"Deliverables"</strong> means all documentation, all content, and any other work product prepared for or delivered to Client by Company under this Agreement. Company shall and does hereby assign all right, title, and interest to all Deliverables to Client. Company shall execute and deliver to Client any and all documents as may be required to establish Client's ownership of the Deliverables. If there are any rights in the Deliverables that cannot be assigned to Client and if there are any Company tools in the Deliverables, Company waives the enforcement of such rights and grants to Client an exclusive, irrevocable, perpetual, worldwide, fully paid, royalty-free license therein to make, use, copy, modify, and publicly display (and to have others do so on Client's behalf), with right to sublicense through multiple tiers, to such rights. Company represents and warrants that all persons performing the Services are obligated to assign their rights in any Deliverable and intellectual property rights thereto to Company. Company will use royalty-free photographic images unless otherwise approved in writing by Client. For any other photographic images, Company will act as Client's agent to negotiate the best price and will obtain Client's written approval before subcontracting for and/or licensing such images. Images will be provided to Client at cost without markup.</p>

<p style="margin-top:16px;"><strong>4.&nbsp;&nbsp;Payment.</strong> The Client shall pay all fees for services as set forth in the SOW. The SOW includes a detailed invoice schedule with corresponding activities and deliverables for each period. Invoices will be sent on the first of each month or as detailed in the SOW's invoice schedule. First invoice must be paid upon receipt to initiate the project. Unless noted in the SOW's invoice schedule, all subsequent invoices shall be paid by Client within thirty (30) days of invoice. Payments not made within such time period shall be subject to late charges equal to the lesser of (i) one and one-half percent (1.5%) per month of the overdue amount. Company may suspend all services on seven (7) days written notice until the amounts outstanding are paid in full.</p>

<p style="margin-top:16px;"><strong>5.&nbsp;&nbsp;Expenses.</strong> Client shall also reimburse Company for reasonable out-of-pocket travel expenses, including transportation, lodging, mileage, and meals incurred in rendering Company's professional services, as well as all necessary incidental expenses (collectively, "Expenses"). Company shall obtain Client's prior written authorization before incurring any individual Expense or cost in excess of ${expenseThreshold}. All Expenses not paid directly by Client shall be paid within thirty (30) days of receipt of Company's invoice. All Expense reimbursements shall be made at Company's direct out-of-pocket costs, without any markup for overhead, administrative costs, or otherwise.</p>

<p style="margin-top:16px;"><strong>6.&nbsp;&nbsp;Third Party Licenses.</strong> In addition to any other fees set forth in this Agreement, Client shall be required to purchase any applicable third-party licenses for any third party products that are necessary for Company to design and develop Client marketing websites. In the event any such third party product exceeds ${expenseThreshold} per product, Company shall obtain Client's prior written consent before incorporating such third party product.</p>

<p style="margin-top:16px;"><strong>7.&nbsp;&nbsp;Taxes.</strong> Client shall pay, reimburse, and/or hold Company harmless for all sales, use, transfer, privilege, tariffs, excise, and all other taxes and all duties, whether international, national, state, or local, however designated except income taxes, which are levied or imposed by reason of the performance of the professional services under this Agreement.</p>

<p style="margin-top:16px;"><strong>8.&nbsp;&nbsp;Trademarks.</strong> Company may create or develop trademarks for Client, in the form of taglines, slogans, logos, designs, or product and brand names (collectively, the "Marks"). Client shall ultimately be responsible for confirming availability and registering such Marks at their sole cost and expense. Company may assist in coordinating the effort associated with clearing and registering the Marks.</p>

<p style="margin-top:16px;"><strong>9.&nbsp;&nbsp;Subcontractors.</strong> Client acknowledges that Company may, in the rendition of the Services hereunder, engage third party suppliers and other vendors and subcontractors ("Subcontractors") from time to time to provide certain services. Company shall supervise such services and endeavor to guard against any loss to Client as the result of the failure of Subcontractors to properly execute their commitments, but except to the extent such Subcontractors are not pre-approved by Client in writing, Company shall not be responsible for their failure, acts or omissions, except where such failure, acts or omissions are due to Company's negligence or willful misconduct.</p>

<p style="margin-top:16px;"><strong>10.&nbsp;&nbsp;Marketing &amp; Promotion.</strong> Company, with advanced written permission from Client, shall have the right to display and showcase the Work Product and related Client Content for promotional and marketing purposes, including on its website, in Social Media, and in its portfolio, and, subject to Client's written approval, include Client in its list of representative clients.</p>

<p style="margin-top:16px;"><strong>11.&nbsp;&nbsp;Company Materials.</strong> Notwithstanding any other provision of this Agreement or unless explicitly noted in the SOW, Company shall retain all rights, title and interest in and to any data, designs, processes, specifications, software, methodologies, know-how, materials, information and skills owned, acquired or developed by Company or its licensors (collectively, "Company Materials"). Subject to fulfillment of Client's payment obligations hereunder, Company hereby grants Client a worldwide, perpetual, irrevocable, royalty-free, nonexclusive license to use Company Materials actually incorporated into Work Product pursuant to this Agreement.</p>

<p style="margin-top:16px;"><strong>12.&nbsp;&nbsp;Third Party Licenses.</strong> Notwithstanding any other provisions herein, it is understood that Company often licenses materials from third parties for inclusion in Work Product. All Third Party Licenses, including costs and terms, will be detailed in the SOW if available at the time of writing. Any Third Party Licenses will designate Client as the licensee. COMPANY MAKES NO WARRANTY OF ANY KIND, WHETHER EXPRESS OR IMPLIED, WITH REGARD TO ANY THIRD-PARTY PRODUCTS, THIRD PARTY CONTENT OR ANY SOFTWARE, EQUIPMENT, OR HARDWARE OBTAINED FROM THIRD PARTIES.</p>

<p style="margin-top:20px;"><strong>13.&nbsp;&nbsp;TERM AND TERMINATION.</strong></p>
<p style="margin-left:20px;margin-top:8px;"><strong>a.</strong> This Agreement may be terminated at any time by either party effective immediately upon notice, or the mutual agreement of the parties, or (a) if any party becomes insolvent, files a petition in bankruptcy, makes an assignment for the benefit of its creditors; or (b) breaches any of its material responsibilities or obligations under this Agreement, which breach is not remedied within 10 days from receipt of written notice of such breach.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>b.</strong> In the event of termination, Company shall be compensated for the Services performed through the date of termination; and Client shall pay all reasonable Expenses, fees, and out of pockets incurred through and up to, the date of cancellation.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>c.</strong> In the event of termination by Client and upon full payment of compensation for services rendered through the date of termination, Company grants to Client such rights and title as provided for in the SOW with respect to those Deliverables provided to, and accepted by Client as of the date of termination.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>d.</strong> Upon expiration or termination of this Agreement: (a) each party shall return or, at the disclosing party's request, destroy any and all Confidential Information of the other party, and (b) other than as provided herein, all rights and obligations of each party under this Agreement, exclusive of the Services, shall survive.</p>

<p style="margin-top:16px;"><strong>14.&nbsp;&nbsp;Confidential Information.</strong> Each Party hereto (each a "Recipient") shall hold each other's Proprietary or Confidential Information in strict confidence. "Proprietary or Confidential Information" shall include, but is not limited to, written or oral contracts, trade secrets, know-how, business methods, business policies, memoranda, reports, records, computer retained information, notes, or financial information. Proprietary or Confidential Information shall not include any information which: (i) is or becomes generally known to the public by any means other than a breach of the obligations of the receiving party; (ii) was previously known to the receiving party or rightly received by the receiving party from a third party; (iii) is independently developed by the receiving party; or (iv) is subject to disclosure under court order or other lawful process. The parties agree not to make each other's Proprietary or Confidential Information available in any form to any third party or to use each other's Proprietary or Confidential Information for any purpose other than as specified in this Agreement. Notwithstanding termination or expiration of this Agreement, obligations of confidentiality with respect to Proprietary or Confidential Information shall continue in effect for a total period of three (3) years from the Effective Date.</p>

<p style="margin-top:16px;"><strong>15.&nbsp;&nbsp;Representations and Warranties.</strong></p>
<p style="margin-left:20px;margin-top:8px;"><strong>a.</strong> Company represents and warrants that (i) the Services provided hereunder will be performed in a professional manner, and (ii) any software, hardware, websites, web-based or technology-related Services will be free of material bugs or defects for sixty (60) days after delivery to both Company and Client's satisfaction.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>b.</strong> Company further warrants and represents that any Deliverables will conform to their applicable specifications or acceptance criteria when delivered and be compatible with the content management system.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>c.</strong> The parties represent and warrant each other that their respective disclosure and delivery of any information, documents, software and other materials, and use thereof, as contemplated by this Agreement, will not knowingly infringe or violate any proprietary right of any third party.</p>

<p style="margin-top:16px;"><strong>16.&nbsp;&nbsp;Disclaimer of Warranties.</strong> Except for the express representations and warranties stated in this agreement, Company makes no warranties whatsoever and Company explicitly disclaims any other warranties of any kind, either express or implied, including but not limited to warranties of merchantability or fitness for a particular purpose.</p>

<p style="margin-top:16px;"><strong>17.&nbsp;&nbsp;LIMITATION OF LIABILITY.</strong> The services and the deliverables are sold "as is." In no event shall Company be liable for any lost data or content, lost profits, business interruption or for any indirect, incidental, special, consequential, exemplary or punitive damages arising out of or relating to the materials or the services provided by Company, even if Company has been advised of the possibility of such damages. IN NO EVENT SHALL THE COMPANY'S AGGREGATE LIABILITY FOR DAMAGES ARISING OUT OF THIS AGREEMENT EXCEED THE REVENUE PAID BY CLIENT TO COMPANY.</p>

<p style="margin-top:16px;"><strong>18.&nbsp;&nbsp;Force Majeure.</strong> Neither Client nor Company shall be liable to the other for any failure, inability, or delay in performing hereunder if caused by any cause beyond the reasonable control of the party so failing, including, without limitation, an Act of God, war, strike, or fire.</p>

<p style="margin-top:16px;"><strong>19.&nbsp;&nbsp;Client Warranties.</strong> The Client warrants that all information and data provided to Company is accurate and adequate for Company to perform the Services.</p>

<p style="margin-top:16px;"><strong>20.&nbsp;&nbsp;Indemnity.</strong> Each party shall indemnify, defend, and hold harmless the other party, its parents, subsidiaries, and affiliated companies, and its and their respective employees, officers, directors, shareholders, and agents from and against any and all Loss incurred based upon or arising out of any third-party claim, allegation, demand, suit, or proceeding made or brought against any party with respect to the activities performed hereunder.</p>

<p style="margin-top:16px;"><strong>21.&nbsp;&nbsp;Non Solicitation.</strong> During the term of this Agreement, and for a period of ${nonSol} year(s) following the expiration or termination of this Agreement, both Company and Client mutually agree not to solicit, recruit, engage or otherwise employ or retain, on a full-time, part-time, consulting, work-for-hire or any other kind of basis, any employee or Agent of the other party, whether or not said person has been assigned to perform tasks under this Agreement. In the event such employment, consultation or work-for-hire event occurs, the affected party shall be entitled to damages and may seek all remedies under law and equity.</p>

<p style="margin-top:16px;"><strong>22.&nbsp;&nbsp;Binding Arbitration.</strong> The Parties covenant and agree that any and all claims and disputes arising under or relating to this Agreement, the SOW or the services specified therein, are to be settled by binding arbitration. The arbitration shall be conducted by an Arbitrator mutually agreed by the Parties within the Commonwealth of Massachusetts and subject to the rules of the American Arbitration Association.</p>

<p style="margin-top:20px;"><strong>23.&nbsp;&nbsp;General Provisions.</strong></p>
<p style="margin-left:20px;margin-top:8px;"><strong>a. Entire Agreement.</strong> This Agreement constitutes the entire agreement between Client and Company and supersedes all prior agreements and understandings between the Parties with respect to the subject matter hereof.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>b. Independent Contractors.</strong> The Parties hereto are independent contractors. Nothing in this Agreement shall be deemed to create any form of partnership, principal-agent relationship, employer-employee relationship, or joint venture between the Parties hereto.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>c. Waiver.</strong> The failure of any party to seek redress for violation of or to insist upon the strict performance of any agreement, covenant or condition of this Agreement shall not constitute a waiver with respect thereto or with respect to any subsequent act.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>d. Assignment.</strong> Neither Party may assign its rights or obligations under this Agreement without the prior written consent of the other, which consent shall not be unreasonably withheld or delayed.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>e. Amendment.</strong> This Agreement may only be amended, modified or altered by a written agreement signed by both Parties.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>f. Choice of Law.</strong> This Agreement is governed by the laws of the Commonwealth of Massachusetts without regard to its rules concerning conflicts of laws.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>g. Severability.</strong> If any provision of this Agreement shall be held to be invalid, illegal or unenforceable, the validity, legality and enforceability of the remaining provisions of the Agreement shall not in any way be impaired thereby.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>h. Authority.</strong> Each Party represents and warrants to the other that it has the right and authority to sign on behalf of and legally bind their respective companies and perform its respective obligations hereunder.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>i. Notices.</strong> Notice shall be delivered to the above address of the receiving Party by (i) certified mail, return receipt requested, (ii) hand delivery with receipt acknowledged, (iii) overnight courier service that provides a delivery receipt, or (iv) email notice with a confirmation email from Client.</p>
<p style="margin-left:20px;margin-top:8px;"><strong>j. Execution.</strong> The Parties duly authorized representatives named below have executed this Agreement as of the Effective Date.</p>

<div style="margin-top:40px;padding-top:20px;border-top:2px solid #111;">
  <h3 style="font-size:14px;font-weight:700;margin-bottom:24px;">Acceptance + Approval — ACCEPTED AND AGREED:</h3>
  <div style="display:flex;gap:60px;">
    <div style="flex:1;">
      <p style="font-size:13px;font-weight:700;margin-bottom:20px;">${escRaw(s.client_name || '[CLIENT NAME]')}</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:30px;"></div><p style="font-size:11px;color:#9ca3af;">Signature</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Name</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Title</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Date</p>
    </div>
    <div style="flex:1;">
      <p style="font-size:13px;font-weight:700;margin-bottom:20px;">Part Human, LLC</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:30px;"></div><p style="font-size:11px;color:#9ca3af;">Signature</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Name</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Title</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:12px;"></div><p style="font-size:11px;color:#9ca3af;">Date</p>
    </div>
  </div>
</div>

</div>`;
}

function buildMndaHtml(doc, sections) {
  const s = sections || {};
  return `
<div style="font-size:14px;color:#374151;line-height:1.75;">

<h1 style="font-size:20px;font-weight:800;text-align:center;color:#111;margin-bottom:6px;">PART HUMAN, LLC</h1>
<h2 style="font-size:16px;font-weight:700;text-align:center;color:#111;margin-bottom:20px;">MUTUAL NON-DISCLOSURE AGREEMENT</h2>

<p>THIS MUTUAL NON-DISCLOSURE AGREEMENT ("Agreement") is entered into as of <strong>${escRaw(s.effective_date || '[EFFECTIVE DATE]')}</strong> ("Effective Date") by and between <strong>Part Human, LLC, a Massachusetts Limited Liability Company</strong>, with principal offices at <strong>${escRaw(PH_ADDR)}</strong> and <strong>${escRaw(s.counterparty_name || '[COUNTERPARTY NAME]')}</strong> with principal offices at <strong>${escRaw(s.counterparty_address || '[COUNTERPARTY ADDRESS]')}</strong>, and governs the disclosure, use, and protection of confidential information between the parties.</p>

<p style="margin-top:16px;"><strong>1. Purpose.</strong> In connection with the evaluation of ${escRaw(s.purpose || 'a possible business relationship')} between the parties ("Purpose"), a party ("Disclosing Party") may disclose to the other party ("Recipient") certain Confidential Information (defined below).</p>

<p style="margin-top:16px;"><strong>2. Confidential Information.</strong> As used herein, "Confidential Information" shall mean any and all proprietary information of the Disclosing Party, including but not limited to patent and patent applications, trade secrets and other proprietary information, including but not limited to ideas, techniques, sketches, drawings, works of authorship, models, inventions, know-how, processes, equipment, algorithms, hardware, software source code, and formulae related to the current, future, and proposed products and services, and including, without limitation, information concerning research, experimental work, development, design details and specifications, engineering, financial information, procurement requirements, purchasing, manufacturing, customers and prospective customers, investors, employees, suppliers, business and contractual relationships, business forecasts, sales and merchandising, marketing plans, and other information that gives or may give the Disclosing Party a competitive advantage, and which Disclosing Party designates as being confidential or which, under the circumstances surrounding its disclosure, a reasonable person would have recognized as being confidential. "Technical Confidential Information" shall mean any and all technical proprietary information, including but not limited to algorithms, equipment, hardware, software source code, know-how, processes, formulae, designs, specifications, and similar information.</p>

<p style="margin-top:16px;"><strong>3. Protection and Use.</strong> Recipient agrees that at all times and notwithstanding any termination or expiration of this Agreement, Recipient will hold in strict confidence and not disclose to any third party the Confidential Information, except as provided by this Agreement or approved in writing by the Disclosing Party, and will use such Confidential Information for no purpose other than the Purpose. Recipient shall only permit access to Confidential Information to those of its employees or authorized representatives having a need to know and who have signed written confidentiality agreements or are otherwise bound by confidentiality obligations at least as restrictive as those contained herein. Recipient agrees that it will use commercially reasonable efforts but in no event less than the same efforts that Recipient uses to protect its own similar information, to prevent any unauthorized access to or disclosure of the Confidential Information.</p>

<p style="margin-top:16px;"><strong>4. Exclusions.</strong> Recipient's obligations under this Agreement with respect to any portion of the Confidential Information shall terminate when Recipient can document that the Confidential Information: (a) was in the public domain at the time it was communicated to Recipient; (b) entered the public domain subsequent to the time it was communicated to Recipient through no fault of Recipient; (c) was in Recipient's possession free of any obligation of confidence at the time it was communicated; (d) was rightfully communicated to Recipient free of any obligation of confidence subsequent to the time it was communicated; or (e) was developed by employees or agents of Recipient independently of and without reference to the Confidential Information.</p>

<p style="margin-top:16px;"><strong>5. Return of Materials.</strong> Upon termination or expiration of this Agreement, or upon written request of Disclosing Party, Recipient shall promptly return to Disclosing Party all documents and other tangible materials embodying all or any portion of the Confidential Information, and all copies thereof.</p>

<p style="margin-top:16px;"><strong>6. Ownership.</strong> Recipient recognizes and agrees that nothing contained in this Agreement shall be construed as granting any property rights, by license or otherwise, to any Confidential Information, or to any invention or any patent, copyright, trademark or other intellectual property rights that have issued or that may issue, based on such Confidential Information.</p>

<p style="margin-top:16px;"><strong>7. Term and Termination.</strong> This Agreement shall become effective on the Effective Date and terminate five (5) years after the Effective Date unless terminated earlier by either party at any time upon thirty (30) days written notice to the other party. Recipient's obligations hereunder shall survive termination of this Agreement and (a) with respect to non-technical sales, marketing, and financial Confidential Information, shall continue in full force and effect for ten (10) years from the date of termination of this Agreement; and (b) with respect to Technical Confidential Information, shall be terminated only as provided in Section 4.</p>

<p style="margin-top:16px;"><strong>8. Relationship of the Parties.</strong> This Agreement is not intended to be, nor shall it be construed as creating a joint venture, association, partnership, or other formal business organization or agency relationship between the parties. Nothing in this Agreement shall prohibit or restrict either party's right to develop, make, use, market, license or distribute products or services similar to or competitive with those of the other party disclosed in the Confidential Information as long as it shall not thereby breach this Agreement.</p>

<p style="margin-top:16px;"><strong>9. No Warranty.</strong> NO REPRESENTATION OR WARRANTY WITH RESPECT TO THE CONFIDENTIAL INFORMATION IS MADE BY THE DISCLOSING PARTY, AND ANY INFORMATION PROVIDED UNDER THIS AGREEMENT IS PROVIDED "AS IS."</p>

<p style="margin-top:16px;"><strong>10. Compliance with Law.</strong> Recipient shall not export, directly or indirectly, any technical data acquired from Disclosing Party pursuant to this Agreement or any product utilizing any such data in violation of any applicable U.S. law, regulation or executive order.</p>

<p style="margin-top:16px;"><strong>11. Confidentiality of Agreement.</strong> Except as may be authorized by the other party in writing, neither party shall disclose to any third party: (a) the existence of this Agreement; (b) that the Confidential Information has been disclosed; (c) that discussions are taking place concerning a possible business relationship between the parties; or (d) the content or status of such discussions.</p>

<p style="margin-top:16px;"><strong>12. Notices.</strong> Any notices required by this Agreement shall be given by hand or sent by overnight courier to the intended party at its address set forth below.</p>

<p style="margin-top:16px;"><strong>13. Assignment.</strong> This Agreement may not be assigned or otherwise transferred by either party in whole or in part without the express prior written consent of the other party, which consent shall not unreasonably be withheld. This consent requirement shall not apply in the event either party changes its legal name or merges with another company.</p>

<p style="margin-top:16px;"><strong>14. Governing Law and Jurisdiction.</strong> This Agreement shall be governed by and construed in accordance with the laws of the Commonwealth of Massachusetts without giving effect to any choice of law principles that would require the application of the laws of a different jurisdiction. Any disputes under this Agreement shall be brought in the state and Federal courts located in Suffolk County, Massachusetts.</p>

<p style="margin-top:16px;"><strong>15. Remedies.</strong> Each party recognizes and acknowledges the competitive value and confidential nature of the Confidential Information, and that irreparable damage may result to Disclosing Party if such information is disclosed to any third party or is used for any purpose other than as provided herein. Accordingly, Recipient agrees and acknowledges that, in the event of any such breach or threatened breach, Disclosing Party shall be entitled to seek injunctive relief against the breach or threatened breach of this Agreement, without the necessity of posting bond or proving actual damages.</p>

<p style="margin-top:16px;"><strong>16. Attorneys' Fees.</strong> If either party brings an action to enforce the provisions of this Agreement, the prevailing party shall be entitled to reasonable attorneys' fees and arbitration and court costs.</p>

<p style="margin-top:16px;"><strong>17. Entire Agreement; Modification; No Waiver.</strong> Each of the parties agrees that this Agreement: (a) is the complete and exclusive statement between the parties with respect to the use and protection of the Confidential Information; (b) supersedes all related discussions and other communications between the parties; and (c) may only be modified in writing by authorized representatives of each of the parties.</p>

<p style="margin-top:16px;"><strong>18. Severability.</strong> If any provision of this Agreement is found by a court to be unenforceable or invalid, such unenforceability or invalidity shall not render this Agreement unenforceable or invalid as a whole.</p>

<div style="margin-top:40px;padding-top:20px;border-top:2px solid #111;">
  <p style="font-size:13px;margin-bottom:24px;"><strong>IN WITNESS WHEREOF</strong>, each of the parties hereto has caused this Mutual Non-Disclosure Agreement to be executed by its duly authorized representative as of the Effective Date.</p>
  <div style="display:flex;gap:60px;">
    <div style="flex:1;">
      <p style="font-size:13px;font-weight:700;margin-bottom:20px;">Part Human, LLC</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:30px;"></div><p style="font-size:11px;color:#9ca3af;">By (Signature)</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:14px;"></div><p style="font-size:11px;color:#9ca3af;">Print Name</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:14px;"></div><p style="font-size:11px;color:#9ca3af;">Title</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:14px;"></div><p style="font-size:11px;color:#9ca3af;">Date</p>
    </div>
    <div style="flex:1;">
      <p style="font-size:13px;font-weight:700;margin-bottom:20px;">${escRaw(s.counterparty_name || '[COUNTERPARTY NAME]')}</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:30px;"></div><p style="font-size:11px;color:#9ca3af;">By (Signature)</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:14px;"></div><p style="font-size:11px;color:#9ca3af;">Print Name</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:14px;"></div><p style="font-size:11px;color:#9ca3af;">Title</p>
      <div style="border-bottom:1px solid #111;margin-bottom:4px;height:20px;margin-top:14px;"></div><p style="font-size:11px;color:#9ca3af;">Date</p>
    </div>
  </div>
</div>

</div>`;
}

// ── Markdown builder ──────────────────────────────────────────────────────────

function buildDocumentMarkdown(doc, sections) {
  const s = sections || {};
  const md = [];

  md.push(`# ${doc.title || 'Untitled'}`);
  md.push('');
  if (doc.company_name) md.push(`**For:** ${doc.company_name}`);
  md.push('**Prepared by:** Part Human');
  md.push('');

  const type = doc.type;

  if (type === 'proposal') {
    if (s.prepared_for) { md.push(`**Prepared for:** ${s.prepared_for}`); md.push(''); }
    if (s.date)         { md.push(`**Date:** ${s.date}`); md.push(''); }
    if (s.understanding) {
      md.push('## Understanding of the Project'); md.push('');
      md.push(s.understanding); md.push('');
    }
    if (s.strategic_approach) {
      md.push('## Our Strategic Approach'); md.push('');
      md.push(s.strategic_approach); md.push('');
    }
    const objs = (s.objectives || []).filter(o => String(o).trim());
    if (objs.length) {
      md.push('## Primary Objectives'); md.push('');
      objs.forEach(o => md.push(`- ${String(o)}`)); md.push('');
    }
    const outs = (s.outcomes || []).filter(o => String(o).trim());
    if (outs.length) {
      md.push('## Expected Outcomes'); md.push('');
      outs.forEach(o => md.push(`- ${String(o)}`)); md.push('');
    }
    const phases = (s.phases || []);
    if (phases.length) {
      md.push('## Sprint Breakdown'); md.push('');
      phases.forEach(p => {
        md.push(`### ${p.title || ''}${p.duration ? ` (${p.duration})` : ''}`);
        (p.deliverables || []).forEach(d => md.push(`- ${String(d)}`));
        md.push('');
      });
    }
    if (s.investment) { md.push('## Investment'); md.push(''); md.push(s.investment); md.push(''); }
    if (s.next_steps) { md.push('## Next Steps'); md.push(''); md.push(s.next_steps); md.push(''); }
  } else if (type === 'goo') {
    if (s.prepared_for) { md.push(`**Prepared for:** ${s.prepared_for}`); md.push(''); }
    if (s.date)         { md.push(`**Date:** ${s.date}`); md.push(''); }
    md.push('*This is the napkin, not the proposal — a quick check that we heard you right.*'); md.push('');
    if (s.what_we_heard) { md.push('## What We Heard'); md.push(''); md.push(s.what_we_heard); md.push(''); }
    if (s.the_goal)     { md.push('## The Goal'); md.push(''); md.push(`**${s.the_goal}**`); md.push(''); }
    const objs = (s.objectives || []);
    if (objs.length) {
      md.push('## Objectives'); md.push('');
      objs.forEach((o, i) => {
        const obj = typeof o === 'object' ? o : { title: String(o), description: '' };
        md.push(`**${i + 1}. ${obj.title || ''}**`);
        if (obj.description) md.push(obj.description);
        md.push('');
      });
    }
    const outs = (s.outcomes || []).filter(o => String(o).trim());
    if (outs.length) {
      md.push('## Outcomes'); md.push('');
      outs.forEach(o => md.push(`- ${String(o)}`)); md.push('');
    }
    if (s.what_this_is_not) { md.push('## What This Is Not'); md.push(''); md.push(s.what_this_is_not); md.push(''); }
    if (s.next_step)        { md.push('## Next Step'); md.push(''); md.push(`**${s.next_step}**`); md.push(''); }
  } else if (type === 'sow') {
    if (s.prepared_for) { md.push(`**Prepared for:** ${s.prepared_for}`); md.push(''); }
    if (s.date)         { md.push(`**Date:** ${s.date}`); md.push(''); }
    if (s.goals)   { md.push('## Project Goals'); md.push(''); md.push(s.goals); md.push(''); }
    if (s.approach){ md.push('## Approach'); md.push(''); md.push(s.approach); md.push(''); }
    const delivs = (s.deliverables || []);
    if (delivs.length) {
      md.push('## Activities + Deliverables'); md.push('');
      delivs.forEach(cat => {
        md.push(`### ${cat.category || ''}`);
        (cat.items || []).forEach(item => md.push(`- ${String(item)}`));
        md.push('');
      });
    }
    if (s.timeline || s.start_date) {
      md.push('## Timeline'); md.push('');
      if (s.timeline)    md.push(s.timeline);
      if (s.start_date)  md.push(`**Start Date:** ${s.start_date}`);
      md.push('');
    }
    if (s.cost || s.payment_schedule) {
      md.push('## Investment'); md.push('');
      if (s.cost)             md.push(`**Total:** ${s.cost}`);
      if (s.payment_schedule) md.push(s.payment_schedule);
      md.push('');
    }
    md.push('## Terms + Conditions'); md.push('');
    SOW_STANDARD_TERMS.forEach(section => {
      md.push(`### ${section.heading}`);
      section.items.forEach((item, i) => md.push(`${i + 1}. ${item}`));
      md.push('');
    });
  } else if (type === 'msa') {
    md.push(`**Client:** ${s.client_name || '[CLIENT NAME]'}`);
    md.push(`**Effective Date:** ${s.effective_date || '[DATE]'}`);
    md.push('');
    md.push('*The full MSA legal text is in the PDF export. Use that version for signatures.*');
    md.push('');
  } else if (type === 'mnda') {
    md.push(`**Counterparty:** ${s.counterparty_name || '[COUNTERPARTY]'}`);
    md.push(`**Effective Date:** ${s.effective_date || '[DATE]'}`);
    md.push(`**Purpose:** ${s.purpose || ''}`);
    md.push('');
    md.push('*The full MNDA legal text is in the PDF export. Use that version for signatures.*');
    md.push('');
  }

  md.push('---');
  md.push(`*Prepared by Part Human · ${PH_ADDR}*`);

  return md.join('\n');
}

// ── Build preview/export HTML body ────────────────────────────────────────────

function buildDocumentBody(doc, sections) {
  switch (doc.type) {
    case 'proposal': return buildProposalHtml(doc, sections);
    case 'goo':      return buildGooHtml(doc, sections);
    case 'sow':      return buildSowHtml(doc, sections);
    case 'msa':      return buildMsaHtml(doc, sections);
    case 'mnda':     return buildMndaHtml(doc, sections);
    default:         return '<p>Unknown document type.</p>';
  }
}

// ── Main DocumentEditor component ─────────────────────────────────────────────

export default function DocumentEditor({ doc: initialDoc, onClose, onSaved, dealContext, inline = false }) {
  const isNew = !initialDoc?.id;
  const [doc, setDoc]           = useState(initialDoc || { type: 'proposal', title: '', status: 'draft', sections: null });
  const [sections, setSections] = useState(initialDoc?.sections || defaultSections(initialDoc?.type || 'proposal'));
  const [tab, setTab]           = useState('edit');
  const [saving, setSaving]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saveError, setSaveError]   = useState(null);
  const [genError, setGenError]     = useState(null);
  const [deleting, setDeleting]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savingToFiles, setSavingToFiles] = useState(false);
  const [fileSaveMsg, setFileSaveMsg]     = useState(null); // {ok, text}
  const [savedFileUrl, setSavedFileUrl]     = useState(null); // URL of last company file snapshot
  const [savedFileRecord, setSavedFileRecord] = useState(null); // full company_files record for deletion

  const dt = docType(doc.type);
  const ds = docStatus(doc.status);
  const canGenerate = ['proposal', 'goo', 'sow'].includes(doc.type);

  // Fill sections from deal when creating a new MSA/MNDA
  useEffect(() => {
    if (isNew && (doc.type === 'msa' || doc.type === 'mnda') && dealContext) {
      const parsed = typeof dealContext === 'object' ? dealContext : {};
      if (doc.type === 'msa' && parsed.company_name) {
        setSections(prev => ({
          ...prev,
          client_name: parsed.company_name,
          client_address: parsed.address || '',
        }));
      }
      if (doc.type === 'mnda' && parsed.company_name) {
        setSections(prev => ({
          ...prev,
          counterparty_name: parsed.company_name,
        }));
      }
    }
  }, []);

  const handleTypeChange = newType => {
    setDoc(prev => ({ ...prev, type: newType }));
    setSections(defaultSections(newType));
  };

  const handleGenerate = async () => {
    if (!dealContext) {
      setGenError('No deal context available. Open this from a deal card to use AI generation.');
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const contextStr = typeof dealContext === 'string'
        ? dealContext
        : JSON.stringify(dealContext, null, 2);
      const result = await generateDocumentSections(doc.type, contextStr);
      // Merge AI result into current sections, preserving manually set fields
      setSections(prev => ({ ...prev, ...result }));
      setTab('edit');
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!doc.title.trim()) {
      setSaveError('Please add a document title before saving.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await upsertDocument({ ...doc, sections });
      setDoc(saved);
      onSaved?.(saved);
      // Auto-save to company files whenever a company is linked
      if (saved.company_name) {
        try {
          const bodyHtml = buildDocumentBody(saved, sections);
          const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escRaw(saved.title || 'Document')} — Part Human</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; line-height: 1.6; padding: 48px 56px; max-width: 860px; margin: 0 auto; }</style>
</head><body>${bodyHtml}</body></html>`;
          const fileRecord = await saveDocToCompanyFiles(saved.company_name, saved.title || 'document', saved.id, fullHtml);
          setSavedFileUrl(fileRecord.url || null);
          setSavedFileRecord(fileRecord);
        } catch (e) {
          // File save failure is non-blocking — doc is already saved
          console.warn('Company file auto-save failed:', e.message);
        }
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!doc.id) { onClose(); return; }
    setDeleting(true);
    try {
      await deleteDocument(doc.id);
      onSaved?.(null, doc.id); // signal deletion
      onClose();
    } catch (e) {
      setSaveError(e.message);
      setDeleting(false);
    }
  };

  const handleExportPdf = () => {
    const bodyHtml = buildDocumentBody(doc, sections);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escRaw(doc.title || 'Document')} — Part Human</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; line-height: 1.6; padding: 48px 56px; max-width: 860px; margin: 0 auto; }
  @media print { body { padding: 28px 36px; } }
</style></head><body>
${bodyHtml}
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  };

  const handleExportMarkdown = () => {
    const mdStr = buildDocumentMarkdown(doc, sections);
    const blob = new Blob([mdStr], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (doc.title || 'document').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'document';
    a.download = `${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveToCompanyFiles = async () => {
    const companyName = doc.company_name;
    if (!companyName) {
      setFileSaveMsg({ ok: false, text: 'No company linked to this document. Save the document first and make sure it has a company name.' });
      return;
    }
    setSavingToFiles(true);
    setFileSaveMsg(null);
    try {
      // Save doc first if unsaved, to get an ID
      let currentDoc = doc;
      if (!currentDoc.id) {
        if (!currentDoc.title.trim()) {
          setFileSaveMsg({ ok: false, text: 'Please save the document first (it needs a title).' });
          setSavingToFiles(false);
          return;
        }
        currentDoc = await upsertDocument({ ...currentDoc, sections });
        setDoc(currentDoc);
        onSaved?.(currentDoc);
      }
      // Build the full HTML snapshot
      const bodyHtml = buildDocumentBody(currentDoc, sections);
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${(currentDoc.title || 'Document').replace(/</g, '&lt;')} — Part Human</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; line-height: 1.6; padding: 48px 56px; max-width: 860px; margin: 0 auto; }
</style></head><body>
${bodyHtml}
</body></html>`;
      const fileRecord = await saveDocToCompanyFiles(companyName, currentDoc.title || 'document', currentDoc.id, fullHtml);
      setSavedFileUrl(fileRecord.url || null);
      setSavedFileRecord(fileRecord);
      setFileSaveMsg({ ok: true, text: `✓ Saved to ${companyName}'s company files.` });
    } catch (e) {
      setFileSaveMsg({ ok: false, text: `Failed: ${e.message}` });
    } finally {
      setSavingToFiles(false);
    }
  };

  const previewHtml = buildDocumentBody(doc, sections);

  const renderEditor = () => {
    switch (doc.type) {
      case 'proposal': return <ProposalEditor sections={sections} onChange={setSections} />;
      case 'goo':      return <GOOEditor      sections={sections} onChange={setSections} />;
      case 'sow':      return <SOWEditor      sections={sections} onChange={setSections} />;
      case 'msa':      return <MSAEditor      sections={sections} onChange={setSections} />;
      case 'mnda':     return <MNDAEditor     sections={sections} onChange={setSections} />;
      default:         return null;
    }
  };

  const editorPanel = (
    <div style={{ background: '#fff', borderRadius: inline ? 14 : 14, width: '100%', maxWidth: inline ? '100%' : 860, minHeight: inline ? 0 : '80vh', display: 'flex', flexDirection: 'column', boxShadow: inline ? '0 2px 16px rgba(0,0,0,.08)' : '0 20px 60px rgba(0,0,0,.25)', border: inline ? '1px solid #e5e7eb' : 'none' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: dt.bg, color: dt.color }}>
                {dt.icon} {dt.label}
              </span>
              {!isNew && (
                <select
                  value={doc.status}
                  onChange={e => setDoc(prev => ({ ...prev, status: e.target.value }))}
                  style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 20, border: `1px solid ${ds.color}`, color: ds.color, cursor: 'pointer', background: '#fff' }}
                >
                  {DOC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              )}
              {isNew && (
                <select
                  value={doc.type}
                  onChange={e => handleTypeChange(e.target.value)}
                  style={{ fontSize: 12, padding: '3px 8px', borderRadius: 20, border: '1px solid #e5e7eb', cursor: 'pointer' }}
                >
                  {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
                </select>
              )}
            </div>
            <input
              value={doc.title}
              onChange={e => setDoc(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Document title…"
              style={{ width: '100%', fontSize: 20, fontWeight: 700, border: 'none', outline: 'none', padding: 0, color: '#111', background: 'transparent', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {canGenerate && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: generating ? '#e5e7eb' : '#111', color: generating ? '#9ca3af' : '#fff', fontSize: 12, fontWeight: 600, cursor: generating ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {generating ? '⏳ Generating…' : '✨ Generate with AI'}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: saving ? '#e5e7eb' : '#f97316', color: saving ? '#9ca3af' : '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleExportPdf}
              title="Export PDF"
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' }}
            >
              ⬇ PDF
            </button>
            <button
              onClick={handleExportMarkdown}
              title="Download Markdown"
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' }}
            >
              ⬇ MD
            </button>
            {doc.company_name && !inline && (
              <button
                onClick={handleSaveToCompanyFiles}
                disabled={savingToFiles}
                title={`Save to ${doc.company_name}'s company profile`}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #d1fae5', background: savingToFiles ? '#f9fafb' : '#f0fdf4', color: savingToFiles ? '#9ca3af' : '#059669', fontSize: 12, fontWeight: 600, cursor: savingToFiles ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {savingToFiles ? 'Saving…' : '🏢 Save to Files'}
              </button>
            )}
            {inline && doc.company_name && savedFileUrl && (
              <span style={{ fontSize: 11, color: '#059669', fontWeight: 600, padding: '7px 6px' }}>✓ Saved to {doc.company_name}</span>
            )}
            {doc.id && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>🗑</button>
            )}
            {confirmDelete && (
              <>
                <button onClick={handleDelete} disabled={deleting} style={{ padding: '7px 10px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </>
            )}
            <button onClick={onClose} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Error banners */}
        {saveError && (
          <div style={{ margin: '12px 24px 0', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
            {saveError}
          </div>
        )}
        {genError && (
          <div style={{ margin: '12px 24px 0', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
            {genError}
          </div>
        )}
        {fileSaveMsg && (
          <div style={{ margin: '12px 24px 0', padding: '10px 14px', background: fileSaveMsg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${fileSaveMsg.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, fontSize: 13, color: fileSaveMsg.ok ? '#065f46' : '#991b1b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{fileSaveMsg.text}</span>
            <button onClick={() => setFileSaveMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit', opacity: .6, lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '8px 24px 0', borderBottom: '1px solid #f3f4f6' }}>
          {['edit', 'preview'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: '8px 8px 0 0', border: 'none', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#111' : '#9ca3af', fontWeight: tab === t ? 700 : 400, fontSize: 13, cursor: 'pointer', borderBottom: tab === t ? '2px solid #f97316' : '2px solid transparent' }}>
              {t === 'edit' ? '✏️ Edit' : '👁 Preview'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {tab === 'edit' ? (
            renderEditor()
          ) : (
            <div
              style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, lineHeight: 1.7, color: '#1a1a1a', maxWidth: 720, margin: '0 auto' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </div>

        {/* Inline rendered document — shown below editor after save */}
        {inline && savedFileUrl && (
          <div style={{ borderTop: '2px solid #f3f4f6', padding: '0' }}>
            <div style={{ padding: '12px 24px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                📄 Saved to {doc.company_name}'s Files
              </span>
              <a href={savedFileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#f97316', fontWeight: 600, textDecoration: 'none' }}>
                Open full page ↗
              </a>
            </div>
            <iframe
              src={savedFileUrl}
              title="Document preview"
              style={{ width: '100%', height: 600, border: 'none', display: 'block' }}
            />
            <div style={{ padding: '12px 24px', display: 'flex', justifyContent: 'flex-end', background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
              <button
                onClick={async () => {
                  if (!savedFileRecord) return;
                  try {
                    await deleteCompanyFile(savedFileRecord.id, savedFileRecord.storage_path);
                    setSavedFileUrl(null);
                    setSavedFileRecord(null);
                  } catch (e) { console.error('delete file:', e.message); }
                }}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 20, border: '1px solid #fecaca', background: '#fff', color: '#ef4444', cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
  );

  if (inline) return editorPanel;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      {editorPanel}
    </div>
  );
}
