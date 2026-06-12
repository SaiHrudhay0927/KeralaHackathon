const mongoose = require('mongoose');

const evidenceFileSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
  filename: { type: String, required: true },
  storedPath: { type: String },
  sourceType: { type: String, enum: ['whatsapp', 'calls', 'instagram'], required: true },
  uploadedAt: { type: Date, default: Date.now },
  sha256: { type: String, required: true },
  status: { type: String, enum: ['uploaded', 'parsed', 'extracted'], default: 'uploaded' },
  eventCount: { type: Number, default: 0 },
});

module.exports = mongoose.model('EvidenceFile', evidenceFileSchema);
