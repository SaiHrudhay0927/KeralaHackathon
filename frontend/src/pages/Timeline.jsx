import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Pagination from '../components/Pagination.jsx';

const SOURCES = ['', 'whatsapp', 'calls', 'instagram'];
const FLAGS = ['', 'threat', 'doxxing', 'identity_slip', 'meeting_attempt'];
const PAGE_SIZE = 25;

// Pure-computation analysis over all events — surfaces trends the per-message
// flags can't show on their own (escalation, late-night clustering, peaks).
function computePatterns(events) {
  const insights = [];
  if (!events || events.length === 0) return insights;

  const dated = events
    .filter((e) => e.timestamp)
    .map((e) => ({ ...e, t: new Date(e.timestamp) }))
    .sort((a, b) => a.t - b.t);
  const flagged = events.filter((e) => (e.flags || []).length > 0);

  if (dated.length >= 2) {
    const days = Math.max(1, Math.round((dated[dated.length - 1].t - dated[0].t) / 86400000));
    insights.push({ icon: '📅', text: `Activity spans ${days} day(s), ${dated[0].t.toLocaleDateString()} → ${dated[dated.length - 1].t.toLocaleDateString()}.` });
  }

  const catCount = {};
  for (const ev of flagged) for (const f of ev.flags) catCount[f.category] = (catCount[f.category] || 0) + 1;
  if (catCount.threat) insights.push({ icon: '⚠', tone: 'danger', text: `${catCount.threat} threatening message(s) flagged.` });
  if (catCount.meeting_attempt) insights.push({ icon: '👁', tone: 'danger', text: `${catCount.meeting_attempt} event(s) indicate physical surveillance or proximity.` });
  if (catCount.doxxing) insights.push({ icon: '📍', tone: 'warn', text: `${catCount.doxxing} doxxing event(s) exposing the victim's location/routine.` });
  if (catCount.identity_slip) insights.push({ icon: '🔀', tone: 'warn', text: `${catCount.identity_slip} identity-slip(s) — the offender revealed an alternate contact.` });

  // Escalation: average flag severity, first half vs second half (chronological).
  const flaggedDated = dated.filter((e) => (e.flags || []).length > 0);
  if (flaggedDated.length >= 4) {
    const sev = (e) => Math.max(...e.flags.map((f) => f.severity || 0));
    const avg = (arr) => arr.reduce((s, e) => s + sev(e), 0) / arr.length;
    const mid = Math.floor(flaggedDated.length / 2);
    const first = avg(flaggedDated.slice(0, mid));
    const second = avg(flaggedDated.slice(mid));
    if (second > first + 0.5) {
      insights.push({ icon: '📈', tone: 'danger', text: `Threats are escalating — average severity rose from ${first.toFixed(1)} to ${second.toFixed(1)} over time.` });
    }
  }

  const night = dated.filter((e) => e.t.getHours() < 5);
  if (night.length) insights.push({ icon: '🌙', text: `${night.length} event(s) occurred late at night (12–5 AM).` });

  const byDay = {};
  for (const e of dated) { const k = e.t.toLocaleDateString(); byDay[k] = (byDay[k] || 0) + 1; }
  const peak = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  if (peak && peak[1] >= 3) insights.push({ icon: '🔥', text: `Peak activity on ${peak[0]} (${peak[1]} events in one day).` });

  return insights;
}

export default function Timeline() {
  const [events, setEvents] = useState(null);
  const [allEvents, setAllEvents] = useState(null);
  const [source, setSource] = useState('');
  const [flag, setFlag] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = {};
    if (source) params.source = source;
    if (flag) params.flag = flag;
    api.events(params).then(setEvents).catch((e) => setError(e.message));
  }, [source, flag]);

  // Fetch the full (unfiltered) event set once for the pattern analysis.
  useEffect(() => {
    api.events().then(setAllEvents).catch(() => {});
  }, []);

  const patterns = useMemo(() => computePatterns(allEvents || []), [allEvents]);

  // Client-side search across content, participants and source reference.
  const filtered = useMemo(() => {
    if (!events) return [];
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((ev) =>
      [ev.content, ev.fromRaw, ev.toRaw, ev.sourceRef].some((v) =>
        String(v || '').toLowerCase().includes(q)
      )
    );
  }, [events, query]);

  // Reset to the first page whenever a filter or the search changes.
  useEffect(() => setPage(1), [source, flag, query]);

  if (error) return <div className="error-box">{error}</div>;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const start = (pageSafe - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <h2>Timeline</h2>

      {patterns.length > 0 && (
        <div className="panel analysis-panel">
          <h3>🧠 Pattern Analysis</h3>
          <div className="insight-list">
            {patterns.map((p, i) => (
              <div key={i} className={`insight ${p.tone || ''}`}>
                <span className="insight-icon">{p.icon}</span>
                <span>{p.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((s) => <option key={s} value={s}>{s || 'All sources'}</option>)}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)}>
          {FLAGS.map((f) => <option key={f} value={f}>{f ? f.replace('_', ' ') : 'All flags'}</option>)}
        </select>
        <input
          type="search"
          className="search-input"
          placeholder="Search content, sender, source…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!events ? (
        <div className="loading">Loading events…</div>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr><th>Time</th><th>Type</th><th>From → To</th><th>Content</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev._id} onClick={() => setOpen(open === ev._id ? null : ev._id)} style={{ cursor: 'pointer' }}>
                  <td className="mono">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}</td>
                  <td>{ev.type}</td>
                  <td>{ev.fromRaw}{ev.toRaw ? ` → ${ev.toRaw}` : ''}</td>
                  <td>
                    {open === ev._id ? (
                      <div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{ev.content}</div>
                        <div className="mono" style={{ marginTop: 6 }}>source: {ev.sourceRef}</div>
                        {ev.flags.map((f, i) => (
                          <div key={i} className="mono" style={{ marginTop: 4, color: 'var(--warn)' }}>
                            {f.category} (severity {f.severity}): {f.reason}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span>{ev.content.length > 80 ? `${ev.content.slice(0, 80)}…` : ev.content}</span>
                    )}
                  </td>
                  <td>
                    {ev.flags.map((f, i) => (
                      <span key={i} className={`badge ${f.category}`}>
                        {f.category.replace('_', ' ')} {f.severity}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="5" className="loading">No events match these filters.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination
            page={pageSafe}
            totalPages={totalPages}
            total={filtered.length}
            onPage={setPage}
            label="events"
          />
        </div>
      )}
    </div>
  );
}
