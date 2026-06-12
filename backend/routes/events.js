const express = require('express');
const Event = require('../models/Event');
const EvidenceFile = require('../models/EvidenceFile');

const router = express.Router();

// GET /api/events?source=whatsapp|calls|instagram&flag=threat|doxxing|identity_slip|meeting_attempt
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.caseId) filter.caseId = req.query.caseId;
  if (req.query.source) {
    const fileFilter = { sourceType: req.query.source };
    if (req.query.caseId) fileFilter.caseId = req.query.caseId;
    const files = await EvidenceFile.find(fileFilter);
    filter.evidenceFileId = { $in: files.map((f) => f._id) };
  }
  if (req.query.flag) {
    filter['flags.category'] = req.query.flag;
  }
  const events = await Event.find(filter).sort({ timestamp: 1 }).limit(2000);
  res.json(events);
});

module.exports = router;
