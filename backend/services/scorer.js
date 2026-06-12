// Lead scoring (spec section 5):
//   score = severity-weighted count of flags on related events
//         + bonus if the entity connects >= 2 evidence sources
//         + bonus per same_owner edge.
// Leads under SCORE_THRESHOLD go to 'second_look' - never deleted.

const Event = require('../models/Event');
const EvidenceFile = require('../models/EvidenceFile');
const GraphNode = require('../models/GraphNode');
const GraphEdge = require('../models/GraphEdge');
const Lead = require('../models/Lead');
const { audit } = require('./audit');
const { classifyIdentifier } = require('./resolver');

const SCORE_THRESHOLD = 40;
const FLAG_WEIGHT = 4; // points per severity unit
const MULTI_SOURCE_BONUS = 15;
const SAME_OWNER_BONUS = 10;

function sourceTypeOfRef(sourceRef, filesByName) {
  const filename = String(sourceRef).split(':')[0];
  const file = filesByName.get(filename);
  return file ? file.sourceType : 'unknown';
}

/**
 * (Re)scores leads for every graph node that has flagged events or
 * same_owner edges. Idempotent: one AI lead per node, updated in place.
 */
async function rescoreLeads(caseId) {
  const [nodes, edges, events, files] = await Promise.all([
    GraphNode.find({ caseId }),
    GraphEdge.find({ caseId }),
    Event.find({ caseId, 'flags.0': { $exists: true } }),
    EvidenceFile.find({ caseId }),
  ]);
  const filesByName = new Map(files.map((f) => [f.filename, f]));

  // Map each flagged event to the node of its sender.
  const nodeByKey = new Map(nodes.map((n) => [`${n.type}:${n.normalizedValue}`, n]));
  const flaggedEventsByNode = new Map();
  for (const ev of events) {
    const id = classifyIdentifier(ev.fromRaw);
    if (!id) continue;
    const node = nodeByKey.get(`${id.type}:${id.normalizedValue}`);
    if (!node) continue;
    const key = String(node._id);
    if (!flaggedEventsByNode.has(key)) flaggedEventsByNode.set(key, []);
    flaggedEventsByNode.get(key).push(ev);
  }

  const sameOwnerEdgesByNode = new Map();
  for (const edge of edges) {
    if (edge.type !== 'same_owner') continue;
    for (const nodeId of [String(edge.from), String(edge.to)]) {
      if (!sameOwnerEdgesByNode.has(nodeId)) sameOwnerEdgesByNode.set(nodeId, []);
      sameOwnerEdgesByNode.get(nodeId).push(edge);
    }
  }

  const results = [];
  for (const node of nodes) {
    const nodeId = String(node._id);
    const flagged = flaggedEventsByNode.get(nodeId) || [];
    const sameOwner = sameOwnerEdgesByNode.get(nodeId) || [];
    if (flagged.length === 0 && sameOwner.length === 0) continue;

    const severitySum = flagged.reduce(
      (sum, ev) => sum + ev.flags.reduce((s, f) => s + (f.severity || 1), 0),
      0
    );

    // Distinct evidence source types this node appears in (firstSeenIn refs
    // + same_owner edge refs).
    const sourceTypes = new Set(
      [...node.firstSeenIn, ...sameOwner.flatMap((e) => e.sourceRefs)].map((ref) =>
        sourceTypeOfRef(ref, filesByName)
      )
    );
    sourceTypes.delete('unknown');

    let score =
      severitySum * FLAG_WEIGHT +
      (sourceTypes.size >= 2 ? MULTI_SOURCE_BONUS : 0) +
      sameOwner.length * SAME_OWNER_BONUS;
    score = Math.min(100, Math.round(score));

    const supportingEvidence = [
      ...new Set([
        ...flagged.map((ev) => ev.sourceRef),
        ...sameOwner.flatMap((e) => e.sourceRefs),
      ]),
    ];
    const relatedNodeIds = [
      ...new Set([
        nodeId,
        ...sameOwner.flatMap((e) => [String(e.from), String(e.to)]),
      ]),
    ];

    const flagCategories = [...new Set(flagged.flatMap((ev) => ev.flags.map((f) => f.category)))];
    const title = `Suspicious activity by ${node.label} (${node.type})`;
    const description =
      `${flagged.length} flagged event(s)` +
      (flagCategories.length ? ` [${flagCategories.join(', ')}]` : '') +
      `, ${sameOwner.length} same_owner link(s), seen in ${sourceTypes.size} evidence source(s)` +
      ` [${[...sourceTypes].join(', ')}].`;

    let lead = await Lead.findOne({ caseId, createdBy: 'ai', relatedNodeIds: node._id, title });
    const newStatus = score >= SCORE_THRESHOLD ? 'active' : 'second_look';

    if (!lead) {
      lead = await Lead.create({
        caseId,
        title,
        description,
        score,
        status: newStatus,
        supportingEvidence,
        relatedNodeIds,
        createdBy: 'ai',
      });
      await audit('ai', 'lead_created',
        `Created a new lead: "${title}" with a score of ${score}/100, placed in ${newStatus === 'active' ? 'the Active list' : 'the Second-Look queue (kept, not deleted)'}.`,
        [lead._id, nodeId], caseId);
    } else {
      const prevScore = lead.score;
      const prevStatus = lead.status;
      lead.description = description;
      lead.score = score;
      lead.supportingEvidence = supportingEvidence;
      lead.relatedNodeIds = relatedNodeIds;
      // Respect investigator review; otherwise move between active/second_look.
      if (lead.status !== 'reviewed') lead.status = newStatus;
      lead.updatedAt = new Date();
      await lead.save();
      if (prevScore !== score || prevStatus !== lead.status) {
        const statusChange = prevStatus !== lead.status
          ? ` It moved from ${prevStatus.replace('_', '-')} to ${lead.status.replace('_', '-')}.`
          : '';
        await audit('ai', 'lead_rescored',
          `Re-evaluated the lead "${title}" after new evidence: score changed from ${prevScore} to ${score}.${statusChange}`,
          [lead._id, nodeId], caseId);
      }
    }
    results.push(lead);
  }

  return results;
}

module.exports = { rescoreLeads, SCORE_THRESHOLD };
