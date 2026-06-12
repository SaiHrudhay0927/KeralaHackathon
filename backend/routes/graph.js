const express = require('express');
const GraphNode = require('../models/GraphNode');
const GraphEdge = require('../models/GraphEdge');

const router = express.Router();

// GET /api/graph?caseId= -> { nodes, edges }
router.get('/', async (req, res) => {
  const filter = req.query.caseId ? { caseId: req.query.caseId } : {};
  const [nodes, edges] = await Promise.all([GraphNode.find(filter), GraphEdge.find(filter)]);
  res.json({ nodes, edges });
});

module.exports = router;
