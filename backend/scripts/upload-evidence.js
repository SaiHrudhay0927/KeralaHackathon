// Uploads one or more evidence files to the running backend.
// Usage: node scripts/upload-evidence.js <file1> [file2] [file3]
// Example:
//   node scripts/upload-evidence.js ..\..\whatsapp_chat_ananya.txt ..\..\call_records.csv ..\..\instagram_dms.json

const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:5000';

async function uploadFile(filePath, caseId) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), path.basename(filePath));
  if (caseId) form.append('caseId', caseId);

  const res = await fetch(`${BASE}/api/evidence/upload`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`${filePath}: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const caseId = process.env.CASE_ID;
  const files = process.argv.slice(2);
  if (files.length === 0 || !caseId) {
    console.error('Usage: CASE_ID=<id> node scripts/upload-evidence.js <file1> [file2] ...');
    console.error('(set CASE_ID env var to the target case _id from /api/cases)');
    process.exit(1);
  }
  for (const f of files) {
    console.log(`\n=== Uploading ${f} ===`);
    const result = await uploadFile(f, caseId);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
