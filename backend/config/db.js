const mongoose = require('mongoose');
const dns = require('dns');

let memoryServer = null;
let connectPromise = null;

// Keeps data in a named database even when the URI omits the path
// (Atlas "Connect" strings often end at the host).
const CONNECT_OPTS = { dbName: process.env.MONGO_DB || 'evidence_platform' };

async function connectWithSrvFallback(uri) {
  try {
    return await mongoose.connect(uri, CONNECT_OPTS);
  } catch (err) {
    // Some local/ISP DNS resolvers refuse the SRV queries that
    // mongodb+srv:// URIs require, while normal lookups still work.
    // Retry once with public DNS servers for Node's resolver.
    if (err.syscall === 'querySrv' && uri.startsWith('mongodb+srv://')) {
      console.warn('[db] SRV DNS lookup refused by local resolver - retrying with public DNS (8.8.8.8, 1.1.1.1)');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
      dns.promises.setServers(['8.8.8.8', '1.1.1.1']);
      return await mongoose.connect(uri, CONNECT_OPTS);
    }
    throw err;
  }
}

async function connectDb() {
  // Cache the connection across serverless invocations (Vercel reuses the
  // process between requests; reconnecting every time would be slow).
  if (connectPromise) return connectPromise;
  connectPromise = doConnect().catch((err) => {
    connectPromise = null; // allow retry on next request
    throw err;
  });
  return connectPromise;
}

async function doConnect() {
  let uri = process.env.MONGO_URI;
  let mode = 'env';

  if (!uri && process.env.VERCEL) {
    throw new Error('MONGO_URI must be set in production (in-memory MongoDB is dev-only).');
  }
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('evidence_platform');
    mode = 'in-memory';
    console.warn(
      '[db] MONGO_URI not set - using in-memory MongoDB (data is lost on restart). ' +
        'Set MONGO_URI in backend/.env for a real database.'
    );
  }

  await connectWithSrvFallback(uri);
  console.log(`[db] connected (${mode})`);
  return { mode, uri };
}

async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

module.exports = { connectDb, disconnectDb };
