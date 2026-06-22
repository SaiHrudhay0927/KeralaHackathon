const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  caseNumber: { type: String, default: '' },
  description: { type: String, default: '' },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  // Cached AI case briefing (regenerated only when the evidence changes, so the
  // dashboard doesn't re-call the LLM on every load). Signature is a cheap
  // fingerprint of the case's data volume.
  briefing: { type: Object, default: null },
  briefingSignature: { type: String, default: '' },
  // Cached AI victim risk assessment (same caching scheme as the briefing).
  risk: { type: Object, default: null },
  riskSignature: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Case', caseSchema);
