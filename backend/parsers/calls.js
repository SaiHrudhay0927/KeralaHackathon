// Parses a call detail record CSV.
// Columns: caller,receiver,start_time,duration_seconds,call_type
// e.g. +917025688904,+919847022110,2026-05-07T22:04:00,11,answered

function parseCalls(text, filename) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iCaller = col('caller');
  const iReceiver = col('receiver');
  const iStart = col('start_time');
  const iDuration = col('duration_seconds');
  const iType = col('call_type');
  if (iCaller === -1 || iReceiver === -1 || iStart === -1) {
    throw new Error(`Unexpected CSV header in ${filename}: ${lines[0]}`);
  }

  const events = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim());
    if (cells.length < header.length) continue;
    const duration = parseInt(cells[iDuration], 10) || 0;
    const callType = cells[iType] || 'unknown';
    events.push({
      type: 'call',
      timestamp: new Date(cells[iStart]),
      fromRaw: cells[iCaller],
      toRaw: cells[iReceiver],
      content: `${callType} call, ${duration}s`,
      sourceRef: `${filename}:L${i + 1}`,
    });
  }
  return events;
}

module.exports = { parseCalls };
