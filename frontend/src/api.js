const BASE = '/api';

// --- current case selection (persisted across reloads) ---
export function getCurrentCase() {
  try {
    return JSON.parse(localStorage.getItem('currentCase'));
  } catch {
    return null;
  }
}

export function setCurrentCase(c) {
  if (c) localStorage.setItem('currentCase', JSON.stringify({ _id: c._id, name: c.name, caseNumber: c.caseNumber }));
  else localStorage.removeItem('currentCase');
  window.dispatchEvent(new Event('case-changed'));
}

function caseId() {
  const c = getCurrentCase();
  return c ? c._id : null;
}

function withCase(path) {
  const id = caseId();
  if (!id) return path;
  return `${path}${path.includes('?') ? '&' : '?'}caseId=${id}`;
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => request('/health'),

  cases: () => request('/cases'),
  createCase: (data) =>
    request('/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateCase: (id, data) =>
    request(`/cases/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  evidence: () => request(withCase('/evidence')),
  uploadEvidence: (file) => {
    const form = new FormData();
    form.append('file', file);
    form.append('caseId', caseId() || '');
    return request('/evidence/upload', { method: 'POST', body: form });
  },
  graph: () => request(withCase('/graph')),
  events: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(withCase(`/events${q ? `?${q}` : ''}`));
  },
  leads: (status) => request(withCase(`/leads${status ? `?status=${status}` : ''}`)),
  reviewLead: (id, status) =>
    request(`/leads/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  rescoreLeads: () =>
    request('/leads/rescore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: caseId() }),
    }),
  audit: () => request(withCase('/audit')),
  askAssistant: (question) =>
    request('/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, caseId: caseId() }),
    }),
};
