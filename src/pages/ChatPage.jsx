import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { chatWithPipeline } from '../lib/anthropic';

const QUICK_PROMPTS = [
  'Who should I prioritize this week?',
  'What\'s the state of my pipeline?',
  'Which companies are overdue for a follow-up?',
  'Give me a pep talk about the week ahead.',
  'What\'s the Dan Allard rule for Touch 3?',
  'How many touches until I should close the loop?',
];

async function buildPipelineSummary() {
  const [{ data: entries }, { data: companies }, { data: touches }] = await Promise.all([
    supabase.from('pipeline_entries').select('*'),
    supabase.from('companies').select('id,name,icp_score,icp_tier,recommended_angle,contacts,overall_score'),
    supabase.from('touches').select('*'),
  ]);

  if (!entries?.length) return 'Pipeline is empty. No companies added yet.';

  const compMap = {};
  (companies || []).forEach(c => { compMap[c.id] = c; });

  const lines = [];
  lines.push(`Total pipeline entries: ${entries.length}`);
  lines.push(`Active: ${entries.filter(e => e.status === 'active').length}`);
  lines.push(`Responded: ${entries.filter(e => e.status === 'responded').length}`);
  lines.push(`Won: ${entries.filter(e => e.status === 'won').length}`);
  lines.push('');
  lines.push('COMPANIES IN PIPELINE:');

  entries.slice(0, 30).forEach(entry => {
    const c = compMap[entry.company_id] || {};
    const entryTouches = (touches || []).filter(t => t.pipeline_entry_id === entry.id);
    const sentCount = entryTouches.filter(t => t.status === 'sent').length;
    const lastSent  = entryTouches.filter(t => t.status === 'sent' && t.sent_date).sort((a,b) => new Date(b.sent_date) - new Date(a.sent_date))[0];
    const daysSinceLast = lastSent ? Math.floor((Date.now() - new Date(lastSent.sent_date).getTime()) / 86400000) : null;
    const contact = (c.contacts || [])[0];

    lines.push(`- ${c.name || 'Unknown'} | Status: ${entry.status} | Touch: ${entry.current_touch || 0}/5 | Sent: ${sentCount} | ${daysSinceLast !== null ? `Last touch ${daysSinceLast}d ago` : 'No touches sent yet'}${contact ? ` | Contact: ${contact.name}` : ''}${c.icp_score ? ` | ICP: ${c.icp_score}/10` : ''}`);
  });

  if (entries.length > 30) lines.push(`... and ${entries.length - 30} more.`);
  return lines.join('\n');
}

export default function ChatPage() {
  const [messages, setMessages]   = useState([
    { role: 'assistant', content: 'Hey! I\'m your Part Human sales assistant. I have full visibility into your pipeline.\n\nAsk me anything — who to prioritize, what to say next, or just get a read on where things stand.' }
  ]);
  const [input, setInput]         = useState('');
  const [sending, setSending]     = useState(false);
  const [summary, setSummary]     = useState('');
  const bottomRef = useRef();
  const textareaRef = useRef();

  useEffect(() => {
    buildPipelineSummary().then(setSummary);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (text) => {
    const content = text || input.trim();
    if (!content || sending) return;
    setInput('');
    const userMsg = { role: 'user', content };
    setMessages(m => [...m, userMsg]);
    setSending(true);
    try {
      const history = [...messages, userMsg]
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));
      const reply = await chatWithPipeline(history, summary || 'Pipeline data loading…');
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ Error: ${e.message}` }]);
    } finally {
      setSending(false);
    }
  }, [input, messages, sending, summary]);

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>💬 AI Assistant</h2>
          <p>Ask about your pipeline, get email help, or think through your strategy</p>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)', paddingBottom: 0 }}>
        <div className="quick-prompts">
          {QUICK_PROMPTS.map(p => (
            <button key={p} className="quick-prompt" onClick={() => send(p)} disabled={sending}>
              {p}
            </button>
          ))}
        </div>

        <div className="chat-messages" style={{ flex: 1, overflowY: 'auto' }}>
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-avatar">
                {m.role === 'assistant' ? '🤖' : '👤'}
              </div>
              <div className="chat-bubble">{m.content}</div>
            </div>
          ))}
          {sending && (
            <div className="chat-msg assistant">
              <div className="chat-avatar">🤖</div>
              <div className="chat-bubble" style={{ color: 'var(--text-muted)' }}>
                <span className="spinner" /> Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row" style={{ paddingBottom: 20 }}>
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="Ask anything about your pipeline… (Enter to send, Shift+Enter for new line)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            disabled={sending}
          />
          <button
            className="btn btn-primary"
            onClick={() => send()}
            disabled={!input.trim() || sending}
            style={{ alignSelf: 'flex-end' }}
          >
            {sending ? <span className="spinner" /> : '→ Send'}
          </button>
        </div>
      </div>
    </>
  );
}
