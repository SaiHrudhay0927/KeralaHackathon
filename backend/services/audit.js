const AuditLog = require('../models/AuditLog');

async function audit(actor, action, detail, relatedIds = [], caseId = null) {
  try {
    await AuditLog.create({
      actor,
      action,
      detail,
      relatedIds: relatedIds.map(String),
      caseId: caseId || undefined,
    });
  } catch (err) {
    // Auditing must never crash the pipeline, but a silent failure would be
    // worse for chain of custody - so log loudly.
    console.error('[audit] FAILED to write audit entry:', action, err.message);
  }
}

module.exports = { audit };
