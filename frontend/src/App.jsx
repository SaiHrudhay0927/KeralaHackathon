import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import Cases from './pages/Cases.jsx';
import Dashboard from './pages/Dashboard.jsx';
import GraphView from './pages/GraphView.jsx';
import Timeline from './pages/Timeline.jsx';
import Leads from './pages/Leads.jsx';
import AuditLog from './pages/AuditLog.jsx';
import AskAI from './components/AskAI.jsx';
import Logo from './components/Logo.jsx';
import { getCurrentCase, setCurrentCase } from './api.js';

function RequireCase({ children }) {
  if (!getCurrentCase()) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  // Every fresh load starts with no case open, so the app lands on the Cases
  // list and the case-scoped nav (Dashboard, Graph, etc.) only appears after
  // the investigator explicitly opens a case. (Clears any case persisted from
  // a previous session before the first render, so RequireCase sees it too.)
  const [currentCase, setCase] = useState(() => {
    setCurrentCase(null);
    return null;
  });
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const location = useLocation();

  useEffect(() => {
    const onChange = () => setCase(getCurrentCase());
    window.addEventListener('case-changed', onChange);
    return () => window.removeEventListener('case-changed', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Re-mount case-scoped pages when the case changes so data reloads.
  const caseKey = currentCase ? currentCase._id : 'none';

  return (
    <div className="app">
      <div className="demo-banner">SYNTHETIC TRAINING DATA — DEMO CASES ONLY</div>
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>
              <Logo className="logo-eye" size={24} /> Sakshi
            </h1>
            <span className="case-name">
              {currentCase
                ? `Open case: ${currentCase.name}${currentCase.caseNumber ? ` (${currentCase.caseNumber})` : ''}`
                : 'No case selected'}
            </span>
          </div>
          <div className="header-actions">
            {currentCase && location.pathname !== '/' && (
              <NavLink to="/" className="switch-case">Switch case</NavLink>
            )}
            <button className="secondary theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
          </div>
        </div>
      </header>
      <div className="layout">
        <nav className="sidebar">
          {currentCase ? (
            <>
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/graph">Graph View</NavLink>
              <NavLink to="/timeline">Timeline</NavLink>
              <NavLink to="/leads">Leads</NavLink>
            </>
          ) : (
            <NavLink to="/" end>Cases</NavLink>
          )}
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
      {currentCase && <AskAI key={caseKey} />}
    </div>
  );
}
