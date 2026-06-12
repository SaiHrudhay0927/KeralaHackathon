// Vercel serverless entry: all /api/* requests are rewritten here (see
// vercel.json) and handled by the same Express app used locally.
const app = require('../backend/app');
const { connectDb } = require('../backend/config/db');

module.exports = async (req, res) => {
  try {
    await connectDb();
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Database connection failed: ${err.message}` }));
    return;
  }
  return app(req, res);
};
