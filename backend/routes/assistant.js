const express = require('express');
const GraphNode = require('../models/GraphNode');
const GraphEdge = require('../models/GraphEdge');
const Event = require('../models/Event');
const Lead = require('../models/Lead');
const Case = require('../models/Case');
const { classifyIdentifier } = require('../services/resolver');
const { audit } = require('../services/audit');

const router = express.Router();

async function buildCaseContext(caseId) {
  const scope = caseId ? { caseId } : {};
  const [nodes, edges, leads, flaggedEvents] = await Promise.all([
    GraphNode.find(scope),
    GraphEdge.find(scope),
    Lead.find(scope).sort({ score: -1 }),
    Event.find({ ...scope, 'flags.0': { $exists: true } }).sort({ timestamp: 1 }),
  ]);
  const label = new Map(nodes.map((n) => [String(n._id), `${n.label} (${n.type})`]));

  return {
    entities: nodes.map((n) => `${n.label} [${n.type}]`),
    relationships: edges.map((e) => {
      const base = `${label.get(String(e.from))} --${e.type} x${e.count}--> ${label.get(String(e.to))}`;
      return e.type === 'same_owner'
        ? `${base} | confidence ${e.confidence} | why: ${e.reason} | sources: ${e.sourceRefs.join(', ')}`
        : base;
    }),
    leads: leads.map((l) => `[score ${l.score}, ${l.status}] ${l.title} — ${l.description}`),
    flaggedEvents: flaggedEvents.map((ev) =>
      `${ev.timestamp ? new Date(ev.timestamp).toISOString() : 'undated'} | from ${ev.fromRaw}: "${ev.content}" | flags: ${ev.flags
        .map((f) => `${f.category}(sev ${f.severity})`)
        .join(', ')} | source: ${ev.sourceRef}`
    ),
  };
}

const SYSTEM_PROMPT = `You are an investigation assistant embedded in a police evidence-analysis platform (all data is synthetic training data for a demo).
You are given the current case graph: entities (people, phone numbers, social accounts, locations), relationships between them, AI-generated leads, and flagged events.
Answer the investigator's question in clear, plain language a non-technical officer can follow.
Rules:
- Base every claim ONLY on the supplied case data. Never invent facts.
- When you make a claim, cite the source reference(s) in parentheses, e.g. (whatsapp_chat_ananya.txt:L20).
- "same_owner" relationships are AI hypotheses with a confidence score, not proven facts - present them as such.
- Keep answers short and structured. Use bullet points for lists.
- If the data does not answer the question, say so plainly.`;

// ---------------------------------------------------------------------------
// Case briefing (auto-generated intelligence summary for the dashboard)
// ---------------------------------------------------------------------------

const BRIEFING_PROMPT = `You are the lead analyst AI in a police evidence-analysis platform (all data is synthetic training data for a demo).
From the supplied case data, produce a concise intelligence briefing for the investigating officer.
Return STRICT JSON only (no prose, no markdown fences), with this exact shape:
{
  "headline": "one-sentence overall assessment of the case",
  "confidence": "high" | "medium" | "low",
  "summary": "2-3 plain-language sentences explaining what the evidence shows",
  "primeSuspect": "the most likely offender as a short label (entity name/number), or 'Undetermined'",
  "keyFindings": ["short finding with a (sourceRef) in parentheses where possible", "..."],
  "recommendedActions": ["short, concrete next step for the officer", "..."]
}
Rules:
- Base everything ONLY on the supplied case data. Never invent facts.
- "same_owner" relationships are AI hypotheses with a confidence score — reflect that in your confidence level and wording.
- keyFindings: max 5. recommendedActions: max 3. Keep every line tight and serious.`;

