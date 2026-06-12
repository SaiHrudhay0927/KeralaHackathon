// Prints the per-server error behind a MongoDB Atlas connection failure.
// Usage: node scripts/diagnose-mongo.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set in .env');
    process.exit(1);
  }
  console.log('URI host part:', uri.replace(/\/\/[^@]*@/, '//<credentials>@'));
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  dns.promises.setServers(['8.8.8.8', '1.1.1.1']);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log('CONNECTED OK');
    await mongoose.disconnect();
  } catch (err) {
    console.error('Connection failed:', err.message);
    const topo = err.reason;
    if (topo && topo.servers) {
      for (const [host, desc] of topo.servers) {
        console.error(`  server ${host}: type=${desc.type} error=${desc.error ? desc.error.message : 'none'}`);
      }
    }
    process.exit(1);
  }
}

main();
