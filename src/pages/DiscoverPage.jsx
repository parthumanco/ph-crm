import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { discoverCompanies } from '../lib/anthropic';

const FUNDING_OPTIONS = [
  { value: '', label: 'Any Stage' },
  { value: 'Seed', label: 'Seed' },
  { value: 'Series A', label: 'Series A' },
  { value: 'Series B', label: 'Series B' },
  { value: 'Series C+', label: 'Series C+' },
];

const EMPLOYEE_OPTIONS = [
  { value: '', label: 'Any Size' },
  { value: '1-30', label: '1–30' },
  { value: '30-100', label: '30–100' },
  { value: '100-500', label: '100–500' },
  { value: '500+', label: '500+' },
];

const FUNDING_STAGE_COLORS = {
  'Seed': '#10b981',
  'Series A': '#3b82f6',
  'Series B': '#8b5cf6',
  'Series C': '#f59e0b',
  'Series D+': '#ef4444',
  'Unknown': '#94a3b8',
};

function fundingColor(stage) {
  if (!stage) return '#94a3b8';
  for (const [key, color] of Object.entries(FUNDING_STAGE_COLORS)) {
    if (stage.startsWith(key)) return color;
  }
  return '#94a3b8';
}

export default function DiscoverPage({ icp }) {
  const [criteria, setCriteria] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [fundingFilter, setFundingFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [addedNames, setAddedNames] = useState(new Set());
  const [existingNames, setExistingNames] = useState(new Set());
  const [successMsg, setSuccessMsg] = useState('');

  // Load existing company names from Supabase on mount
  useEffect(() => {
    async function loadExisting() {
      const { data, error } = await supabase
        .from('companies')
        .select('name');
      if (error) return;
      setExistingNames(new Set((data || []).map(c => c.name?.toLowerCase().trim())));
    }
    loadExisting();
  }, []);

  function buildFullCriteria() {
    let parts = [criteria.trim()];
    if (locationFilter.trim()) parts.push(`Location: ${locationFilter.trim()}`);
    if (fundingFilter) parts.push(`Funding stage: ${fundingFilter}`);
    if (employeeFilter) parts.push(`Employee count range: ${employeeFilter}`);
    return parts.filter(Boolean).join('\n');
  }

  async function handleSearch(e) {
    e.preventDefault();
    const full = buildFullCriteria();
    if (!full.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    setAddedNames(new Set());
    setSuccessMsg('');
    try {
      const companies = await discoverCompanies(full, icp);
      const filtered = companies.filter(c => !existingNames.has(c.name?.toLowerCase().trim()));
      setResults(filtered);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function isExisting(company) {
    return existingNames.has(company.name?.toLowerCase().trim());
  }

  function isAdded(company) {
    return addedNames.has(company.name?.toLowerCase().trim());
  }

  function toggleSelect(idx) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleSelectAll() {
    const eligible = results
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !isExisting(c) && !isAdded(c))
      .map(({ i }) => i);

    if (eligible.every(i => selected.has(i))) {
      // Deselect all eligible
      setSelected(prev => {
        const next = new Set(prev);
        eligible.forEach(i => next.delete(i));
        return next;
      });
    } else {
      // Select all eligible
      setSelected(prev => {
        const next = new Set(prev);
        eligible.forEach(i => next.add(i));
        return next;
      });
    }
  }

  const eligibleCount = results.filter((c, i) => !isExisting(c) && !isAdded(c)).length;
  const allEligibleSelected = eligibleCount > 0 &&
    results
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !isExisting(c) && !isAdded(c))
      .every(({ i }) => selected.has(i));

  async function handleAddSelected() {
    if (selected.size === 0) return;
    setAdding(true);
    setSuccessMsg('');
    const toAdd = [...selected].map(i => results[i]).filter(Boolean);
    const rows = toAdd.map(c => ({
      name: c.name,
      website: c.website || null,
      hq: c.hq || null,
    }));

    const { error } = await supabase.from('companies').insert(rows);
    if (error) {
      setError('Failed to add companies: ' + error.message);
      setAdding(false);
      return;
    }

    const newAdded = new Set(addedNames);
    const newExisting = new Set(existingNames);
    toAdd.forEach(c => {
      const key = c.name?.toLowerCase().trim();
      newAdded.add(key);
      newExisting.add(key);
    });
    setAddedNames(newAdded);
    setExistingNames(newExisting);
    setSelected(new Set());
    setSuccessMsg(`${toAdd.length} ${toAdd.length === 1 ? 'company' : 'companies'} added to Signal Watch.`);
    setAdding(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 860, margin: '0 auto' }}>

      {/* Search form */}
      <div className="stat-card" style={{ padding: '24px 28px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, color: 'var(--text)', fontSize: 14 }}>
              What are you looking for?
            </label>
            <textarea
              rows={3}
              value={criteria}
              onChange={e => setCriteria(e.target.value)}
              placeholder="e.g. Series B SaaS companies in Boston that recently hired a new CMO"
              style={{
                width: '100%',
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 14,
                fontFamily: 'inherit',
                lineHeight: 1.5,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Filter row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px', minWidth: 140 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                Location
              </label>
              <input
                type="text"
                value={locationFilter}
                onChange={e => setLocationFilter(e.target.value)}
                placeholder="e.g. New England"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 130px', minWidth: 120 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                Funding Stage
              </label>
              <select
                value={fundingFilter}
                onChange={e => setFundingFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              >
                {FUNDING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 130px', minWidth: 120 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                Employee Count
              </label>
              <select
                value={employeeFilter}
                onChange={e => setEmployeeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              >
                {EMPLOYEE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !criteria.trim()}
            style={{ width: '100%', fontSize: 15, padding: '11px 0' }}
          >
            {loading ? 'Searching…' : '🔍 Find Companies'}
          </button>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            Claude will suggest up to 100 companies based on your ICP and search criteria
          </p>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
          padding: '12px 16px', color: '#b91c1c', fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <div style={{
            width: 20, height: 20, border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          Claude is thinking…
        </div>
      )}

      {/* Results */}
      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={allEligibleSelected}
                onChange={toggleSelectAll}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              Select All
            </label>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', flex: 1 }}>
              {results.length} new companies found (already-watched companies excluded)
              {selected.size > 0 && <> &bull; <strong style={{ color: 'var(--text)' }}>{selected.size} selected</strong></>}
            </span>

            {successMsg && (
              <span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
                ✓ {successMsg}
              </span>
            )}

            <button
              onClick={handleAddSelected}
              disabled={selected.size === 0 || adding}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: selected.size > 0 ? 'var(--green, #10b981)' : 'var(--border)',
                color: selected.size > 0 ? '#fff' : 'var(--text-muted)',
                fontWeight: 600, fontSize: 14, cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              {adding ? 'Adding…' : `➕ Add Selected to Signal Watch`}
            </button>
          </div>

          {/* Company cards */}
          {results.map((company, idx) => {
            const alreadyIn = isExisting(company) && !isAdded(company);
            const justAdded = isAdded(company);
            const disabled = alreadyIn || justAdded;
            const isChecked = selected.has(idx);

            return (
              <div
                key={idx}
                className="stat-card"
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                  opacity: disabled ? 0.75 : 1,
                  transition: 'box-shadow 0.15s',
                  cursor: disabled ? 'default' : 'pointer',
                  outline: isChecked ? '2px solid var(--green, #10b981)' : undefined,
                }}
                onClick={() => { if (!disabled) toggleSelect(idx); }}
              >
                {/* Checkbox */}
                <div style={{ paddingTop: 2, flexShrink: 0 }}>
                  {disabled ? (
                    <span style={{
                      display: 'inline-block', width: 16, height: 16,
                      borderRadius: 4, background: justAdded ? '#10b981' : 'var(--border)',
                      color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center',
                    }}>
                      {justAdded ? '✓' : '–'}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(idx)}
                      onClick={e => e.stopPropagation()}
                      style={{ width: 16, height: 16, cursor: 'pointer', marginTop: 1 }}
                    />
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Name + badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                      {company.name}
                    </span>

                    {company.fundingStage && company.fundingStage !== 'Unknown' && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: fundingColor(company.fundingStage) + '20',
                        color: fundingColor(company.fundingStage),
                        border: `1px solid ${fundingColor(company.fundingStage)}40`,
                      }}>
                        {company.fundingStage}
                      </span>
                    )}

                    {company.employeeCount && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        👥 {company.employeeCount.toLocaleString()}
                      </span>
                    )}

                    {alreadyIn && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1',
                      }}>
                        Already in list
                      </span>
                    )}

                    {justAdded && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: '#d1fae5', color: '#059669', border: '1px solid #6ee7b7',
                      }}>
                        Added ✓
                      </span>
                    )}
                  </div>

                  {/* Website + HQ row */}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
                    {company.website && (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}
                      >
                        {company.website.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                    {company.hq && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        📍 {company.hq}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  {company.description && (
                    <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {company.description}
                    </p>
                  )}

                  {/* Why it fits */}
                  {company.whyItFits && (
                    <div style={{
                      padding: '7px 12px',
                      borderRadius: 6,
                      background: 'var(--green-light, #ecfdf5)',
                      border: '1px solid var(--green-border, #a7f3d0)',
                      fontSize: 13,
                      color: '#065f46',
                      lineHeight: 1.5,
                    }}>
                      <span style={{ fontWeight: 600, marginRight: 4 }}>Why it fits:</span>
                      {company.whyItFits}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Bottom add button */}
          {selected.size > 0 && (
            <div style={{ paddingTop: 4, textAlign: 'right' }}>
              <button
                onClick={handleAddSelected}
                disabled={adding}
                style={{
                  padding: '10px 24px', borderRadius: 8, border: 'none',
                  background: 'var(--green, #10b981)', color: '#fff',
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                {adding ? 'Adding…' : `➕ Add ${selected.size} to Signal Watch`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          color: 'var(--text-muted)', fontSize: 15,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧭</div>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>Describe your ideal prospect</div>
          <div style={{ maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
            Tell Claude what kind of companies you're looking for and it will suggest real prospects that match your ICP.
          </div>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
