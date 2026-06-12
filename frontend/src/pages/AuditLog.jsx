import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

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

export default function AuditLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.audit().then(setEntries).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!entries) return <div className="loading">Loading audit log…</div>;

  return (
    <div>
      <h2>Audit Log</h2>
      <p style={{ color: '#94a3b8', marginBottom: 16 }}>
        Every AI decision and investigator action is recorded. Nothing is deleted.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e._id}>
                <td className="mono">{new Date(e.timestamp).toLocaleString()}</td>
                <td><span className={`chip ${e.actor === 'ai' ? 'parsed' : 'extracted'}`}>{e.actor}</span></td>
                <td>{ACTION_LABELS[e.action] || e.action.replace(/_/g, ' ')}</td>
                <td style={{ maxWidth: 600 }}>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
