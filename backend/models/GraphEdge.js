const mongoose = require('mongoose');

const graphEdgeSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'GraphNode', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'GraphNode', required: true },
  type: {
    type: String,
    enum: ['messaged', 'called', 'mentions', 'same_owner', 'located_at'],
    required: true,
  },
  count: { type: Number, default: 1 },
  firstTimestamp: { type: Date },
  lastTimestamp: { type: Date },
  sourceRefs: { type: [String], default: [] },
  confidence: { type: Number, min: 0, max: 1, default: 1 },
  reason: { type: String },
});

graphEdgeSchema.index({ from: 1, to: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('GraphEdge', graphEdgeSchema);
