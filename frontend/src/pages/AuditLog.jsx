import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Pagination from '../components/Pagination.jsx';

const ACTION_LABELS = {
  evidence_uploaded: 'Evidence received',
  evidence_parsed: 'Evidence parsed',
  extraction_batch: 'AI analysis',
  extraction_complete: 'AI analysis finished',
  extraction_llm_failed: 'AI fallback used',
  same_owner_hypothesis: 'Identity link proposed',
  lead_created: 'Lead created',
  lead_rescored: 'Lead re-scored',
  lead_reviewed: 'Lead reviewed',
  report_exported: 'Report exported',
  assistant_answered: 'AI assistant consulted',
};

const PAGE_SIZE = 20;

const SOURCES = ['', 'whatsapp', 'calls', 'instagram'];
// Audit entries have no sourceType field, so match the source by the keywords
// that appear in their detail text (filenames, source labels, scorer tags).
const SOURCE_PATTERNS = {
  whatsapp: /whatsapp/i,
  instagram: /instagram/i,
  calls: /call[\s_]?record|call detail|\bcalls\b|\.csv/i,
};

export default function AuditLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.audit().then(setEntries).catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    const srcRe = source ? SOURCE_PATTERNS[source] : null;
    return entries.filter((e) => {
      if (srcRe && !srcRe.test(e.detail || '')) return false;
      if (!q) return true;
      const label = ACTION_LABELS[e.action] || e.action;
      return [label, e.detail, e.actor, e.action].some((v) =>
        String(v || '').toLowerCase().includes(q)
      );
    });
  }, [entries, query, source]);

  // Reset to the first page whenever a filter or the search changes.
  useEffect(() => setPage(1), [query, source]);

  if (error) return <div className="error-box">{error}</div>;
  if (!entries) return <div className="loading">Loading audit log…</div>;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const start = (pageSafe - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <h2>Audit Log</h2>
      <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
        Every AI decision and investigator action is recorded. Nothing is deleted.
      </p>
      <div className="toolbar">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((s) => <option key={s} value={s}>{s || 'All sources'}</option>)}
        </select>
        <input
          type="search"
          className="search-input"
          placeholder="Search actions, details, actor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e._id}>
                <td className="mono">{new Date(e.timestamp).toLocaleString()}</td>
                <td><span className={`chip ${e.actor === 'ai' ? 'parsed' : 'extracted'}`}>{e.actor}</span></td>
                <td>{ACTION_LABELS[e.action] || e.action.replace(/_/g, ' ')}</td>
                <td style={{ maxWidth: 600 }}>{e.detail}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="4" className="loading">No entries match your search.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={pageSafe}
          totalPages={totalPages}
          total={filtered.length}
          onPage={setPage}
          label="entries"
        />
      </div>
    </div>
  );
}
