// Entity resolution - rule-based, explainable, reversible.
// Core principle (spec section 5): NEVER silently merge identities. When two
// identifiers appear to belong to the same person, create a `same_owner` edge
// with a confidence score and an audit entry explaining why.

const Event = require('../models/Event');
const GraphNode = require('../models/GraphNode');
const GraphEdge = require('../models/GraphEdge');
const { audit } = require('./audit');
const { findPhonesInText } = require('./extractor');

// Rule 1: normalize phone numbers so "+91 98473 55421", "+919847355421" and
// "98473 55421" all resolve to the same node.
function normalizePhone(raw) {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function looksLikePhone(raw) {
  return normalizePhone(raw) !== null && /^[+\d\s()-]+$/.test(String(raw).trim());
}

function classifyIdentifier(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (looksLikePhone(s)) return { type: 'phone', normalizedValue: normalizePhone(s), label: `+91 ${normalizePhone(s)}` };
  if (/@/.test(s) && /\./.test(s.split('@')[1] || '')) return { type: 'email', normalizedValue: s.toLowerCase(), label: s };
  if (/^[a-z0-9._]+$/i.test(s) && /[._\d]/.test(s)) return { type: 'username', normalizedValue: s.toLowerCase(), label: s };
  return { type: 'person', normalizedValue: s.toLowerCase(), label: s };
}

async function findOrCreateNode({ type, normalizedValue, label }, sourceRef, rawAlias, caseId) {
  let node = await GraphNode.findOne({ caseId, type, normalizedValue });
  if (!node) {
    node = await GraphNode.create({
      caseId,
      type,
      label,
      normalizedValue,
      aliases: rawAlias && rawAlias !== label ? [rawAlias] : [],
      firstSeenIn: sourceRef ? [sourceRef] : [],
    });
  } else {
    let changed = false;
    if (rawAlias && rawAlias !== node.label && !node.aliases.includes(rawAlias)) {
      node.aliases.push(rawAlias);
      changed = true;
    }
    if (sourceRef && !node.firstSeenIn.includes(sourceRef)) {
      node.firstSeenIn.push(sourceRef);
      changed = true;
    }
    if (changed) await node.save();
  }
  return node;
}

async function upsertEdge({ from, to, type, sourceRef, timestamp, confidence = 1, reason, caseId }) {
  if (!from || !to || String(from._id) === String(to._id)) return null;
  // Keep same_owner edges undirected by storing them with a stable node order.
  let a = from, b = to;
  if (type === 'same_owner' && String(from._id) > String(to._id)) { a = to; b = from; }

  let edge = await GraphEdge.findOne({ from: a._id, to: b._id, type });
  if (!edge) {
    edge = await GraphEdge.create({
      caseId,
      from: a._id,
      to: b._id,
      type,
      count: 1,
      firstTimestamp: timestamp || undefined,
      lastTimestamp: timestamp || undefined,
      sourceRefs: sourceRef ? [sourceRef] : [],
      confidence,
      reason,
    });
    return { edge, created: true };
  }

  edge.count += 1;
  if (timestamp) {
    if (!edge.firstTimestamp || timestamp < edge.firstTimestamp) edge.firstTimestamp = timestamp;
    if (!edge.lastTimestamp || timestamp > edge.lastTimestamp) edge.lastTimestamp = timestamp;
  }
  if (sourceRef && !edge.sourceRefs.includes(sourceRef)) edge.sourceRefs.push(sourceRef);
  if (confidence > edge.confidence) {
    edge.confidence = confidence;
    if (reason) edge.reason = reason;
  }
  await edge.save();
  return { edge, created: false };
}

const EDGE_TYPE_BY_EVENT = { message: 'messaged', call: 'called', dm: 'messaged' };

/**
 * Builds/updates the graph from one evidence file's events plus the entities
 * extracted by the extractor.
 */
async function resolveEvidenceFile(evidenceFile, extraction) {
  const caseId = evidenceFile.caseId;
  const events = await Event.find({ evidenceFileId: evidenceFile._id });
  const stats = { nodes: 0, edges: 0, sameOwnerEdges: 0 };

  // --- Communication edges from event metadata (from -> to) ---
  for (const ev of events) {
    const fromId = classifyIdentifier(ev.fromRaw);
    const toId = classifyIdentifier(ev.toRaw);
    const fromNode = fromId ? await findOrCreateNode(fromId, ev.sourceRef, ev.fromRaw, caseId) : null;
    const toNode = toId ? await findOrCreateNode(toId, ev.sourceRef, ev.toRaw, caseId) : null;
    if (fromNode && toNode) {
      await upsertEdge({
        from: fromNode,
        to: toNode,
        type: EDGE_TYPE_BY_EVENT[ev.type] || 'messaged',
        sourceRef: ev.sourceRef,
        timestamp: ev.timestamp,
        caseId,
      });
    }
  }

  // --- Nodes for extracted in-content entities + `mentions` edges ---
  const eventBySourceRef = new Map(events.map((ev) => [ev.sourceRef, ev]));
  for (const ent of extraction.entities || []) {
    const cls =
      ent.type === 'phone'
        ? (normalizePhone(ent.value) && { type: 'phone', normalizedValue: normalizePhone(ent.value), label: `+91 ${normalizePhone(ent.value)}` })
        : classifyIdentifier(ent.value) && { ...classifyIdentifier(ent.value), type: ent.type };
    if (!cls || !cls.normalizedValue) continue;

    const entityNode = await findOrCreateNode(cls, ent.sourceRef, String(ent.value), caseId);
    const ev = eventBySourceRef.get(ent.sourceRef);
    if (!ev) continue;
    const senderId = classifyIdentifier(ev.fromRaw);
    if (!senderId) continue;
    const senderNode = await findOrCreateNode(senderId, ev.sourceRef, ev.fromRaw, caseId);
    if (String(senderNode._id) === String(entityNode._id)) continue;

    await upsertEdge({
      from: senderNode,
      to: entityNode,
      type: 'mentions',
      sourceRef: ent.sourceRef,
      timestamp: ev.timestamp,
      reason: `${senderNode.label} mentioned ${entityNode.label} in ${ent.sourceRef}`,
      caseId,
    });

    // Rule 3 (identity_slip) and Rule 4 (bio/message contains a phone number):
    // upgrade to a same_owner hypothesis with an explainable confidence.
    const isSlip = (ev.flags || []).some((f) => f.category === 'identity_slip');
    const isBio = /:bio:/.test(ev.sourceRef) || /\[profile bio/.test(ev.content || '');
    if ((isSlip || isBio) && cls.type === 'phone' && senderNode.type !== 'person') {
      const confidence = isSlip ? 0.9 : 0.7;
      const reason = isSlip
        ? `${senderNode.label} admitted owning another contact in their own message — "${(ev.content || '').slice(0, 120)}" — which links them to ${entityNode.label}. (Source: ${ev.sourceRef})`
        : `The Instagram profile bio of ${senderNode.label} openly advertises the phone number ${entityNode.label}. (Source: ${ev.sourceRef})`;
      const result = await upsertEdge({
        from: senderNode,
        to: entityNode,
        type: 'same_owner',
        sourceRef: ent.sourceRef,
        timestamp: ev.timestamp,
        confidence,
        reason,
        caseId,
      });
      if (result) {
        stats.sameOwnerEdges += 1;
        await audit('ai', 'same_owner_hypothesis', reason, [senderNode._id, entityNode._id, result.edge._id], caseId);
      }
    }
  }

  // --- Cross-source phrase correlation (explainable, low-confidence) ---
  // Distinctive phrases reused by two different sender identities across
  // sources (e.g. "blue kurti", "father's shop in kaloor") suggest the same
  // author. Creates a same_owner edge at 0.6 - never a merge.
  await correlateDistinctivePhrases(stats, caseId);

  stats.nodes = await GraphNode.countDocuments({ caseId });
  stats.edges = await GraphEdge.countDocuments({ caseId });
  return stats;
}

const DISTINCTIVE_PHRASES = [
  { re: /blue kurti/i, text: 'blue kurti' },
  { re: /father'?s shop in kaloor/i, text: "father's shop in kaloor" },
  { re: /bus route/i, text: 'bus route' },
  { re: /block(ing|ed)? (doesn'?t|does not) (work|help)/i, text: 'blocking does not work' },
];

async function correlateDistinctivePhrases(stats, caseId) {
  const allEvents = await Event.find({ caseId, content: { $ne: '' } });
  for (const phrase of DISTINCTIVE_PHRASES) {
    const hits = allEvents.filter((ev) => phrase.re.test(ev.content || ''));
    const senders = new Map();
    for (const ev of hits) {
      const id = classifyIdentifier(ev.fromRaw);
      if (!id || id.type === 'person') continue; // skip named contacts like the victim
      const key = `${id.type}:${id.normalizedValue}`;
      if (!senders.has(key)) senders.set(key, { id, ev });
    }
    const distinct = [...senders.values()];
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const a = await findOrCreateNode(distinct[i].id, distinct[i].ev.sourceRef, distinct[i].ev.fromRaw, caseId);
        const b = await findOrCreateNode(distinct[j].id, distinct[j].ev.sourceRef, distinct[j].ev.fromRaw, caseId);
        const reason = `${a.label} and ${b.label} both used the same distinctive phrase "${phrase.text}" — suggesting the same person wrote both. (Sources: ${distinct[i].ev.sourceRef} and ${distinct[j].ev.sourceRef})`;
        const result = await upsertEdge({
          from: a,
          to: b,
          type: 'same_owner',
          sourceRef: distinct[i].ev.sourceRef,
          confidence: 0.6,
          reason,
          caseId,
        });
        if (result && result.created) {
          stats.sameOwnerEdges += 1;
          await audit('ai', 'same_owner_hypothesis', reason, [a._id, b._id, result.edge._id], caseId);
          // also record the second sourceRef on the edge
          if (!result.edge.sourceRefs.includes(distinct[j].ev.sourceRef)) {
            result.edge.sourceRefs.push(distinct[j].ev.sourceRef);
            await result.edge.save();
          }
        }
      }
    }
  }
}

module.exports = { resolveEvidenceFile, normalizePhone, classifyIdentifier };
