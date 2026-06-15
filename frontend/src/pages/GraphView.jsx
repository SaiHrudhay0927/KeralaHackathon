import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { api } from '../api.js';

const NODE_COLORS = {
  phone: '#38bdf8',
  username: '#a78bfa',
  person: '#4ade80',
  email: '#fbbf24',
  location: '#fb923c',
  device: '#94a3b8',
};

const EXPLAIN_PROMPT =
  'Explain this case graph to me in simple terms: who are the key entities, how are they connected, who looks suspicious and why, and who appears uninvolved.';

export default function GraphView() {
  const [graph, setGraph] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [panelTab, setPanelTab] = useState('ai');
  const [chat, setChat] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [mention, setMention] = useState(null); // { start, query, index } while typing @…
  const fgRef = useRef();
  const wrapRef = useRef();
  const chatEndRef = useRef();
  const inputRef = useRef();
  const [size, setSize] = useState({ w: 800, h: 500 });

  useEffect(() => {
    api.graph().then(setGraph).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [graph]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, asking]);

  // Spread the layout out so labels don't overlap.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph) return;
    fg.d3Force('charge').strength(-400);
    fg.d3Force('link').distance((l) => (l.type === 'same_owner' ? 90 : 150));
    const t = setTimeout(() => fg.zoomToFit(600, 60), 700);
    return () => clearTimeout(t);
  }, [graph]);

  const data = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    // Curve edges so parallel links between the same two nodes don't overlap.
    const pairCount = new Map();
    const links = graph.edges.map((e) => {
      const key = [e.from, e.to].sort().join('|');
      const idx = pairCount.get(key) || 0;
      pairCount.set(key, idx + 1);
      return { ...e, source: e.from, target: e.to, curve: idx * 0.25 };
    });
    return { nodes: graph.nodes.map((n) => ({ ...n, id: n._id })), links };
  }, [graph]);

  const edgesByNode = useMemo(() => {
    const map = new Map();
    if (!graph) return map;
    for (const e of graph.edges) {
      for (const id of [e.from, e.to]) {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(e);
      }
    }
    return map;
  }, [graph]);

  const nodeById = useMemo(
    () => new Map((graph ? graph.nodes : []).map((n) => [n._id, n])),
    [graph]
  );

  function nodeRadius(node) {
    const deg = (edgesByNode.get(node.id || node._id) || []).length;
    const so = (edgesByNode.get(node.id || node._id) || []).filter((e) => e.type === 'same_owner').length;
    return 5 + Math.min(deg, 8) * 0.8 + so * 2;
  }

  function focusSuspectCluster() {
    if (!graph || !fgRef.current) return;
    let best = null;
    let bestCount = 0;
    for (const [nodeId, edges] of edgesByNode) {
      const count = edges.filter((e) => e.type === 'same_owner').length;
      if (count > bestCount) { bestCount = count; best = nodeId; }
    }
    if (!best) return;
    const node = data.nodes.find((n) => n.id === best);
    if (node) {
      fgRef.current.centerAt(node.x, node.y, 800);
      fgRef.current.zoom(3, 800);
      setSelected(node);
      setPanelTab('node');
    }
  }

  async function ask(q) {
    const text = (q || question).trim();
    if (!text || asking) return;
    setQuestion('');
    setMention(null);
    setChat((c) => [...c, { role: 'user', text }]);
    setAsking(true);
    try {
      const { answer } = await api.askAssistant(text);
      setChat((c) => [...c, { role: 'ai', text: answer }]);
    } catch (err) {
      setChat((c) => [...c, { role: 'ai', text: `Sorry — ${err.message}` }]);
    } finally {
      setAsking(false);
    }
  }

  // Entities matching the text typed after the most recent "@".
  const mentionMatches = useMemo(() => {
    if (!mention || !graph) return [];
    const q = mention.query.toLowerCase();
    return graph.nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          (n.aliases || []).some((a) => a.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [mention, graph]);

  function handleQuestionChange(e) {
    const value = e.target.value;
    setQuestion(value);
    // Detect an active "@token" ending at the caret (no spaces inside).
    const caret = e.target.selectionStart;
    const match = value.slice(0, caret).match(/@([^\s@]*)$/);
    if (match) setMention({ start: caret - match[0].length, query: match[1], index: 0 });
    else setMention(null);
  }

  function applyMention(node) {
    if (!mention) return;
    // Quote multi-word labels so the entity stays one token for the AI.
    const label = node.label.includes(' ') ? `"${node.label}"` : node.label;
    const before = question.slice(0, mention.start);
    const after = question.slice(mention.start + 1 + mention.query.length); // +1 for "@"
    const next = `${before}${label} ${after}`;
    setQuestion(next);
    setMention(null);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        const pos = (before + label + ' ').length;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(pos, pos);
      }
    });
  }

  function handleInputKeyDown(e) {
    if (!mention || mentionMatches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMention((m) => ({ ...m, index: (m.index + 1) % mentionMatches.length }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMention((m) => ({ ...m, index: (m.index - 1 + mentionMatches.length) % mentionMatches.length }));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); // select the entity instead of submitting
      applyMention(mentionMatches[mention.index]);
    } else if (e.key === 'Escape') {
      setMention(null);
    }
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!graph) return <div className="loading">Loading graph…</div>;

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Network Graph</h2>
        <button onClick={focusSuspectCluster}>Focus on suspect cluster</button>
        <span className="legend">
          {Object.entries(NODE_COLORS)
            .filter(([type]) => graph.nodes.some((n) => n.type === type))
            .map(([type, color]) => (
              <span key={type}><span className="dot" style={{ background: color }} />{type}</span>
            ))}
          <span><span style={{ borderTop: '2px dashed #f87171', display: 'inline-block', width: 18, marginRight: 4, verticalAlign: 'middle' }} />same owner (AI hypothesis)</span>
          <span><span style={{ borderTop: '1px solid #64748b', display: 'inline-block', width: 18, marginRight: 4, verticalAlign: 'middle' }} />communication</span>
        </span>
      </div>

      <div className="graph-wrap">
        <div className="graph-canvas" ref={wrapRef}>
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="#1e293b"
            nodeLabel={() => ''}
            nodeVal={(n) => nodeRadius(n)}
            nodeCanvasObjectMode={() => 'replace'}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const r = nodeRadius(node);
              const color = NODE_COLORS[node.type] || '#94a3b8';
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
              if (selected && (selected.id || selected._id) === node.id) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
              }
              const fontSize = Math.max(12 / globalScale, 3.5);
              ctx.font = `600 ${fontSize}px Segoe UI`;
              const textW = ctx.measureText(node.label).width;
              const ty = node.y + r + fontSize * 0.4;
              ctx.fillStyle = 'rgba(15,23,42,0.75)';
              ctx.fillRect(node.x - textW / 2 - 2, ty, textW + 4, fontSize * 1.25);
              ctx.fillStyle = '#f1f5f9';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(node.label, node.x, ty + fontSize * 0.12);
            }}
            linkCurvature={(l) => l.curve}
            linkColor={(l) => (l.type === 'same_owner' ? '#f87171' : '#64748b')}
            linkWidth={(l) => (l.type === 'same_owner' ? 3 : 1.2)}
            linkLineDash={(l) => (l.type === 'same_owner' ? [5, 4] : null)}
            linkDirectionalArrowLength={(l) => (l.type === 'same_owner' ? 0 : 4)}
            linkDirectionalArrowRelPos={0.55}
            linkDirectionalParticles={(l) => (l.type === 'same_owner' ? 2 : 0)}
            linkDirectionalParticleWidth={3}
            linkCanvasObjectMode={() => 'after'}
            linkCanvasObject={(link, ctx, globalScale) => {
              // Label edges with their type (and confidence for same_owner).
              if (globalScale < 1.2) return;
              const start = link.source;
              const end = link.target;
              if (typeof start !== 'object' || typeof end !== 'object') return;
              const mx = (start.x + end.x) / 2;
              const my = (start.y + end.y) / 2 - (link.curve || 0) * 18;
              const text = link.type === 'same_owner' ? `same owner ${Math.round(link.confidence * 100)}%` : `${link.type} ×${link.count}`;
              const fontSize = 9 / globalScale;
              ctx.font = `${fontSize}px Segoe UI`;
              const w = ctx.measureText(text).width;
              ctx.fillStyle = 'rgba(15,23,42,0.7)';
              ctx.fillRect(mx - w / 2 - 2, my - fontSize / 2 - 1, w + 4, fontSize + 2);
              ctx.fillStyle = link.type === 'same_owner' ? '#fca5a5' : '#94a3b8';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(text, mx, my);
            }}
            onNodeClick={(node) => { setSelected(node); setPanelTab('node'); }}
            onBackgroundClick={() => setSelected(null)}
          />
        </div>

        <div className="side-panel">
          <div className="tabs" style={{ marginBottom: 12 }}>
            <button className={panelTab === 'ai' ? 'on' : ''} onClick={() => setPanelTab('ai')}>AI Assistant</button>
            <button className={panelTab === 'node' ? 'on' : ''} onClick={() => setPanelTab('node')}>Node details</button>
          </div>

          {panelTab === 'ai' ? (
            <div className="chat">
              <button style={{ width: '100%', marginBottom: 10 }} onClick={() => ask(EXPLAIN_PROMPT)} disabled={asking}>
                Explain this graph
              </button>
              <div className="chat-messages">
                {chat.length === 0 && (
                  <div className="loading" style={{ padding: 8 }}>
                    Ask anything about the case — e.g. "Who is behind the harassment?",
                    "Is +91 9497011223 involved?", "What evidence links the two phone numbers?"
                  </div>
                )}
                {chat.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.role}`}>
                    <div className="who">{m.role === 'user' ? 'You' : 'AI Assistant'}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  </div>
                ))}
                {asking && <div className="chat-msg ai"><div className="who">AI Assistant</div>Analysing the case graph…</div>}
                <div ref={chatEndRef} />
              </div>
              <form
                className="chat-input"
                onSubmit={(e) => { e.preventDefault(); ask(); }}
              >
                {mention && mentionMatches.length > 0 && (
                  <div className="mention-dropdown">
                    <div className="mention-hint">Entities in this case — click or press Enter</div>
                    {mentionMatches.map((n, i) => (
                      <div
                        key={n._id}
                        className={`mention-item ${i === mention.index ? 'on' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); applyMention(n); }}
                        onMouseEnter={() => setMention((m) => ({ ...m, index: i }))}
                      >
                        <span className="dot" style={{ background: NODE_COLORS[n.type] || '#94a3b8' }} />
                        <span className="mention-label">{n.label}</span>
                        <span className="mention-type">{n.type}</span>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={inputRef}
                  value={question}
                  onChange={handleQuestionChange}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Ask about the case… (type @ to mention an entity)"
                  disabled={asking}
                />
                <button type="submit" disabled={asking || !question.trim()}>Ask</button>
              </form>
            </div>
          ) : !selected ? (
            <div className="loading">Click a node in the graph to inspect it.</div>
          ) : (
            <div>
              <h3>{selected.label}</h3>
              <p className="mono">type: {selected.type}</p>
              {selected.aliases?.length > 0 && (
                <p className="mono">also seen as: {selected.aliases.join(', ')}</p>
              )}
              <h3 style={{ marginTop: 14 }}>Connections</h3>
              {(edgesByNode.get(selected.id || selected._id) || []).map((e) => {
                const otherId = e.from === (selected.id || selected._id) ? e.to : e.from;
                const other = nodeById.get(otherId);
                return (
                  <div key={e._id} className="edge-item">
                    <strong style={{ color: e.type === 'same_owner' ? '#f87171' : '#38bdf8' }}>
                      {e.type.replace('_', ' ')}
                    </strong>{' '}
                    ↔ {other ? other.label : otherId} (×{e.count}
                    {e.type === 'same_owner' ? `, confidence ${Math.round(e.confidence * 100)}%` : ''})
                    {e.reason && <div style={{ color: '#94a3b8', marginTop: 2 }}>{e.reason}</div>}
                    <div className="mono" style={{ marginTop: 2 }}>
                      {e.sourceRefs.slice(0, 3).join('; ')}
                      {e.sourceRefs.length > 3 ? ` (+${e.sourceRefs.length - 3} more)` : ''}
                    </div>
                  </div>
                );
              })}
              <h3 style={{ marginTop: 14 }}>First seen in</h3>
              <div className="mono">
                {(selected.firstSeenIn || []).slice(0, 6).map((ref) => (
                  <div key={ref}>{ref}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
