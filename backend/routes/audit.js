const express = require('express');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

// GET /api/audit?caseId=
router.get('/', async (req, res) => {
  const filter = req.query.caseId ? { caseId: req.query.caseId } : {};
  const entries = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(500);
  res.json(entries);
});

module.exports = router;
