// Pull the first complete JSON object/array out of an LLM response that may
// wrap it in ```json fences, prose, or trailing commentary. The bare
// /\{[\s\S]*\}/ pattern used elsewhere is greedy to the LAST brace in the
// whole string, which breaks when the model adds an explanatory sentence
// with its own braces after the JSON ("Unexpected non-whitespace character
// after JSON"). This scans brace/bracket depth, ignoring anything inside a
// string literal, and stops at the matching close.
export function extractFirstJson(raw) {
  const text = String(raw ?? "");

  // Prefer an explicit ```json … ``` (or plain ``` … ```) fence when present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = fenced ? [fenced[1], text] : [text];

  for (const chunk of candidates) {
    const start = chunk.search(/[{[]/);
    if (start === -1) continue;
    const open = chunk[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(chunk.slice(start, i + 1)); }
          catch { break; } // malformed — try the next candidate
        }
      }
    }
  }
  return null;
}
