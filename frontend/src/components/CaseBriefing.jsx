import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const CONFIDENCE_LABEL = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

// Auto-generated AI intelligence summary shown at the top of the dashboard.
// `refreshKey` lets the parent force a re-fetch after new evidence is uploaded.
export default function CaseBriefing({ refreshKey }) {
  const [briefing, setBriefing] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load(refresh) {
    setBusy(true);
    setError(null);
    api.briefing(refresh)
      .then(setBriefing)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }

  useEffect(() => { load(false); }, [refreshKey]);

  if (error) {
    return (
      <div className="briefing">
        <div className="briefing-head">
          <span className="briefing-title">🧠 AI Case Briefing</span>
        </div>
        <p style={{ color: 'var(--text-dim)' }}>Could not generate briefing: {error}</p>
      </div>
    );
  }

  if (!briefing && busy) {
    return (
      <div className="briefing">
        <div className="briefing-head"><span className="briefing-title">🧠 AI Case Briefing</span></div>
        <p className="loading" style={{ padding: 0 }}>Analysing the case…</p>
      </div>
    );
  }
  if (!briefing) return null;

  const conf = briefing.confidence || 'low';

  return (
    <div className="briefing">
      <div className="briefing-head">
        <span className="briefing-title">🧠 AI Case Briefing</span>
        <span className={`conf-pill ${conf}`}>{CONFIDENCE_LABEL[conf] || conf}</span>
        <span className="briefing-engine">
          {briefing.engine === 'openai' ? 'AI model' : briefing.engine === 'rules' ? 'rule-based' : ''}
        </span>
        <button className="secondary briefing-refresh" onClick={() => load(true)} disabled={busy}>
          {busy ? 'Refreshing…' : 'Regenerate'}
        </button>
      </div>

      {briefing.headline && <p className="briefing-headline">{briefing.headline}</p>}
      {briefing.summary && <p className="briefing-summary">{briefing.summary}</p>}

      <div className="briefing-grid">
        {briefing.primeSuspect && (
          <div className="briefing-block">
            <div className="briefing-label">Prime suspect</div>
            <div className="briefing-suspect">{briefing.primeSuspect}</div>
          </div>
        )}
        {briefing.keyFindings?.length > 0 && (
          <div className="briefing-block">
            <div className="briefing-label">Key findings</div>
            <ul>{briefing.keyFindings.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
        {briefing.recommendedActions?.length > 0 && (
          <div className="briefing-block">
            <div className="briefing-label">Recommended next steps</div>
            <ul>{briefing.recommendedActions.map((a, i) => <li key={i}>▸ {a}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
