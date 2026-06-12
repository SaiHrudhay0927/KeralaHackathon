const express = require('express');
const Case = require('../models/Case');
const EvidenceFile = require('../models/EvidenceFile');
const Event = require('../models/Event');
const Lead = require('../models/Lead');
const { audit } = require('../services/audit');

const router = express.Router();

// GET /api/cases - all cases with quick stats
router.get('/', async (req, res) => {
  const cases = await Case.find().sort({ updatedAt: -1 });
  const withStats = await Promise.all(
    cases.map(async (c) => {
      const [files, events, activeLeads] = await Promise.all([
        EvidenceFile.countDocuments({ caseId: c._id }),
        Event.countDocuments({ caseId: c._id }),
        Lead.countDocuments({ caseId: c._id, status: 'active' }),
      ]);
      return { ...c.toObject(), stats: { files, events, activeLeads } };
    })
  );
  res.json(withStats);
});

// GET /api/cases/:id
router.get('/:id', async (req, res) => {
  const c = await Case.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  res.json(c);
});

// POST /api/cases  body: { name, caseNumber?, description? }
router.post('/', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Case name is required' });
  const c = await Case.create({
    name,
    caseNumber: (req.body.caseNumber || '').trim(),
    description: (req.body.description || '').trim(),
  });
  await audit('investigator', 'case_created',
    `An investigator created the case "${c.name}"${c.caseNumber ? ` (${c.caseNumber})` : ''}.`,
    [c._id], c._id);
  res.status(201).json(c);
});

// PATCH /api/cases/:id  body: { name?, caseNumber?, description?, status? }
router.patch('/:id', async (req, res) => {
  const c = await Case.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const changes = [];
  for (const field of ['name', 'caseNumber', 'description', 'status']) {
    if (req.body[field] !== undefined && req.body[field] !== c[field]) {
      changes.push(`${field}: "${c[field]}" → "${req.body[field]}"`);
      c[field] = req.body[field];
    }
  }
  if (changes.length === 0) return res.json(c);
  c.updatedAt = new Date();
  await c.save();
  await audit('investigator', 'case_updated',
    `An investigator edited the case "${c.name}" (${changes.join('; ')}).`,
    [c._id], c._id);
  res.json(c);
});

module.exports = router;
