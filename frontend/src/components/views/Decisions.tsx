'use client';

// "Decision copilot" view — faithful port of template.html lines 451-503 plus
// the copilot logic from the design's app-script.js (sendChat / runComplete /
// think-step animation). Data wiring per CONTRACT §5: POST
// /api/command-centre/copilot { messages }; on any failure the design's exact
// fallback sentence is rendered.

import { useEffect, useRef, useState } from 'react';
import { apiPost } from '@/lib/api';
import { chipDefs, thinkSteps } from '@/lib/designData';
import { FONT } from '@/lib/format';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: boolean;
}

interface CopilotResponse {
  answer: string;
  matched: { kind: 'lane' | 'function' | 'watchlist' | 'general'; id: string | null };
}

// Verbatim from app-script.js runComplete's catch branch.
const FALLBACK_ANSWER =
  'I couldn’t reach the analysis service just now — please try again in a moment. The figures on each budget page are still current in the meantime.';

export default function Decisions() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [thinkStep, setThinkStep] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirror of the design's componentDidUpdate: keep #cc-scroll pinned to the
  // bottom whenever messages or the think step change.
  useEffect(() => {
    const el = document.getElementById('cc-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinkStep]);

  // Mirror of componentWillUnmount: clear the think-step timer.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function runComplete(apiMsgs: Array<{ role: 'user' | 'assistant'; content: string }>) {
    const fallback: CopilotResponse = {
      answer: FALLBACK_ANSWER,
      matched: { kind: 'general', id: null },
    };
    // The copilot may run through the local LLM (tens of seconds), so override
    // the 3s default timeout; the backend gives up at ~45s and falls back.
    const res = await apiPost<CopilotResponse>('/command-centre/copilot', { messages: apiMsgs }, fallback, 60_000);
    const answer =
      res && typeof res.answer === 'string' && res.answer.trim() ? res.answer : FALLBACK_ANSWER;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setMessages((prev) => {
      const m = [...prev];
      for (let i = m.length - 1; i >= 0; i--) {
        if (m[i].thinking) {
          m[i] = { role: 'assistant', content: answer, thinking: false };
          break;
        }
      }
      return m;
    });
    setThinking(false);
  }

  function sendChat(text?: string) {
    const q = (text == null ? chatInput : text).trim();
    if (!q || thinking) return;
    const convo: ChatMessage[] = [...messages.filter((m) => !m.thinking), { role: 'user', content: q }];
    setMessages([...convo, { role: 'assistant', content: '', thinking: true }]);
    setChatInput('');
    setThinking(true);
    setThinkStep(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setThinkStep((s) => Math.min(s + 1, thinkSteps.length - 1));
    }, 750);
    void runComplete(convo.map((m) => ({ role: m.role, content: m.content })));
  }

  const emptyState = messages.length === 0;

  const thinkStepsView = thinkSteps.map((t, i) => ({
    text: t,
    opacity: i <= thinkStep ? '1' : '0.32',
    dotColor: i < thinkStep ? '#3E7A55' : i === thinkStep ? '#8A6A2A' : '#D8D5CE',
    anim: i === thinkStep ? 'cc-pulse 1.1s ease-in-out infinite' : 'none',
  }));

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {emptyState && (
        <div style={{ textAlign: 'center', padding: '32px 0 26px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sda-logo.png"
            alt="AI"
            style={{ width: 46, height: 46, borderRadius: 11, display: 'inline-block' }}
          />
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 300,
              fontSize: 24,
              color: '#1B2430',
              marginTop: 16,
            }}
          >
            What decision are you weighing up?
          </div>
          <div
            style={{
              fontSize: 14,
              color: '#757C86',
              margin: '8px auto 0',
              lineHeight: 1.5,
              maxWidth: 470,
            }}
          >
            Ask in plain language — the copilot checks it against the approved FY2026 budget,
            current spend and elapsed-year pace, then answers.
          </div>
        </div>
      )}

      {messages.map((m, idx) => (
        <div key={idx} style={{ marginBottom: 20 }}>
          {m.role === 'user' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div
                style={{
                  maxWidth: '82%',
                  background: '#1B2430',
                  color: '#FBFBF9',
                  borderRadius: '15px 15px 4px 15px',
                  padding: '12px 16px',
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                {m.content}
              </div>
            </div>
          )}
          {m.role === 'assistant' && (
            <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/sda-logo.png"
                alt="AI"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: 'block',
                  flex: 'none',
                  marginTop: 1,
                }}
              />
              <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                {m.thinking && (
                  <div>
                    {thinkStepsView.map((st, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 9,
                          opacity: st.opacity,
                          fontSize: 12.5,
                          color: '#757C86',
                          transition: 'opacity .3s ease',
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: st.dotColor,
                            flex: 'none',
                            animation: st.anim,
                          }}
                        />
                        {st.text}
                      </div>
                    ))}
                  </div>
                )}
                {!m.thinking && (
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.62,
                      color: '#28303B',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
        {chipDefs.map((q) => (
          <button
            key={q}
            className="navbtn"
            onClick={() => sendChat(q)}
            style={{
              border: '1px solid #E7E5DF',
              background: '#FFFFFF',
              borderRadius: 999,
              padding: '8px 14px',
              fontFamily: FONT,
              fontSize: 12.5,
              color: '#39424F',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          border: '1px solid #E7E5DF',
          background: '#FFFFFF',
          borderRadius: 13,
          padding: '7px 7px 7px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendChat();
            }
          }}
          placeholder="Ask about a budget decision…"
          style={{
            flex: 1,
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontFamily: FONT,
            fontSize: 14,
            color: '#1B2430',
          }}
        />
        <button
          onClick={() => sendChat()}
          style={{
            border: 0,
            borderRadius: 9,
            background: '#1B2430',
            color: '#FBFBF9',
            padding: '10px 18px',
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          Ask
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: '#9AA0A8', marginTop: 10, lineHeight: 1.5 }}>
        Decision support generated from illustrative FY2026 figures — not an approval,
        restricted-funding check, or live-cash statement.
      </div>
    </div>
  );
}
