import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const SUGGESTIONS = [
  'Who is the prime suspect and why?',
  'What evidence links the two phone numbers?',
  'Which contacts appear uninvolved?',
  'Summarise the most serious threats in this case.',
];

// Global assistant: a floating launcher that opens a chat drawer on any case
// page. Talks to the same /api/assistant endpoint as the Graph view.
export default function AskAI() {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const endRef = useRef();

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, asking, open]);

  async function ask(q) {
    const text = (q || question).trim();
    if (!text || asking) return;
    setQuestion('');
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

  return (
    <>
      {!open && (
        <button className="askai-launcher" onClick={() => setOpen(true)} aria-label="Ask AI">
          🧠 Ask AI
        </button>
      )}

      {open && (
        <div className="askai-drawer">
          <div className="askai-head">
            <span className="askai-title">🧠 AI Assistant</span>
            <button className="askai-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <div className="chat-messages askai-messages">
            {chat.length === 0 && (
              <div className="loading" style={{ padding: 8 }}>
                Ask anything about this case. Answers are grounded in the case graph and cite their sources.
                <div className="askai-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="askai-chip" onClick={() => ask(s)} disabled={asking}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                <div className="who">{m.role === 'user' ? 'You' : 'AI Assistant'}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              </div>
            ))}
            {asking && <div className="chat-msg ai"><div className="who">AI Assistant</div>Analysing the case graph…</div>}
            <div ref={endRef} />
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about the case…"
              disabled={asking}
            />
            <button type="submit" disabled={asking || !question.trim()}>Ask</button>
          </form>
        </div>
      )}
    </>
  );
}