function stripJsonFences(s) {
  return String(s).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Cheap fingerprint of the case's data volume — if unchanged, reuse the cache.
function signatureOf(counts) {
  return [counts.files, counts.events, counts.nodes, counts.edges, counts.sameOwner, counts.leads].join('-');
}

// Deterministic briefing when no LLM key is configured, so the dashboard still
// presents an interpreted summary rather than raw numbers.
function fallbackBriefing(nodes, edges, leads, flaggedEvents) {
  const sameOwner = edges.filter((e) => e.type === 'same_owner');
  const soDegree = new Map();
  for (const e of sameOwner) {
    for (const id of [String(e.from), String(e.to)]) soDegree.set(id, (soDegree.get(id) || 0) + 1);
  }
  let suspectId = null;
  let best = 0;
  for (const [id, deg] of soDegree) if (deg > best) { best = deg; suspectId = id; }
  const labelById = new Map(nodes.map((n) => [String(n._id), n.label]));
  const suspect = suspectId ? labelById.get(suspectId) : null;

  const byCat = (cat) => flaggedEvents.filter((ev) => ev.flags.some((f) => f.category === cat)).length;
  const threats = byCat('threat');
  const doxxing = byCat('doxxing');
  const slips = byCat('identity_slip');
  const activeLeads = leads.filter((l) => l.status === 'active');

  const linkedIdentities = suspectId
    ? new Set(sameOwner.flatMap((e) => [String(e.from), String(e.to)]).filter((id) => soDegree.get(id))).size
    : 0;

  const keyFindings = [];
  if (suspect && linkedIdentities > 1) keyFindings.push(`${suspect} appears linked to ${linkedIdentities} identities via ${sameOwner.length} same_owner hypothesis link(s).`);
  if (threats) keyFindings.push(`${threats} threatening message(s) flagged.`);
  if (doxxing) keyFindings.push(`${doxxing} doxxing/identifying-detail event(s) flagged.`);
  if (slips) keyFindings.push(`${slips} identity-slip event(s) where a suspect revealed an alternate contact.`);
  if (keyFindings.length === 0) keyFindings.push('No suspicious patterns detected yet — upload more evidence to build the picture.');

  const recommendedActions = [];
  if (activeLeads.length) recommendedActions.push(`Review the top active lead and export its Section 65B report.`);
  if (sameOwner.length) recommendedActions.push('Confirm the same_owner links in the Graph view (focus on the suspect cluster).');
  recommendedActions.push('Cross-check the flagged events on the Timeline against their source evidence.');

  return {
    headline: suspect
      ? `Evidence points to a single offender (${suspect}) operating behind multiple identities.`
      : 'Case is being built — no dominant suspect cluster yet.',
    confidence: sameOwner.length >= 2 ? 'medium' : 'low',
    summary: suspect
      ? `The graph links ${linkedIdentities} identities to ${suspect}, with ${threats + doxxing} flagged harassment event(s) across the uploaded sources. The same_owner links are AI hypotheses and should be verified.`
      : `${flaggedEvents.length} flagged event(s) recorded so far. Upload more evidence to let the platform resolve identities and surface a suspect.`,
    primeSuspect: suspect || 'Undetermined',
    keyFindings: keyFindings.slice(0, 5),
    recommendedActions: recommendedActions.slice(0, 3),
    engine: 'rules',
    generatedAt: new Date().toISOString(),
  };
}

// GET /api/assistant/briefing?caseId=&refresh=1
router.get('/briefing', async (req, res) => {
  const caseId = req.query.caseId;
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });

  try {
    const theCase = await Case.findById(caseId);
    if (!theCase) return res.status(404).json({ error: 'Case not found' });

    const scope = { caseId };
    const [nodes, edges, leads, flaggedEvents, filesCount, eventsCount] = await Promise.all([
      GraphNode.find(scope),
      GraphEdge.find(scope),
      Lead.find(scope).sort({ score: -1 }),
      Event.find({ ...scope, 'flags.0': { $exists: true } }).sort({ timestamp: 1 }),
      require('../models/EvidenceFile').countDocuments(scope),
      Event.countDocuments(scope),
    ]);

    const counts = {
      files: filesCount,
      events: eventsCount,
      nodes: nodes.length,
      edges: edges.length,
      sameOwner: edges.filter((e) => e.type === 'same_owner').length,
      leads: leads.length,
    };
    const signature = signatureOf(counts);

    // Serve the cached briefing unless the data changed or a refresh was asked.
    if (!req.query.refresh && theCase.briefing && theCase.briefingSignature === signature) {
      return res.json({ ...theCase.briefing, cached: true });
    }

    if (nodes.length === 0) {
      return res.json({
        headline: 'No evidence analysed yet.',
        confidence: 'low',
        summary: 'Upload WhatsApp, call-record or Instagram evidence to generate an AI briefing for this case.',
        primeSuspect: 'Undetermined',
        keyFindings: [],
        recommendedActions: ['Upload evidence files on this dashboard to begin analysis.'],
        engine: 'none',
        generatedAt: new Date().toISOString(),
      });
    }

    let briefing;
    if (!process.env.OPENAI_API_KEY) {
      briefing = fallbackBriefing(nodes, edges, leads, flaggedEvents);
    } else {
      const ctx = await buildCaseContext(caseId);
      const OpenAI = require('openai');
      const openai = new OpenAI();
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: BRIEFING_PROMPT },
          {
            role: 'user',
            content:
              `CASE DATA\n=== Entities ===\n${ctx.entities.join('\n')}\n\n` +
              `=== Relationships ===\n${ctx.relationships.join('\n')}\n\n` +
              `=== Leads ===\n${ctx.leads.join('\n')}\n\n` +
              `=== Flagged events ===\n${ctx.flaggedEvents.join('\n')}`,
          },
        ],
      });
      briefing = JSON.parse(stripJsonFences(resp.choices[0].message.content || '{}'));
      briefing.engine = 'openai';
      briefing.generatedAt = new Date().toISOString();
    }

    theCase.briefing = briefing;
    theCase.briefingSignature = signature;
    await theCase.save();
    await audit('ai', 'briefing_generated',
      `The AI produced a case briefing (${briefing.engine}): "${briefing.headline}"`,
      [], caseId);

    res.json({ ...briefing, cached: false });
  } catch (err) {
    console.error('[assistant] briefing failed:', err.message);
    res.status(500).json({ error: `Briefing failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Victim risk assessment (#1)
// ---------------------------------------------------------------------------

const RISK_PROMPT = `You are a risk-assessment AI in a police evidence platform (synthetic demo data) for a harassment/stalking case.
From the supplied flagged events and relationships, assess the danger to the victim.
Return STRICT JSON only (no markdown), shape:
{
  "level": "critical" | "high" | "moderate" | "low",
  "score": 0-100,
  "headline": "one line explaining the level in plain words",
  "factors": ["a contributing risk factor, with a (sourceRef) where possible", "..."]
}
Rules:
- Base everything ONLY on the supplied data.
- Treat physical-surveillance / meeting-attempt signals and explicit threats as the highest-weight factors; doxxing of location/routine raises risk further.
- factors: max 5, ordered most-serious first. Keep each line short.`;

// Deterministic risk scoring when no LLM key is set.
function fallbackRisk(flaggedEvents) {
  const cat = (c) => flaggedEvents.filter((ev) => ev.flags.some((f) => f.category === c));
  const threats = cat('threat');
  const surveil = cat('meeting_attempt'); // physical proximity / surveillance
  const doxxing = cat('doxxing');
  const slips = cat('identity_slip');
  const maxSev = flaggedEvents.reduce((m, ev) => Math.max(m, ...ev.flags.map((f) => f.severity || 0)), 0);

  let score = threats.length * 12 + surveil.length * 18 + doxxing.length * 10 + slips.length * 4 + maxSev * 4;
  score = Math.min(100, score);

  let level = 'low';
  if (surveil.length && threats.length) level = 'critical';
  else if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'high';
  else if (score >= 20) level = 'moderate';

  const factors = [];
  if (surveil.length) factors.push(`${surveil.length} event(s) indicate physical surveillance or proximity to the victim (${surveil[0].sourceRef}).`);
  if (threats.length) factors.push(`${threats.length} explicit threat(s), peak severity ${maxSev}/5 (${threats[0].sourceRef}).`);
  if (doxxing.length) factors.push(`${doxxing.length} event(s) expose the victim's location/routine (${doxxing[0].sourceRef}).`);
  if (slips.length) factors.push(`${slips.length} identity-slip(s) suggest a persistent offender evading blocks.`);
  if (factors.length === 0) factors.push('No high-risk indicators detected in the current evidence.');

  return {
    level,
    score,
    headline:
      level === 'critical' ? 'Immediate danger indicators present — prioritise victim safety.'
      : level === 'high' ? 'Serious, escalating harassment — act promptly.'
      : level === 'moderate' ? 'Concerning activity — continue monitoring and gathering evidence.'
      : 'Low risk based on current evidence.',
    factors: factors.slice(0, 5),
    engine: 'rules',
    generatedAt: new Date().toISOString(),
  };
}

// GET /api/assistant/risk?caseId=&refresh=1
router.get('/risk', async (req, res) => {
  const caseId = req.query.caseId;
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });

  try {
    const theCase = await Case.findById(caseId);
    if (!theCase) return res.status(404).json({ error: 'Case not found' });

    const scope = { caseId };
    const [nodes, edges, flaggedEvents, filesCount, eventsCount, leadsCount] = await Promise.all([
      GraphNode.countDocuments(scope),
      GraphEdge.find(scope),
      Event.find({ ...scope, 'flags.0': { $exists: true } }).sort({ timestamp: 1 }),
      require('../models/EvidenceFile').countDocuments(scope),
      Event.countDocuments(scope),
      Lead.countDocuments(scope),
    ]);

    const signature = signatureOf({
      files: filesCount, events: eventsCount, nodes,
      edges: edges.length, sameOwner: edges.filter((e) => e.type === 'same_owner').length, leads: leadsCount,
    });

    if (!req.query.refresh && theCase.risk && theCase.riskSignature === signature) {
      return res.json({ ...theCase.risk, cached: true });
    }

    if (flaggedEvents.length === 0) {
      return res.json({ level: 'low', score: 0, headline: 'No flagged events yet — upload evidence to assess risk.', factors: [], engine: 'none', generatedAt: new Date().toISOString() });
    }

    let risk;
    if (!process.env.OPENAI_API_KEY) {
      risk = fallbackRisk(flaggedEvents);
    } else {
      const lines = flaggedEvents.map((ev) =>
        `${ev.timestamp ? new Date(ev.timestamp).toISOString() : 'undated'} | from ${ev.fromRaw}: "${ev.content}" | flags: ${ev.flags.map((f) => `${f.category}(sev ${f.severity})`).join(', ')} | source: ${ev.sourceRef}`
      );
      const OpenAI = require('openai');
      const openai = new OpenAI();
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: RISK_PROMPT },
          { role: 'user', content: `FLAGGED EVENTS\n${lines.join('\n')}` },
        ],
      });
      risk = JSON.parse(stripJsonFences(resp.choices[0].message.content || '{}'));
      risk.engine = 'openai';
      risk.generatedAt = new Date().toISOString();
    }

    theCase.risk = risk;
    theCase.riskSignature = signature;
    await theCase.save();
    await audit('ai', 'risk_assessed', `The AI assessed victim risk as ${String(risk.level || '').toUpperCase()} (${risk.engine}): "${risk.headline}"`, [], caseId);

    res.json({ ...risk, cached: false });
  } catch (err) {
    console.error('[assistant] risk failed:', err.message);
    res.status(500).json({ error: `Risk assessment failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Entity dossier (#5)
// ---------------------------------------------------------------------------

const DOSSIER_PROMPT = `You are an intelligence analyst AI in a police evidence platform (synthetic demo data).
Write a short dossier (3-5 sentences, plain language) on ONE entity, based only on the supplied data: their identifiers/aliases, their connections, flagged events they authored, and any same_owner hypotheses.
Rules:
- Base everything ONLY on the supplied data; never invent.
- same_owner links are AI hypotheses with a confidence score — say so.
- Cite source references in parentheses where relevant. Be concise and serious. Plain prose, no JSON, no headings.`;

// GET /api/assistant/dossier?caseId=&nodeId=
router.get('/dossier', async (req, res) => {
  const { caseId, nodeId } = req.query;
  if (!caseId || !nodeId) return res.status(400).json({ error: 'caseId and nodeId are required' });

  try {
    const node = await GraphNode.findOne({ _id: nodeId, caseId });
    if (!node) return res.status(404).json({ error: 'Entity not found' });

    const [edges, allNodes, caseEvents] = await Promise.all([
      GraphEdge.find({ caseId, $or: [{ from: nodeId }, { to: nodeId }] }),
      GraphNode.find({ caseId }),
      Event.find({ caseId }),
    ]);
    const labelById = new Map(allNodes.map((n) => [String(n._id), `${n.label} (${n.type})`]));

    // Flagged events authored by this entity (sender resolves to this node).
    const authored = caseEvents.filter((ev) => {
      const id = classifyIdentifier(ev.fromRaw);
      return id && id.type === node.type && id.normalizedValue === node.normalizedValue && (ev.flags || []).length > 0;
    });

    const connectionLines = edges.map((e) => {
      const otherId = String(e.from) === String(nodeId) ? String(e.to) : String(e.from);
      const base = `${e.type} (x${e.count}) with ${labelById.get(otherId) || otherId}`;
      return e.type === 'same_owner' ? `${base} | confidence ${e.confidence} | why: ${e.reason}` : base;
    });
    const flagLines = authored.map((ev) =>
      `"${ev.content}" | flags: ${ev.flags.map((f) => `${f.category}(sev ${f.severity})`).join(', ')} | source: ${ev.sourceRef}`
    );

    let dossier;
    if (!process.env.OPENAI_API_KEY) {
      const so = edges.filter((e) => e.type === 'same_owner');
      const cats = [...new Set(authored.flatMap((ev) => ev.flags.map((f) => f.category)))];
      const parts = [`${node.label} is a ${node.type}${node.aliases?.length ? ` (also seen as ${node.aliases.join(', ')})` : ''}.`];
      parts.push(`Connected to ${edges.length} other entit${edges.length === 1 ? 'y' : 'ies'} in this case.`);
      if (authored.length) parts.push(`Authored ${authored.length} flagged event(s)${cats.length ? ` involving ${cats.join(', ')}` : ''}.`);
      if (so.length) parts.push(`AI hypothesises this entity shares an owner with ${so.length} other identit${so.length === 1 ? 'y' : 'ies'} (unconfirmed, see Graph for confidence).`);
      if (node.firstSeenIn?.length) parts.push(`First seen in ${node.firstSeenIn.slice(0, 3).join(', ')}.`);
      dossier = parts.join(' ');
    } else {
      const OpenAI = require('openai');
      const openai = new OpenAI();
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: DOSSIER_PROMPT },
          {
            role: 'user',
            content:
              `ENTITY: ${node.label} [${node.type}]\n` +
              `Aliases: ${(node.aliases || []).join(', ') || 'none'}\n` +
              `First seen: ${(node.firstSeenIn || []).join(', ') || 'unknown'}\n\n` +
              `CONNECTIONS:\n${connectionLines.join('\n') || 'none'}\n\n` +
              `FLAGGED EVENTS AUTHORED:\n${flagLines.join('\n') || 'none'}`,
          },
        ],
      });
      dossier = resp.choices[0].message.content.trim();
    }

    res.json({ nodeId, label: node.label, type: node.type, dossier });
  } catch (err) {
    console.error('[assistant] dossier failed:', err.message);
    res.status(500).json({ error: `Dossier failed: ${err.message}` });
  }
});

// POST /api/assistant  body: { question }
router.post('/', async (req, res) => {
  const question = (req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI assistant requires OPENAI_API_KEY in backend/.env' });
  }

  try {
    const ctx = await buildCaseContext(req.body.caseId);
    const OpenAI = require('openai');
    const openai = new OpenAI();
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `CASE DATA\n=== Entities ===\n${ctx.entities.join('\n')}\n\n` +
            `=== Relationships ===\n${ctx.relationships.join('\n')}\n\n` +
            `=== Leads ===\n${ctx.leads.join('\n')}\n\n` +
            `=== Flagged events ===\n${ctx.flaggedEvents.join('\n')}\n\n` +
            `QUESTION: ${question}`,
        },
      ],
    });
    const answer = resp.choices[0].message.content;

    await audit('ai', 'assistant_answered',
      `Investigator asked the AI assistant: "${question}" — the assistant answered from the case graph.`,
      [], req.body.caseId);
    res.json({ answer });
  } catch (err) {
    console.error('[assistant] failed:', err.message);
    res.status(500).json({ error: `Assistant failed: ${err.message}` });
  }
});

module.exports = router;
