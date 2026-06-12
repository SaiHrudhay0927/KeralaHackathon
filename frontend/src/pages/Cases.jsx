import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getCurrentCase, setCurrentCase } from '../api.js';

const EMPTY_FORM = { name: '', caseNumber: '', description: '' };

export default function Cases() {
  const [cases, setCases] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [uploadingId, setUploadingId] = useState(null);
  const uploadInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const navigate = useNavigate();
  const current = getCurrentCase();

  async function refresh() {
    try {
      setCases(await api.cases());
      setError(null);
    } catch (e) {
      setError(`Could not reach backend: ${e.message}`);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function createCase(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const c = await api.createCase(form);
      setForm(EMPTY_FORM);
      await refresh();
      openCase(c);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function openCase(c) {
    setCurrentCase(c);
    navigate('/dashboard');
  }

  function startUpload(c) {
    uploadTargetRef.current = c;
    uploadInputRef.current.click();
  }

  async function handleUploadFiles(fileList) {
    const target = uploadTargetRef.current;
    if (!target || fileList.length === 0) return;
    setCurrentCase(target); // uploads are scoped to the selected case
    setUploadingId(target._id);
    setError(null);
    try {
      for (const file of fileList) {
        await api.uploadEvidence(file); // runs the full AI pipeline per file
      }
      navigate('/dashboard');
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
      await refresh();
    } finally {
      setUploadingId(null);
      uploadInputRef.current.value = '';
    }
  }

  function startEdit(c) {
    setEditingId(c._id);
    setEditForm({ name: c.name, caseNumber: c.caseNumber, description: c.description, status: c.status });
  }

  async function saveEdit(id) {
    try {
      const updated = await api.updateCase(id, editForm);
      if (current && current._id === id) setCurrentCase(updated);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !cases) return <div className="error-box">{error}</div>;
  if (!cases) return <div className="loading">Loading cases…</div>;

  return (
    <div>
      <h2>Cases</h2>
      {error && <div className="error-box">{error}</div>}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => handleUploadFiles([...e.target.files])}
      />

      <div className="panel">
        <h3>Create a new case</h3>
        <form onSubmit={createCase} className="case-form">
          <input
            placeholder="Case name (required), e.g. Cyberstalking — Minor Victim, Kochi"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Case / FIR number (optional), e.g. 2026-CYB-014"
            value={form.caseNumber}
            onChange={(e) => setForm({ ...form, caseNumber: e.target.value })}
          />
          <textarea
            placeholder="Description (optional)"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <button type="submit" disabled={creating || !form.name.trim()}>
            {creating ? 'Creating…' : 'Create case'}
          </button>
        </form>
      </div>

      {cases.length === 0 && (
        <div className="loading">No cases yet — create your first case above.</div>
      )}

      {cases.map((c) => (
        <div key={c._id} className={`panel case-card ${current && current._id === c._id ? 'current' : ''}`}>
          {editingId === c._id ? (
            <div className="case-form">
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <input value={editForm.caseNumber} onChange={(e) => setEditForm({ ...editForm, caseNumber: e.target.value })} placeholder="Case / FIR number" />
              <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description" />
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="open">open</option>
                <option value="closed">closed</option>
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => saveEdit(c._id)}>Save</button>
                <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <div>
                <h3>
                  {c.name}{' '}
                  {c.caseNumber && <span className="mono">({c.caseNumber})</span>}{' '}
                  <span className={`chip ${c.status === 'open' ? 'active' : 'uploaded'}`}>{c.status}</span>
                  {current && current._id === c._id && <span className="chip parsed" style={{ marginLeft: 6 }}>currently open</span>}
                </h3>
                {c.description && <p style={{ color: '#94a3b8', marginTop: 4 }}>{c.description}</p>}
                <p className="mono" style={{ marginTop: 6 }}>
                  {c.stats.files} evidence file(s) · {c.stats.events} events · {c.stats.activeLeads} active lead(s) · created {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                <button onClick={() => openCase(c)}>Open case</button>
                <button className="secondary" onClick={() => startUpload(c)} disabled={uploadingId !== null}>
                  {uploadingId === c._id ? 'Analysing…' : 'Upload evidence'}
                </button>
                <button className="secondary" onClick={() => startEdit(c)}>Edit</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
