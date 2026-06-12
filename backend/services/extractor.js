// Entity/event extraction service.
// Primary path: OpenAI chat completion returning strict JSON.
// Fallback path (no OPENAI_API_KEY): deterministic regex + keyword heuristics,
// so the full pipeline works offline. Every extraction is written to AuditLog
// and tagged with which engine produced it.

const Event = require('../models/Event');
const { audit } = require('./audit');

const BATCH_SIZE = 30;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Indian mobile numbers in free text: optional +91/91 prefix, 10 digits,
// possibly split by spaces/dashes (e.g. "70256 88904", "+91 98473 55421").
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function findPhonesInText(text) {
  return (text.match(PHONE_RE) || []).map((p) => p.trim());
}

// ---------------------------------------------------------------------------
// Fallback (rule-based) extraction
// ---------------------------------------------------------------------------

const THREAT_PATTERNS = [
  /i will post/i, /goes public/i, /i know where/i, /shouldn'?t walk alone/i,
  /can'?t (find|block)/i, /or your .* (goes|will)/i, /pick up my calls or/i,
];
const DOXXING_PATTERNS = [
  /class section/i, /bus route/i, /father'?s shop/i, /where you live/i,
];
const IDENTITY_SLIP_PATTERNS = [
  /other (number|one)/i, /reach you from/i, /new account/i, /my edits account/i,
  /blocked my number/i, /block this number/i, /make a new one/i,
];
const STALKING_PATTERNS = [
  /you wore/i, /near the .* (bus stop|stop|junction)/i, /saw you (left|at)/i,
  /following (you|me)/i, /i (just )?notice things/i, /i checked/i, /closes at/i,
];

function fallbackExtractBatch(events) {
  const entities = [];
  const flags = [];

  for (const ev of events) {
    const text = ev.content || '';

    for (const phone of findPhonesInText(text)) {
      entities.push({ type: 'phone', value: phone, sourceRef: ev.sourceRef });
    }
    for (const email of text.match(EMAIL_RE) || []) {
      entities.push({ type: 'email', value: email, sourceRef: ev.sourceRef });
    }

    const matched = [];
    if (IDENTITY_SLIP_PATTERNS.some((re) => re.test(text)) || (findPhonesInText(text).length > 0 && /\b(call|reach|dm)\b/i.test(text))) {
      matched.push({ category: 'identity_slip', severity: 4, reason: 'Mentions an alternate number/account or embeds a contact number.' });
    }
    if (THREAT_PATTERNS.some((re) => re.test(text))) {
      matched.push({ category: 'threat', severity: 5, reason: 'Threatening/coercive language.' });
    }
    if (DOXXING_PATTERNS.some((re) => re.test(text))) {
      matched.push({ category: 'doxxing', severity: 4, reason: 'References private identifying details (school/route/family).' });
    }
    if (STALKING_PATTERNS.some((re) => re.test(text))) {
      matched.push({ category: 'meeting_attempt', severity: 3, reason: 'Indicates physical surveillance or proximity.' });
    }

    for (const f of matched) {
      flags.push({ eventSourceRef: ev.sourceRef, ...f });
    }
  }

  return { entities, flags };
}

// ---------------------------------------------------------------------------
// LLM extraction (OpenAI)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an evidence-analysis assistant for a police cybercrime investigation (synthetic training data).
You receive a JSON array of communication events: { sourceRef, type, from, to, timestamp, content }.
Return STRICT JSON only, no prose, no markdown fences, with this exact shape:
{
  "entities": [{ "type": "person"|"phone"|"username"|"email"|"location"|"device", "value": "...", "sourceRef": "..." }],
  "flags": [{ "eventSourceRef": "...", "category": "threat"|"doxxing"|"identity_slip"|"meeting_attempt"|"none", "severity": 1-5, "reason": "..." }]
}
Rules:
- Extract entities that appear INSIDE message content (phone numbers, usernames, emails, locations, names).
- "identity_slip" = a message revealing an alternate contact identity (another phone number, another account). These are critical.
- Only flag events that genuinely warrant it; omit "none" flags.
- Every entity and flag must carry the sourceRef of the event it came from.`;

function stripJsonFences(s) {
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

async function llmExtractBatch(openai, events) {
  const payload = events.map((ev) => ({
    sourceRef: ev.sourceRef,
    type: ev.type,
    from: ev.fromRaw,
    to: ev.toRaw,
    timestamp: ev.timestamp,
    content: ev.content,
  }));

  const ask = async () => {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0,
    });
    return stripJsonFences(resp.choices[0].message.content || '');
  };

  let raw = await ask();
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Defensive retry once on malformed JSON.
    raw = await ask();
    return JSON.parse(raw);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getEngine() {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    return { name: 'openai', client: new OpenAI() };
  }
  return { name: 'fallback-rules', client: null };
}

/**
 * Runs extraction over all events of an evidence file.
 * Persists flags onto the Event documents and returns the extracted entities
 * (with identity_slip flags) for the resolver.
 */
async function extractForEvidenceFile(evidenceFile) {
  const events = await Event.find({ evidenceFileId: evidenceFile._id });
  const engine = getEngine();
  const allEntities = [];
  const allFlags = [];

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    let result;
    if (engine.name === 'openai') {
      try {
        result = await llmExtractBatch(engine.client, batch);
      } catch (err) {
        console.error('[extractor] LLM extraction failed, using fallback rules:', err.message);
        await audit('ai', 'extraction_llm_failed',
          `The AI model could not analyse part of "${evidenceFile.filename}" (${err.message}), so built-in rule-based analysis was used for those events instead.`,
          [evidenceFile._id], evidenceFile.caseId);
        result = fallbackExtractBatch(batch);
      }
    } else {
      result = fallbackExtractBatch(batch);
    }

    const entities = Array.isArray(result.entities) ? result.entities : [];
    const flags = Array.isArray(result.flags) ? result.flags : [];
    allEntities.push(...entities);
    allFlags.push(...flags);

    const engineLabel = engine.name === 'openai' ? 'The AI model' : 'Built-in rule-based analysis';
    await audit('ai', 'extraction_batch',
      `${engineLabel} reviewed ${batch.length} events from "${evidenceFile.filename}" and found ${entities.length} identifier(s) (phone numbers, accounts, places) and ${flags.length} warning flag(s).`,
      [evidenceFile._id], evidenceFile.caseId);
  }

  // Persist flags onto their events.
  const bySourceRef = new Map(events.map((ev) => [ev.sourceRef, ev]));
  for (const flag of allFlags) {
    const ev = bySourceRef.get(flag.eventSourceRef);
    if (!ev || flag.category === 'none') continue;
    ev.flags.push({
      category: flag.category,
      severity: Math.min(5, Math.max(1, Number(flag.severity) || 1)),
      reason: flag.reason || '',
    });
  }
  await Promise.all(events.filter((ev) => ev.flags.length > 0).map((ev) => ev.save()));

  evidenceFile.status = 'extracted';
  await evidenceFile.save();
  await audit('ai', 'extraction_complete',
    `Finished analysing "${evidenceFile.filename}": ${allEntities.length} identifier(s) and ${allFlags.length} warning flag(s) found in total.`,
    [evidenceFile._id], evidenceFile.caseId);

  return { entities: allEntities, flags: allFlags, engine: engine.name };
}

module.exports = { extractForEvidenceFile, findPhonesInText };
