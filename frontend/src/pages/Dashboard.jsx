import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CaseBriefing from '../components/CaseBriefing.jsx';
import RiskAssessment from '../components/RiskAssessment.jsx';

export default function Dashboard() {
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const [briefingKey, setBriefingKey] = useState(0); // bump to regenerate after uploads
  const inputRef = useRef(null);

  async function refresh() {
    try {
      const [evidence, graph, leads, events] = await Promise.all([
        api.evidence(),
        api.graph(),
        api.leads(),
        api.events(),
      ]);
      setFiles(evidence);
      setStats({
        events: events.length,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        sameOwner: graph.edges.filter((e) => e.type === 'same_owner').length,
        activeLeads: leads.filter((l) => l.status === 'active').length,
        secondLook: leads.filter((l) => l.status === 'second_look').length,
      });
      setError(null);
    } catch (err) {
      setError(`Could not reach backend: ${err.message}`);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleFiles(fileList) {
    setUploading(true);
    setError(null);
    try {
      for (const file of fileList) {
        await api.uploadEvidence(file);
      }
      await refresh();
      setBriefingKey((k) => k + 1); // new evidence → fresh briefing
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h2>Case Dashboard</h2>
      {error && <div className="error-box">{error}</div>}

      <RiskAssessment refreshKey={briefingKey} />
      <CaseBriefing refreshKey={briefingKey} />

      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onClick={() => inputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles([...e.dataTransfer.files]); }}
      >
        {uploading
          ? 'Processing… (parse → AI extraction → graph → leads)'
          : 'Drag & drop evidence files here, or click to browse (.txt WhatsApp export, .csv call records, .json Instagram DMs)'}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleFiles([...e.target.files])}
        />
      </div>

      {stats && (
        <div className="cards">
          <div className="stat-card"><div className="num">{files.length}</div><div className="lbl">Evidence files</div></div>
          <div className="stat-card"><div className="num">{stats.events}</div><div className="lbl">Events</div></div>
          <div className="stat-card"><div className="num">{stats.nodes}</div><div className="lbl">Entities (nodes)</div></div>
          <div className="stat-card"><div className="num">{stats.edges}</div><div className="lbl">Relationships (edges)</div></div>
          <div className="stat-card"><div className="num">{stats.sameOwner}</div><div className="lbl">same_owner links</div></div>
          <div className="stat-card"><div className="num">{stats.activeLeads}</div><div className="lbl">Active leads</div></div>
          <div className="stat-card"><div className="num">{stats.secondLook}</div><div className="lbl">Second-look queue</div></div>
        </div>
      )}

      <div className="panel">
        <h3>Evidence Files (chain of custody)</h3>
        <table>
          <thead>
            <tr><th>File</th><th>Source</th><th>Status</th><th>Events</th><th>Uploaded</th><th>SHA-256</th></tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f._id}>
                <td>{f.filename}</td>
                <td>{f.sourceType}</td>
                <td><span className={`chip ${f.status}`}>{f.status}</span></td>
                <td>{f.eventCount}</td>
                <td>{new Date(f.uploadedAt).toLocaleString()}</td>
                <td className="mono">{f.sha256.slice(0, 16)}…</td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr><td colSpan="6" className="loading">No evidence uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
