const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');

const EvidenceFile = require('../models/EvidenceFile');
const Event = require('../models/Event');
const { parseWhatsapp } = require('../parsers/whatsapp');
const { parseCalls } = require('../parsers/calls');
const { parseInstagram } = require('../parsers/instagram');
const { audit } = require('../services/audit');
const { extractForEvidenceFile } = require('../services/extractor');
const { resolveEvidenceFile } = require('../services/resolver');
const { rescoreLeads } = require('../services/scorer');

const router = express.Router();

// Files are processed in memory: the SHA-256 hash + parsed events go to the
// database immediately, so no disk persistence is needed (and Vercel's
// serverless filesystem is read-only anyway).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function detectSourceType(filename, explicit) {
  if (explicit && ['whatsapp', 'calls', 'instagram'].includes(explicit)) return explicit;
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.txt') return 'whatsapp';
  if (ext === '.csv') return 'calls';
  if (ext === '.json') return 'instagram';
  return null;
}

function parseBySourceType(sourceType, text, originalName) {
  if (sourceType === 'whatsapp') return parseWhatsapp(text, originalName);
  if (sourceType === 'calls') return parseCalls(text, originalName);
  if (sourceType === 'instagram') return parseInstagram(text, originalName).events;
  throw new Error(`Unknown sourceType: ${sourceType}`);
}

// POST /api/evidence/upload  (multipart field "file", optional field "sourceType")
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: file)' });

    const caseId = req.body.caseId;
    if (!caseId) return res.status(400).json({ error: 'caseId is required - select a case first' });
    const Case = require('../models/Case');
    const theCase = await Case.findById(caseId);
    if (!theCase) return res.status(404).json({ error: 'Case not found' });

    const sourceType = detectSourceType(req.file.originalname, req.body.sourceType);
    if (!sourceType) {
      return res.status(400).json({
        error: 'Could not detect source type. Pass sourceType=whatsapp|calls|instagram.',
      });
    }

    const buffer = req.file.buffer;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const evidenceFile = await EvidenceFile.create({
      caseId,
      filename: req.file.originalname,
      sourceType,
      sha256,
      status: 'uploaded',
    });
    const sourceLabels = { whatsapp: 'WhatsApp chat export', calls: 'call detail records', instagram: 'Instagram DM export' };
    await audit('system', 'evidence_uploaded',
      `Received evidence file "${req.file.originalname}" (${sourceLabels[sourceType]}). A SHA-256 fingerprint was computed and locked in for chain of custody: ${sha256.slice(0, 16)}…`,
      [evidenceFile._id], caseId);

    const parsedEvents = parseBySourceType(sourceType, buffer.toString('utf8'), req.file.originalname);
    const events = await Event.insertMany(
      parsedEvents.map((e) => ({ ...e, caseId, evidenceFileId: evidenceFile._id }))
    );
    evidenceFile.status = 'parsed';
    evidenceFile.eventCount = events.length;
    await evidenceFile.save();
    await audit('system', 'evidence_parsed',
      `Read "${req.file.originalname}" and converted it into ${events.length} individual events (messages/calls).`,
      [evidenceFile._id], caseId);

    // Milestone 3: entity/event extraction (LLM or rule-based fallback)
    const extraction = await extractForEvidenceFile(evidenceFile);

    // Milestone 4: entity resolution -> graph nodes/edges
    const graphStats = await resolveEvidenceFile(evidenceFile, extraction);

    // Milestone 5: (re)score leads across the whole case
    const leads = await rescoreLeads(caseId);

    res.json({
      file: evidenceFile,
      eventCount: events.length,
      extraction: {
        engine: extraction.engine,
        entities: extraction.entities.length,
        flags: extraction.flags.length,
      },
      graph: graphStats,
      leads: {
        total: leads.length,
        active: leads.filter((l) => l.status === 'active').length,
        secondLook: leads.filter((l) => l.status === 'second_look').length,
      },
    });
  } catch (err) {
    console.error('[evidence] upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/evidence?caseId=
router.get('/', async (req, res) => {
  const filter = req.query.caseId ? { caseId: req.query.caseId } : {};
  const files = await EvidenceFile.find(filter).sort({ uploadedAt: -1 });
  res.json(files);
});

// GET /api/evidence/:id/events
router.get('/:id/events', async (req, res) => {
  const events = await Event.find({ evidenceFileId: req.params.id }).sort({ timestamp: 1 });
  res.json(events);
});

module.exports = router;
