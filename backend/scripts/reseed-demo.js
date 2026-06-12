// Wipes all case data and reprocesses the sample evidence files through the
// full pipeline (parse -> extract -> resolve -> score). DEV/DEMO ONLY.
// Usage: node --use-system-ca scripts/reseed-demo.js <file1> [file2] [file3]

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { connectDb, disconnectDb } = require('../config/db');
const Case = require('../models/Case');
const EvidenceFile = require('../models/EvidenceFile');
const Event = require('../models/Event');
const GraphNode = require('../models/GraphNode');
const GraphEdge = require('../models/GraphEdge');
const Lead = require('../models/Lead');
const AuditLog = require('../models/AuditLog');
const { parseWhatsapp } = require('../parsers/whatsapp');
const { parseCalls } = require('../parsers/calls');
const { parseInstagram } = require('../parsers/instagram');
const { extractForEvidenceFile } = require('../services/extractor');
const { resolveEvidenceFile } = require('../services/resolver');
const { rescoreLeads } = require('../services/scorer');
const { audit } = require('../services/audit');

function detect(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.txt') return 'whatsapp';
  if (ext === '.csv') return 'calls';
  if (ext === '.json') return 'instagram';
  throw new Error(`Cannot detect source type of ${filename}`);
}

function parse(sourceType, text, name) {
  if (sourceType === 'whatsapp') return parseWhatsapp(text, name);
  if (sourceType === 'calls') return parseCalls(text, name);
  return parseInstagram(text, name).events;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/reseed-demo.js <file1> [file2] ...');
    process.exit(1);
  }

  await connectDb();
  console.log('Clearing existing case data (dropping collections so indexes rebuild)…');
  for (const model of [Case, EvidenceFile, Event, GraphNode, GraphEdge, Lead, AuditLog]) {
    await model.collection.drop().catch(() => {}); // ignore "ns not found"
    await model.syncIndexes();
  }

  const demoCase = await Case.create({
    name: 'Cyberstalking — Minor Victim (Kochi)',
    caseNumber: '2026-CYB-014',
    description: 'Synthetic demo case: 16-year-old harassed across WhatsApp, phone calls and Instagram by one offender using 2 phone numbers and 2 Instagram handles.',
  });
  const caseId = demoCase._id;
  await audit('investigator', 'case_created',
    `An investigator created the case "${demoCase.name}" (${demoCase.caseNumber}).`,
    [caseId], caseId);
  console.log(`Created demo case "${demoCase.name}" (${caseId})`);

  const sourceLabels = { whatsapp: 'WhatsApp chat export', calls: 'call detail records', instagram: 'Instagram DM export' };

  for (const f of files) {
    const name = path.basename(f);
    const buffer = fs.readFileSync(f);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const sourceType = detect(name);
    console.log(`\nProcessing ${name} (${sourceType})…`);

    const evidenceFile = await EvidenceFile.create({
      caseId,
      filename: name,
      storedPath: f,
      sourceType,
      sha256,
      status: 'uploaded',
    });
    await audit('system', 'evidence_uploaded',
      `Received evidence file "${name}" (${sourceLabels[sourceType]}). A SHA-256 fingerprint was computed and locked in for chain of custody: ${sha256.slice(0, 16)}…`,
      [evidenceFile._id], caseId);

    const parsed = parse(sourceType, buffer.toString('utf8'), name);
    await Event.insertMany(parsed.map((e) => ({ ...e, caseId, evidenceFileId: evidenceFile._id })));
    evidenceFile.status = 'parsed';
    evidenceFile.eventCount = parsed.length;
    await evidenceFile.save();
    await audit('system', 'evidence_parsed',
      `Read "${name}" and converted it into ${parsed.length} individual events (messages/calls).`,
      [evidenceFile._id], caseId);
    console.log(`  parsed: ${parsed.length} events`);

    const extraction = await extractForEvidenceFile(evidenceFile);
    console.log(`  extracted (${extraction.engine}): ${extraction.entities.length} entities, ${extraction.flags.length} flags`);

    const stats = await resolveEvidenceFile(evidenceFile, extraction);
    console.log(`  graph: ${stats.nodes} nodes, ${stats.edges} edges`);

    const leads = await rescoreLeads(caseId);
    console.log(`  leads: ${leads.length} (${leads.filter((l) => l.status === 'active').length} active)`);
  }

  console.log('\nReseed complete.');
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
