import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const LEVELS = {
  critical: { label: 'CRITICAL RISK', icon: '🔴' },
  high: { label: 'HIGH RISK', icon: '🟠' },
  moderate: { label: 'MODERATE RISK', icon: '🟡' },
  low: { label: 'LOW RISK', icon: '🟢' },
};

// Prominent victim-risk banner for the dashboard. `refreshKey` re-fetches after
// new evidence is uploaded.
export default function RiskAssessment({ refreshKey }) {
  const [risk, setRisk] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load(refresh) {
    setBusy(true);
    setError(null);
    api.risk(refresh).then(setRisk).catch((e) => setError(e.message)).finally(() => setBusy(false));
  }

  useEffect(() => { load(false); }, [refreshKey]);

  if (error) return null; // risk is supplementary — don't block the dashboard on it
  if (!risk && busy) {
    return <div className="risk-banner low"><span className="risk-level">Assessing victim risk…</span></div>;
  }
  if (!risk) return null;

  const lvl = LEVELS[risk.level] || LEVELS.low;

  return (
    <div className={`risk-banner ${risk.level}`}>
      <div className="risk-main">
        <div className="risk-level">
          <span className="risk-icon">{lvl.icon}</span>
          {lvl.label}
          {typeof risk.score === 'number' && <span className="risk-score">{risk.score}/100</span>}
        </div>
        <button className="secondary risk-refresh" onClick={() => load(true)} disabled={busy}>
          {busy ? '…' : 'Re-assess'}
        </button>
      </div>
      {risk.headline && <p className="risk-headline">{risk.headline}</p>}
      {risk.factors?.length > 0 && (
        <ul className="risk-factors">
          {risk.factors.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}
