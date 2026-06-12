// Verifies the demo suspect cluster appears in GET /api/graph.
// Expected: same_owner edges connecting the two phone numbers and the two
// Instagram handles used by the offender.
// Usage (server running, evidence uploaded): node scripts/verify-graph.js

const BASE = process.env.API_BASE || 'http://localhost:5000';

async function main() {
  const res = await fetch(`${BASE}/api/graph`);
  const { nodes, edges } = await res.json();
  console.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`);

  const byId = new Map(nodes.map((n) => [n._id, n]));
  const label = (id) => (byId.get(id) ? byId.get(id).label : id);

  const sameOwner = edges.filter((e) => e.type === 'same_owner');
  console.log(`\nsame_owner edges (${sameOwner.length}):`);
  for (const e of sameOwner) {
    console.log(`  ${label(e.from)} <-> ${label(e.to)}  conf=${e.confidence}`);
    console.log(`    reason: ${e.reason}`);
    console.log(`    sources: ${e.sourceRefs.join(', ')}`);
  }

  // Suspect cluster membership check via union-find over same_owner edges.
  const parent = new Map(nodes.map((n) => [n._id, n._id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const e of sameOwner) parent.set(find(e.from), find(e.to));

  const expected = ['9847355421', '7025688904', 'vsl.edits', 'shadow_walkr_07'];
  const found = expected.map((v) => nodes.find((n) => n.normalizedValue === v || n.normalizedValue.includes(v)));
  const missing = expected.filter((v, i) => !found[i]);
  if (missing.length) {
    console.error(`\nFAIL: missing expected nodes: ${missing.join(', ')}`);
    process.exit(1);
  }
  const clusters = new Set(found.map((n) => find(n._id)));
  if (clusters.size === 1) {
    console.log(`\nPASS: suspect cluster intact - ${found.map((n) => n.label).join(', ')} all connected via same_owner edges.`);
  } else {
    console.error(`\nFAIL: expected one suspect cluster, got ${clusters.size} disconnected groups:`);
    for (const n of found) console.error(`  ${n.label} -> cluster ${find(n._id)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
