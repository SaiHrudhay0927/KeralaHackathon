const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  score: { type: Number, min: 0, max: 100, default: 0 },
  status: { type: String, enum: ['active', 'second_look', 'reviewed'], default: 'active' },
  supportingEvidence: { type: [String], default: [] },
  relatedNodeIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'GraphNode', default: [] },
  createdBy: { type: String, enum: ['ai', 'investigator'], default: 'ai' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Lead', leadSchema);
