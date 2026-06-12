const express = require('express');
const Lead = require('../models/Lead');
const { rescoreLeads } = require('../services/scorer');
const { audit } = require('../services/audit');

const router = express.Router();

// GET /api/leads?status=active|second_look|reviewed
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.caseId) filter.caseId = req.query.caseId;
  const leads = await Lead.find(filter).sort({ score: -1 });
  res.json(leads);
});

// PATCH /api/leads/:id/review  body: { status?: 'reviewed'|'active'|'second_look', note?: string }
router.patch('/:id/review', async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const prevStatus = lead.status;
  lead.status = req.body.status || 'reviewed';
  lead.updatedAt = new Date();
  await lead.save();
  await audit('investigator', 'lead_reviewed',
    `An investigator changed the lead "${lead.title}" from ${prevStatus.replace('_', '-')} to ${lead.status.replace('_', '-')}.${req.body.note ? ` Note: ${req.body.note}` : ''}`,
    [lead._id], lead.caseId);
  res.json(lead);
});

// POST /api/leads/rescore - re-evaluates all leads (incl. second-look queue)
router.post('/rescore', async (req, res) => {
  const caseId = req.body.caseId || req.query.caseId;
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  const leads = await rescoreLeads(caseId);
  res.json({
    rescored: leads.length,
    active: leads.filter((l) => l.status === 'active').length,
    secondLook: leads.filter((l) => l.status === 'second_look').length,
    leads,
  });
});

module.exports = router;
