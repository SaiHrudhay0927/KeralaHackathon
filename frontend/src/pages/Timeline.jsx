import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const SOURCES = ['', 'whatsapp', 'calls', 'instagram'];
const FLAGS = ['', 'threat', 'doxxing', 'identity_slip', 'meeting_attempt'];

export default function Timeline() {
  const [events, setEvents] = useState(null);
  const [source, setSource] = useState('');
  const [flag, setFlag] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = {};
    if (source) params.source = source;
    if (flag) params.flag = flag;
    api.events(params).then(setEvents).catch((e) => setError(e.message));
  }, [source, flag]);

  if (error) return <div className="error-box">{error}</div>;

  return (
    <div>
      <h2>Timeline</h2>
      <div className="toolbar">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((s) => <option key={s} value={s}>{s || 'All sources'}</option>)}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)}>
          {FLAGS.map((f) => <option key={f} value={f}>{f ? f.replace('_', ' ') : 'All flags'}</option>)}
        </select>
        {events && <span className="mono">{events.length} events</span>}
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
              {events.map((ev) => (
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
                          <div key={i} className="mono" style={{ marginTop: 4, color: '#fbbf24' }}>
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
              {events.length === 0 && (
                <tr><td colSpan="5" className="loading">No events match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
