const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', index: true },
  timestamp: { type: Date, default: Date.now },
  actor: { type: String, enum: ['ai', 'investigator', 'system'], required: true },
  action: { type: String, required: true },
  detail: { type: String, default: '' },
  relatedIds: { type: [String], default: [] },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
