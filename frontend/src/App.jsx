import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import Cases from './pages/Cases.jsx';
import Dashboard from './pages/Dashboard.jsx';
import GraphView from './pages/GraphView.jsx';
import Timeline from './pages/Timeline.jsx';
import Leads from './pages/Leads.jsx';
import AuditLog from './pages/AuditLog.jsx';
import { getCurrentCase } from './api.js';

function RequireCase({ children }) {
  if (!getCurrentCase()) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const [currentCase, setCase] = useState(getCurrentCase());
  const location = useLocation();

  useEffect(() => {
    const onChange = () => setCase(getCurrentCase());
    window.addEventListener('case-changed', onChange);
    return () => window.removeEventListener('case-changed', onChange);
  }, []);

  // Re-mount case-scoped pages when the case changes so data reloads.
  const caseKey = currentCase ? currentCase._id : 'none';

  return (
    <div className="app">
      <div className="demo-banner">SYNTHETIC TRAINING DATA — DEMO CASES ONLY</div>
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Investigation Support Platform</h1>
            <span className="case-name">
              {currentCase
                ? `Open case: ${currentCase.name}${currentCase.caseNumber ? ` (${currentCase.caseNumber})` : ''}`
                : 'No case selected'}
            </span>
          </div>
          {currentCase && location.pathname !== '/' && (
            <NavLink to="/" className="switch-case">Switch case</NavLink>
          )}
        </div>
      </header>
      <div className="layout">
        <nav className="sidebar">
          <NavLink to="/" end>Cases</NavLink>
          <NavLink to="/dashboard" className={!currentCase ? 'disabled' : ''}>Dashboard</NavLink>
          <NavLink to="/graph" className={!currentCase ? 'disabled' : ''}>Graph View</NavLink>
          <NavLink to="/timeline" className={!currentCase ? 'disabled' : ''}>Timeline</NavLink>
          <NavLink to="/leads" className={!currentCase ? 'disabled' : ''}>Leads</NavLink>
          <NavLink to="/audit" className={!currentCase ? 'disabled' : ''}>Audit Log</NavLink>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<Cases />} />
            <Route path="/dashboard" element={<RequireCase><Dashboard key={caseKey} /></RequireCase>} />
            <Route path="/graph" element={<RequireCase><GraphView key={caseKey} /></RequireCase>} />
            <Route path="/timeline" element={<RequireCase><Timeline key={caseKey} /></RequireCase>} />
            <Route path="/leads" element={<RequireCase><Leads key={caseKey} /></RequireCase>} />
            <Route path="/audit" element={<RequireCase><AuditLog key={caseKey} /></RequireCase>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
