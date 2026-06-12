// Express app definition (no server listen, no DB connect) so it can be used
// both by server.js locally and by the Vercel serverless entry (api/index.js).
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// Simple CORS for local dev (frontend on a different port).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api/cases', require('./routes/cases'));
app.use('/api/evidence', require('./routes/evidence'));
app.use('/api/graph', require('./routes/graph'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/events', require('./routes/events'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/assistant', require('./routes/assistant'));

app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    db: dbStates[mongoose.connection.readyState] || 'unknown',
    time: new Date().toISOString(),
  });
});

module.exports = app;
