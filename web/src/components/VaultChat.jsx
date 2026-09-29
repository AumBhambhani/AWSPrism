import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client.js";

const WELCOME = "Hi! I'm your AskTheChamp assistant. Ask me anything about your policy documents — I'll search your vault and give you a precise answer.";

export default function VaultChat({ token }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", content: WELCOME }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 120);
    }
  }, [open]);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput("");
    setError("");
    const next = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setLoading(true);

    try {
      const history = next.slice(1, -1).map(m => ({ role: m.role, content: m.content }));
      const data = await apiFetch("/api/vault/chat", {
        token,
        method: "POST",
        body: { message: msg, history },
        timeout: 60000,
      });
      setMessages(prev => [...prev, { role: "assistant", content: data.reply, sources: data.sources }]);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setMessages(prev => prev.slice(0, -1));
      setInput(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const toggle = () => setOpen(o => !o);

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed", bottom: 92, right: 24, zIndex: 9980,
            width: 390, maxWidth: "calc(100vw - 32px)",
            height: 540, maxHeight: "calc(100vh - 110px)",
            background: "var(--bg)", borderRadius: 20,
            boxShadow: "0 28px 72px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            animation: "chatSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "14px 18px 12px",
            background: "var(--accent-gradient)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: "rgba(255,255,255,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 17,
              }}>✨</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>AskTheChamp</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: "var(--mono)" }}>Policy vault assistant</div>
              </div>
            </div>
            <button
              onClick={toggle}
              style={{
                background: "rgba(255,255,255,0.18)", border: "none", borderRadius: 8,
                width: 28, height: 28, cursor: "pointer", color: "#fff",
                fontSize: 18, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >×</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "16px 14px 8px",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {loading && <TypingIndicator />}

            {error && (
              <div style={{
                fontSize: 12, color: "var(--red)", padding: "8px 12px",
                background: "rgba(214,91,91,0.1)", borderRadius: 8,
              }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} style={{ height: 1 }} />
          </div>

          {/* Input */}
          <div style={{
            padding: "10px 12px 12px",
            borderTop: "1px solid var(--bg3)",
            display: "flex", gap: 8, alignItems: "flex-end",
            flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about your policies…"
              rows={1}
              disabled={loading}
              style={{
                flex: 1, resize: "none", padding: "9px 12px",
                borderRadius: 10, border: "none",
                background: "var(--bg3)", color: "var(--text)",
                fontSize: 13, fontFamily: "var(--sans)",
                boxShadow: "var(--neu-inset-sm)", outline: "none",
                lineHeight: 1.4, maxHeight: 80, overflowY: "auto",
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              style={{
                width: 34, height: 34, borderRadius: 9, border: "none",
                background: input.trim() && !loading ? "var(--accent)" : "var(--bg4)",
                color: input.trim() && !loading ? "#fff" : "var(--text3)",
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 0.15s",
              }}
            >↑</button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={toggle}
        title="AskTheChamp — Ask about your policies"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9981,
          width: 56, height: 56, borderRadius: "50%", border: "none",
          background: open ? "var(--bg3)" : "var(--accent-gradient)",
          boxShadow: open
            ? "var(--neu-raised)"
            : "0 8px 28px rgba(62,87,113,0.45), 0 2px 8px rgba(0,0,0,0.2)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: open ? 22 : 24,
          color: open ? "var(--text2)" : "#fff",
          transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)",
          transform: open ? "rotate(45deg) scale(0.96)" : "rotate(0deg) scale(1)",
        }}
      >
        {open ? "+" : "✨"}
      </button>

      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        @keyframes vaultChatBounce {
          0%,80%,100% { transform: scale(0.4); opacity: 0.4; }
          40%          { transform: scale(1);   opacity: 1;   }
        }
      `}</style>
    </>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "86%", padding: "9px 13px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser ? "var(--accent)" : "var(--bg3)",
        color: isUser ? "#fff" : "var(--text)",
        fontSize: 13, lineHeight: 1.55,
        boxShadow: isUser ? "0 2px 8px rgba(110,140,174,0.3)" : "var(--neu-raised-sm)",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {message.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <div style={{
        padding: "10px 14px", borderRadius: "14px 14px 14px 4px",
        background: "var(--bg3)", boxShadow: "var(--neu-raised-sm)",
        display: "flex", gap: 5, alignItems: "center",
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: "var(--text3)",
            animation: `vaultChatBounce 1.2s ease-in-out ${i * 0.18}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}
