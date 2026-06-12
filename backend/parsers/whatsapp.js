// Parses a WhatsApp .txt export.
// Line format: `02/05/2026, 7:42 pm - +91 98473 55421: message text`
// Sender may be a phone number or a saved contact name (e.g. "Ananya").
// Lines that don't match are continuations of the previous message.

const LINE_RE = /^(\d{2})\/(\d{2})\/(\d{4}),\s+(\d{1,2}):(\d{2})\s*(am|pm)\s+-\s+([^:]+?):\s(.*)$/i;

function parseTimestamp(dd, mm, yyyy, hh, min, ampm) {
  let hours = parseInt(hh, 10);
  const isPm = ampm.toLowerCase() === 'pm';
  if (isPm && hours !== 12) hours += 12;
  if (!isPm && hours === 12) hours = 0;
  return new Date(
    parseInt(yyyy, 10),
    parseInt(mm, 10) - 1,
    parseInt(dd, 10),
    hours,
    parseInt(min, 10)
  );
}

function parseWhatsapp(text, filename) {
  const lines = text.split(/\r?\n/);
  const events = [];
  let current = null;

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const m = line.match(LINE_RE);
    if (m) {
      if (current) events.push(current);
      const [, dd, mm, yyyy, hh, min, ampm, sender, body] = m;
      current = {
        type: 'message',
        timestamp: parseTimestamp(dd, mm, yyyy, hh, min, ampm),
        fromRaw: sender.trim(),
        toRaw: null, // filled in below once participants are known
        content: body,
        sourceRef: `${filename}:L${lineNo}`,
      };
    } else if (current && line.trim() !== '') {
      current.content += '\n' + line;
    }
  });
  if (current) events.push(current);

  // In a 1:1 chat export with exactly two senders, the recipient of each
  // message is the other participant.
  const senders = [...new Set(events.map((e) => e.fromRaw))];
  if (senders.length === 2) {
    for (const e of events) {
      e.toRaw = senders.find((s) => s !== e.fromRaw);
    }
  }

  return events;
}

module.exports = { parseWhatsapp };
