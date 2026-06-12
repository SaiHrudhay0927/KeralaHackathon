const express = require('express');
const PDFDocument = require('pdfkit');
const Lead = require('../models/Lead');
const GraphNode = require('../models/GraphNode');
const Event = require('../models/Event');
const EvidenceFile = require('../models/EvidenceFile');
const { audit } = require('../services/audit');

const router = express.Router();

// GET /api/reports/lead/:id -> PDF (lead summary, evidence excerpts,
// chain-of-custody hashes, Section 65B(4) certificate template)
router.get('/lead/:id', async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const nodes = await GraphNode.find({ _id: { $in: lead.relatedNodeIds } });
  const events = await Event.find({ sourceRef: { $in: lead.supportingEvidence } });
  const eventByRef = new Map(events.map((e) => [e.sourceRef, e]));
  const filenames = [...new Set(lead.supportingEvidence.map((r) => r.split(':')[0]))];
  const files = await EvidenceFile.find({ caseId: lead.caseId, filename: { $in: filenames } });

  await audit('investigator', 'report_exported',
    `An investigator exported a PDF report (with Section 65B certificate) for the lead "${lead.title}".`,
    [lead._id], lead.caseId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="lead-report-${lead._id}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  // Header
  doc.fontSize(9).fillColor('#888').text('SYNTHETIC TRAINING DATA — DEMO CASE (all persons and data are fictional)', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(16).fillColor('#000').text('Investigation Lead Report', { align: 'center' });
  doc.fontSize(10).fillColor('#444').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown();

  // Lead summary
  doc.fontSize(13).fillColor('#000').text(lead.title);
  doc.fontSize(10).fillColor('#222')
    .text(`Score: ${lead.score}/100   Status: ${lead.status}   Created by: ${lead.createdBy}`)
    .moveDown(0.3)
    .text(lead.description);
  doc.moveDown();

  // Related entities
  doc.fontSize(12).text('Related Entities', { underline: true }).moveDown(0.3);
  for (const n of nodes) {
    doc.fontSize(10).text(`• ${n.label} (${n.type})${n.aliases.length ? ` — aliases: ${n.aliases.join(', ')}` : ''}`);
  }
  doc.moveDown();

  // Supporting evidence excerpts
  doc.fontSize(12).text('Supporting Evidence', { underline: true }).moveDown(0.3);
  for (const ref of lead.supportingEvidence) {
    const ev = eventByRef.get(ref);
    doc.fontSize(9).fillColor('#555').text(ref);
    if (ev) {
      doc.fontSize(10).fillColor('#000')
        .text(`${ev.timestamp ? new Date(ev.timestamp).toLocaleString() : 'undated'} — ${ev.fromRaw || '?'}${ev.toRaw ? ` → ${ev.toRaw}` : ''}:`)
        .text(`"${ev.content}"`, { indent: 12 });
      for (const f of ev.flags || []) {
        doc.fontSize(9).fillColor('#a00').text(`flag: ${f.category} (severity ${f.severity}) — ${f.reason}`, { indent: 12 });
      }
    }
    doc.moveDown(0.5);
  }
  doc.moveDown();

  // Chain of custody
  doc.fontSize(12).fillColor('#000').text('Chain of Custody', { underline: true }).moveDown(0.3);
  for (const f of files) {
    doc.fontSize(9)
      .text(`${f.filename} (${f.sourceType})`)
      .text(`SHA-256: ${f.sha256}`, { indent: 12 })
      .text(`Uploaded: ${new Date(f.uploadedAt).toISOString()}`, { indent: 12 })
      .moveDown(0.3);
  }

  // Section 65B certificate
  doc.addPage();
  doc.fontSize(14).text('CERTIFICATE UNDER SECTION 65B(4), INDIAN EVIDENCE ACT, 1872', { align: 'center' });
  doc.fontSize(9).fillColor('#444').text('(corresponding to Section 63(4), Bharatiya Sakshya Adhiniyam, 2023)', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#000');
  doc.text(`I, ____________________________ (name), ____________________________ (designation), do hereby certify that:`);
  doc.moveDown(0.5);
  const points = [
    `1. The electronic records described below were produced by a computer system ("Investigation Support Platform") during the regular course of investigative activity.`,
    `2. The computer output containing the information was produced by the computer during the period over which it was used regularly to store or process information for the purposes of the investigation, by a person having lawful control over the use of the computer.`,
    `3. During the said period, information of the kind contained in the electronic records was regularly fed into the computer in the ordinary course of the said activities.`,
    `4. Throughout the material part of the said period, the computer was operating properly; and where it was not, any such period did not affect the electronic record or the accuracy of its contents.`,
    `5. The SHA-256 hash values listed in the Chain of Custody section of this report uniquely identify the evidence files at the time of their intake into the system.`,
  ];
  for (const p of points) doc.text(p).moveDown(0.4);
  doc.moveDown(1.5);
  doc.text('Place: ____________________');
  doc.text('Date:  ____________________');
  doc.moveDown(1.5);
  doc.text('Signature: ____________________________', { align: 'right' });
  doc.text('(Certifying Officer)', { align: 'right' });

  doc.end();
});

module.exports = router;
