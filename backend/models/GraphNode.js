const mongoose = require('mongoose');

const graphNodeSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
  type: {
    type: String,
    enum: ['person', 'phone', 'username', 'email', 'location', 'device'],
    required: true,
  },
  label: { type: String, required: true },
  // normalized key used for entity resolution (e.g. 10-digit phone, lowercased handle)
  normalizedValue: { type: String, required: true },
  aliases: { type: [String], default: [] },
  firstSeenIn: { type: [String], default: [] },
  resolvedFrom: { type: [String], default: [] },
});

graphNodeSchema.index({ caseId: 1, type: 1, normalizedValue: 1 }, { unique: true });

module.exports = mongoose.model('GraphNode', graphNodeSchema);
