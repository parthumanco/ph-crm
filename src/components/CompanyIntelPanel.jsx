// Shared "company intelligence" rendering — ICP/score cards, summary, recommended
// angle, signal triggers, contact angles, and the full thesis (with entry contact,
// risks, next step, source materials). Used by ClientsPage's Overview tab and
// ProjectsPage's Research tab so the two stay pixel-identical instead of drifting
// apart as separate copies.

const TRIGGER_CATS = {
  leadership: { label: 'Leadership Change', color: '#f59e0b' },
  funding:    { label: 'Funding / M&A',     color: '#10b981' },
  expansion:  { label: 'Expansion',         color: '#3b82f6' },
  product:    { label: 'Product Launch',    color: '#8b5cf6' },
  pain:       { label: 'Challenge',         color: '#ef4444' },
  hiring:     { label: 'Hiring',            color: '#06b6d4' },
  social:     { label: 'Social Signal',     color: '#ec4899' },
};
const catColor = id => TRIGGER_CATS[id]?.color || '#94a3b8';
const catLabel = id => TRIGGER_CATS[id]?.label || id;
const scoreColor = s => s >= 7 ? '#10b981' : s >= 4 ? '#f59e0b' : '#ef4444';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Compact "mm/dd/yy" formatter for "Last scanned" labels next to scan/thesis actions.
export function ddmyy(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`;
}

/**
 * @param {object} intel - the companies-table row (icp_score, summary, triggers, thesis, etc.)
 * @param {array} extraSources - additional {title,url} items (e.g. client_items) to merge into "Source Materials Used"
 * @param {string} emptyMessage - shown when `intel` is null/undefined
 */
export default function CompanyIntelPanel({ intel, extraSources = [], emptyMessage }) {
  if (!intel) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
        <div style={{ fontSize: 13 }}>{emptyMessage || 'No intelligence data yet.'}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      {/* Score + meta row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {[
          intel.icp_score     != null && { label: 'ICP Score',    value: `${intel.icp_score}/10`,     color: scoreColor(intel.icp_score) },
          intel.overall_score != null && { label: 'Overall Score', value: `${intel.overall_score}/10`, color: scoreColor(intel.overall_score) },
          intel.icp_tier              && { label: 'Tier',          value: intel.icp_tier },
          intel.funding_stage         && { label: 'Funding',       value: intel.funding_stage },
          intel.employee_count        && { label: 'Employees',     value: intel.employee_count },
          intel.engagement_type       && { label: 'Engagement',    value: intel.engagement_type },
          intel.hq                    && { label: 'HQ',            value: intel.hq },
          intel.industry              && { label: 'Industry',      value: intel.industry },
        ].filter(Boolean).map((item, i) => (
          <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: item.color || 'var(--text)' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* AI Summary */}
      {intel.summary && (
        <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Summary</div>
            {intel.scan_date && <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>Last scanned: {ddmyy(intel.scan_date)}</span>}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.7 }}>{intel.summary}</p>
        </div>
      )}

      {/* Recommended angle */}
      {intel.recommended_angle && (
        <div style={{ padding: '14px 16px', background: '#fefce8', borderRadius: 10, border: '1px solid #fef08a' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#a16207', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Recommended Angle</div>
          <p style={{ fontSize: 13, color: '#78350f', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>"{intel.recommended_angle}"</p>
        </div>
      )}

      {/* Triggers */}
      {(intel.triggers || []).length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Signal Triggers ({intel.triggers.length})</div>
            {intel.scan_date && <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>Last scanned: {ddmyy(intel.scan_date)}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {intel.triggers.map((tr, i) => {
              let t = tr;
              if (typeof tr === 'string') {
                try { t = JSON.parse(tr); } catch { t = { detail: tr }; }
              }
              const link = t.url || (typeof t.source === 'string' && /^https?:\/\//.test(t.source) ? t.source : null);
              return (
                <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)', borderLeft: `3px solid ${catColor(t.category)}` }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: catColor(t.category) + '22', color: catColor(t.category) }}>{catLabel(t.category)}</span>
                    {t.urgency === 'high' && <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444' }}>↑ High</span>}
                    {t.date && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>{t.date}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{t.headline || t.title || t.text}</div>
                  {t.detail && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.detail}</div>}
                  {(t.source || link) && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {t.source && <span>Source: {t.source}</span>}
                      {link && <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>↗ View source</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Contacts — companies.contacts (the shared roster also shown on Watch
          List/Old Gold/Pipeline) merged with contact_angles for angle/hook text */}
      {(() => {
        const merged = new Map();
        (intel.contacts || []).forEach(c => {
          if (!c.name?.trim()) return;
          merged.set(c.name.trim().toLowerCase(), { name: c.name.trim(), title: c.title || '' });
        });
        (intel.contact_angles || []).forEach(ca => {
          if (!ca.name?.trim()) return;
          const key = ca.name.trim().toLowerCase();
          const existing = merged.get(key) || { name: ca.name.trim(), title: ca.title || '' };
          merged.set(key, { ...existing, angle: ca.angle, hook: ca.hook });
        });
        const list = Array.from(merged.values());
        if (!list.length) return null;
        return (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Contacts</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((ca, i) => (
                <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: ca.angle ? 3 : 0 }}>{ca.name} {ca.title ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {ca.title}</span> : null}</div>
                  {ca.angle && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>"{ca.angle}"</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Full Thesis (only if thesis_built) ── */}
      {intel.thesis_built && intel.thesis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '2px solid var(--accent)', paddingTop: 20, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🧠 Full Thesis</span>
            {intel.thesis_date && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Built {fmtDate(intel.thesis_date.slice(0,10))}</span>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
            {intel.thesis}
          </div>
          {/* Entry contact — prefer the shared contacts roster's primary (kept
              up to date by Watch List/Old Gold/Pipeline), fall back to the
              thesis-derived contact_angles primary if no contacts exist yet */}
          {(() => {
            const primaryContact = (intel.contacts || []).find(c => c.is_primary);
            const matchingAngle = primaryContact && (intel.contact_angles || []).find(ca => ca.name?.trim().toLowerCase() === primaryContact.name?.trim().toLowerCase());
            const entry = primaryContact
              ? { name: primaryContact.name, title: primaryContact.title, linkedin: primaryContact.linkedin, angle: matchingAngle?.angle, hook: matchingAngle?.hook }
              : (intel.contact_angles || []).find(ca => ca.is_primary);
            if (!entry) return null;
            return (
              <div style={{ padding: '14px 16px', background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Primary Entry Point</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{entry.name} {entry.title && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {entry.title}</span>}</div>
                {entry.linkedin && <a href={entry.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0077b5', textDecoration: 'none', display: 'block', marginTop: 2 }}>↗ LinkedIn</a>}
                {entry.angle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5, fontStyle: 'italic' }}>"{entry.angle}"</div>}
                {entry.hook && <div style={{ fontSize: 12, color: '#059669', marginTop: 6, lineHeight: 1.5 }}>Hook: {entry.hook}</div>}
              </div>
            );
          })()}
          {/* Risks */}
          {(intel.thesis_risks || []).length > 0 && (
            <div style={{ padding: '12px 16px', background: '#fff7ed', borderRadius: 9, border: '1px solid #fed7aa' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Risks & Sensitivities</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {intel.thesis_risks.map((r, i) => <li key={i} style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>{typeof r === 'string' ? r : r.risk || r.label || JSON.stringify(r)}</li>)}
              </ul>
            </div>
          )}
          {/* Next step */}
          {intel.thesis_next_step && (
            <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Recommended Next Step</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{intel.thesis_next_step}</div>
            </div>
          )}
          {/* Source materials — the human-attached links/notes the AI was actually given to write this thesis from */}
          {(() => {
            const sources = [
              ...(intel.research_items || []).filter(it => it.url),
              ...(extraSources || []).filter(it => it.url),
            ];
            if (!sources.length) return null;
            return (
              <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Source Materials Used</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sources.map((it, i) => (
                    <a key={i} href={it.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                      ↗ {it.title || it.url}
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Scan date footer */}
      {intel.scan_date && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
          Last scanned {fmtDate(intel.scan_date.slice(0,10))} · {intel.thesis_built ? 'Full thesis ✓' : intel.deep_scanned ? 'Deep scan ✓' : 'Surface scan only'}
        </div>
      )}
    </div>
  );
}
