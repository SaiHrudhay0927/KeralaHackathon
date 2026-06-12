// Standalone parser smoke test against the real sample evidence files.
// Usage: node scripts/test-parsers.js <dir-containing-sample-files>

const fs = require('fs');
const path = require('path');
const { parseWhatsapp } = require('../parsers/whatsapp');
const { parseCalls } = require('../parsers/calls');
const { parseInstagram } = require('../parsers/instagram');

const dir = process.argv[2] || '.';
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const wa = parseWhatsapp(read('whatsapp_chat_ananya.txt'), 'whatsapp_chat_ananya.txt');
console.log('WhatsApp events:', wa.length);
console.log('  first:', JSON.stringify(wa[0]));
console.log('  identity-slip line:', JSON.stringify(wa.find((e) => e.content.includes('70256'))));

const calls = parseCalls(read('call_records.csv'), 'call_records.csv');
console.log('Call events:', calls.length);
console.log('  first:', JSON.stringify(calls[0]));

const ig = parseInstagram(read('instagram_dms.json'), 'instagram_dms.json');
console.log('Instagram events:', ig.events.length, '| account:', ig.account);
console.log('  bio event:', JSON.stringify(ig.events.find((e) => e.sourceRef.includes('bio'))));
console.log('  shadow msg:', JSON.stringify(ig.events.find((e) => e.fromRaw === 'shadow_walkr_07')));
