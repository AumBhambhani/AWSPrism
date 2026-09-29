import { useState, useRef, useEffect } from "react";

export default function DependencySelect({ allQuestions = [], value = [], onChange, selfQuestId }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = allQuestions.filter(q => value.includes(q.questId || q.quest_id));
  const available = allQuestions.filter(q => {
    const id = q.questId || q.quest_id;
    return (
      id !== selfQuestId &&
      !value.includes(id) &&
      (!search ||
        id.toLowerCase().includes(search.toLowerCase()) ||
        (q.controlArea || q.control_area || "").toLowerCase().includes(search.toLowerCase()))
    );
  });

  const add = (questId) => {
    onChange([...value, questId]);
    setSearch("");
    setOpen(false);
  };

  const remove = (questId) => {
    onChange(value.filter(id => id !== questId));
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {selected.map(q => {
            const id = q.questId || q.quest_id;
            const area = q.controlArea || q.control_area;
            return (
              <span key={id} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "var(--bg4)", border: "1px solid var(--border2)",
                borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "var(--text)",
              }}>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{id}</span>
                {area && <span style={{ color: "var(--text3)" }}>— {area}</span>}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                  title="Remove"
                >×</button>
              </span>
            );
          })}
        </div>
      )}
      <input
        type="text"
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={value.length === 0 ? "Search to add dependencies..." : "Add more dependencies..."}
        style={{
          width: "100%", padding: "7px 10px", background: "var(--bg4)",
          border: "1px solid var(--border2)", borderRadius: 5,
          color: "var(--text)", fontSize: 12, boxSizing: "border-box",
        }}
      />
      {open && available.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
          background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5,
          maxHeight: 180, overflow: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          marginTop: 2,
        }}>
          {available.map(q => {
            const id = q.questId || q.quest_id;
            const area = q.controlArea || q.control_area;
            return (
              <button
                key={id}
                type="button"
                onClick={() => add(id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "7px 10px", background: "none", border: "none",
                  borderBottom: "1px solid var(--border)", cursor: "pointer",
                  fontSize: 12, color: "var(--text)",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--bg4)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
              >
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{id}</span>
                {area && <span style={{ color: "var(--text3)", marginLeft: 6 }}>— {area}</span>}
              </button>
            );
          })}
        </div>
      )}
      {open && available.length === 0 && search.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
          background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5,
          padding: "10px 12px", fontSize: 12, color: "var(--text3)", marginTop: 2,
        }}>
          No matching questions found
        </div>
      )}
    </div>
  );
}
