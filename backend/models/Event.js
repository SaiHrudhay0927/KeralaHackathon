const mongoose = require('mongoose');

const flagSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['threat', 'doxxing', 'identity_slip', 'meeting_attempt', 'none'],
      default: 'none',
    },
    severity: { type: Number, min: 1, max: 5 },
    reason: { type: String },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
  evidenceFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceFile', required: true },
  type: { type: String, enum: ['message', 'call', 'dm'], required: true },
  timestamp: { type: Date },
  fromRaw: { type: String },
  toRaw: { type: String },
  content: { type: String, default: '' },
  sourceRef: { type: String, required: true },
  flags: { type: [flagSchema], default: [] },
});

eventSchema.index({ sourceRef: 1 });

module.exports = mongoose.model('Event', eventSchema);
