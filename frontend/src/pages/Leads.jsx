import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Leads() {
  const [leads, setLeads] = useState(null);
  const [tab, setTab] = useState('active');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setLeads(await api.leads());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function rescore() {
    setBusy(true);
    try {
      await api.rescoreLeads();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function markReviewed(id) {
    await api.reviewLead(id, 'reviewed');
    await refresh();
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!leads) return <div className="loading">Loading leads…</div>;

  const shown = leads.filter((l) =>
    tab === 'active' ? l.status === 'active' : tab === 'second_look' ? l.status === 'second_look' : l.status === 'reviewed'
  );

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Leads</h2>
        <button onClick={rescore} disabled={busy}>{busy ? 'Rescoring…' : 'Rescore all'}</button>
      </div>

      <div className="tabs">
        <button className={tab === 'active' ? 'on' : ''} onClick={() => setTab('active')}>
          Active ({leads.filter((l) => l.status === 'active').length})
        </button>
        <button className={tab === 'second_look' ? 'on' : ''} onClick={() => setTab('second_look')}>
          Second-Look Queue ({leads.filter((l) => l.status === 'second_look').length})
        </button>
        <button className={tab === 'reviewed' ? 'on' : ''} onClick={() => setTab('reviewed')}>
          Reviewed ({leads.filter((l) => l.status === 'reviewed').length})
        </button>
      </div>

      {shown.map((lead) => (
        <div key={lead._id} className={`panel lead-card ${lead.status === 'second_look' ? 'second' : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <h3>{lead.title}</h3>
              <p style={{ color: '#94a3b8', marginTop: 4 }}>{lead.description}</p>
              <div style={{ marginTop: 10 }}>
                {lead.supportingEvidence.map((ref) => (
                  <div key={ref} className="mono evref">{ref}</div>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 150 }}>
              <div className="lead-score">{lead.score}</div>
              <span className={`chip ${lead.status}`}>{lead.status.replace('_', ' ')}</span>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lead.status !== 'reviewed' && (
                  <button className="secondary" onClick={() => markReviewed(lead._id)}>Mark reviewed</button>
                )}
                <button
                  className="secondary"
                  title="PDF report with Section 65B certificate — milestone 8"
                  onClick={() => window.open(`/api/reports/lead/${lead._id}`, '_blank')}
                >
                  Export Report (PDF)
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
      {shown.length === 0 && <div className="loading">No leads in this tab.</div>}
    </div>
  );
}
