const express = require('express');
const GraphNode = require('../models/GraphNode');
const GraphEdge = require('../models/GraphEdge');
const Event = require('../models/Event');
const Lead = require('../models/Lead');
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
