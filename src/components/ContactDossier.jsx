const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Read-only dossier body, shared by ContactsPanel, Old Gold, and the Pipeline
// (DealDetailModal) Contacts tab — same contact object shape everywhere
// (companies.contacts), so the same renderer works in all three places.
export default function ContactDossier({ contact: c }) {
  const isEnriched = !!(c.enriched_at || c.job_history?.length || c.education?.length || c.posts?.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {c.bio_summary && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Bio</div>
          <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.65 }}>{c.bio_summary}</p>
        </div>
      )}

      {(c.job_history || []).length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Career History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {c.job_history.map((j, ji) => (
              <div key={ji} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: j.is_current ? 'var(--accent)' : 'var(--border)', marginTop: 5, flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{j.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> · {j.company}</span>
                  {(j.from || j.to) && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>{j.from}{j.to ? ` – ${j.to}` : j.is_current ? ' – present' : ''}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(c.education || []).length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Education</div>
          {c.education.map((e, ei) => (
            <div key={ei} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 3 }}>
              {e.school}{e.degree ? ` — ${e.degree}` : ''}{e.years ? ` (${e.years})` : ''}
            </div>
          ))}
        </div>
      )}

      {(c.posts || []).length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Recent Posts & Activity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {c.posts.map((p, pi) => (
              <div key={pi} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: p.platform === 'linkedin' ? '#e0f2fe' : '#f0f9ff', color: p.platform === 'linkedin' ? '#0369a1' : '#0284c7' }}>{p.platform}</span>
                  {p.date && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.date}</span>}
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 'auto' }}>↗</a>}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{p.headline}</div>
                {p.summary && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.summary}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {(c.articles_talks || []).length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Articles & Talks</div>
          {c.articles_talks.map((a, ai) => (
            <div key={ai} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 5 }}>
              {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>{a.title}</a> : <span style={{ fontWeight: 600 }}>{a.title}</span>}
              {a.outlet && <span style={{ color: 'var(--text-muted)' }}> · {a.outlet}</span>}
              {a.date   && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> ({a.date})</span>}
            </div>
          ))}
        </div>
      )}

      {((c.interests || []).length > 0 || (c.fun_facts || []).length > 0) && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Interests & Background</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...(c.interests || []), ...(c.fun_facts || [])].map((item, ii) => (
              <span key={ii} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{item}</span>
            ))}
          </div>
        </div>
      )}

      {!isEnriched && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '8px 0' }}>
          No dossier data yet. Click <strong>Build Dossier</strong> to run a deep search on this person.
        </div>
      )}

      {c.enriched_at && <div style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'right' }}>Enriched {fmtDate(c.enriched_at)}</div>}
    </div>
  );
}
