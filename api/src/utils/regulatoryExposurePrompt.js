// Shared prompt for aiProvider.mapRegulatoryExposure — used by both the
// Bedrock and Azure provider implementations so the wording can't drift.
//
// The self-assessment tool is fundamentally an India DPDP Act 2023 readiness
// check (its question bank is DPDPA-tagged), so the prompt makes DPDPA the
// primary lens: any personal-data gap must map to a DPDPA provision, with
// GDPR / ISO 27001 added on top where they also apply.

export function buildExposurePrompt({ departments = [], provisionIndex = {} }) {
  const deptBlock = departments.map(d => {
    const lines = [
      ...(d.gapQuestions || []).map(q => `  - [GAP id=${q.id}] ${q.text}`),
      ...(d.partialQuestions || []).map(q => `  - [PARTIAL id=${q.id}] ${q.text}`),
    ];
    return `${d.dept}:\n${lines.length ? lines.join("\n") : "  (no open items)"}`;
  }).join("\n\n");

  const indexBlock = Object.entries(provisionIndex)
    .map(([fw, provisions]) => `${fw}:\n${provisions.map(p => `  - id="${p.id}" — ${p.title}`).join("\n")}`)
    .join("\n\n");

  return `You map a company's open self-assessment items (unresolved "gaps" and "partial" controls, one department at a time) to the specific regulatory/standard provisions they put at risk.

CONTEXT: This is an India Digital Personal Data Protection Act, 2023 (DPDPA) readiness self-assessment. DPDPA is the PRIMARY framework. For every open item that touches personal data in any way — collection, notice, consent, purpose limitation, retention or erasure, security safeguards, breach detection or notification, children's data, data-principal rights (access / correction / erasure / grievance), processor/vendor agreements, or cross-border transfer — you MUST map it to the most relevant DPDPA provision from the index, and then ALSO map it to any GDPR or ISO/IEC 27001 provision that independently applies. Do not return a GDPR or ISO mapping for a personal-data item without also giving its DPDPA provision.

DPDPA PROVISION SELECTION — pick the MOST SPECIFIC provision for what the open item is actually about. Route by topic:
- privacy notice / fair-processing information / itemised disclosure / language of notice → 5 (or 5(1)(i), 5(3))
- obtaining consent / opt-in / informed or specific consent / consent records / marketing consent → 6 (or 6(1))
- consent withdrawal / opt-out / unsubscribe being as easy as opt-in → 6(4)-(6)
- relying on a legitimate use instead of consent → 7
- data accuracy, or a Data Processor / vendor / sub-processor contract or oversight gap, with no more specific fit → 8
- security safeguards: MFA, encryption, access control, RBAC, access reviews, joiner-mover-leaver, endpoint/EDR, logging & monitoring, WAF, vulnerability scanning, backups, secure SDLC, secure coding → 8(5)
- breach detection / incident response / knowing what data & individuals were affected / notifying the Board or Data Principals → 8(6)
- retention periods, deletion/erasure once purpose served, ability to delete an individual's data → 8(7)
- publishing DPO / grievance contact information for processing questions → 8(9)
- children's data / age verification / verifiable parental consent / no tracking or ad-targeting of minors → 9
- appointing a DPO, independent data auditor, or running a DPIA (as a Significant Data Fiduciary duty) → 10
- Data Principal's right to a summary of data processed / list of processing activities → 11
- Data Principal's right to correction / completion / updating / erasure on request → 12
- grievance-redressal mechanism / responding to Data Principal complaints → 13
- right to nominate → 14
- transferring personal data outside India / restricted countries → 16-17
Use 8 (bare) ONLY for a data-accuracy or processor-contract gap that genuinely fits nothing more specific. NEVER use 8 as a catch-all for a security, consent, notice, breach, retention, children, rights, or transfer item — each of those has its own provision above and you must use it. Two different open items in the same department will usually map to two different DPDPA provisions.

WORKED EXAMPLES (illustrative — cite only what the real open items below support):
- "Is MFA enabled for employees?" [GAP] → DPDPA 8(5), GDPR 32, ISO A.8.5
- "Is explicit, informed consent obtained before sending marketing communications?" [GAP] → DPDPA 6, GDPR 7
- "Do you have documented retention periods for personal data?" [GAP] → DPDPA 8(7), GDPR 5
- "Do you have a documented personal-data breach/incident response process?" [GAP] → DPDPA 8(6), GDPR 33
- "Do you have data processing agreements with all third-party processors?" [GAP] → DPDPA 8, GDPR 28

OPEN ITEMS BY DEPARTMENT:
${deptBlock}

PROVISION INDEX — the ONLY provisions you may cite. You MUST NOT invent an id that isn't listed here, and provisionId must be copied EXACTLY as given (including punctuation):
${indexBlock}

Rules:
- For EACH open item, cite the SINGLE most directly relevant DPDPA provision (per the routing guide above), plus at most ONE GDPR article and at most ONE ISO/IEC 27001 control — only where each genuinely adds something a compliance auditor would cite for that specific gap. Do not map an item to every provision that is loosely related.
- Group your output by (department, provision): if three of a department's open items all point to DPDPA 8(5), emit ONE mapping for that pair with all three ids in relatedQuestionIds. But if a department's items span several topics, emit several DPDPA mappings for that department — one per distinct provision.
- Only cite a provision for a department if a real open item of that department's actually relates to it. Do not cite a provision just because the department exists.
- Cite the specific open-item id(s) responsible in relatedQuestionIds — never leave it empty.
- A provision may apply to several departments; list each department separately.
- rationale: one sentence naming the specific open items and why they put this provision at risk.

Respond with ONLY valid JSON, no markdown fences:
{"mappings":[{"dept":"...","framework":"DPDPA|GDPR|ISO27001","provisionId":"...","rationale":"...","relatedQuestionIds":["..."]}]}`;
}

// Normalises a raw model response into the mapping list the router validates.
// Accepts {"mappings":[...]} (the asked-for shape) or a bare [...] array (a
// common way models loosen the schema).
export function normaliseMappings(parsed) {
  const list = Array.isArray(parsed) ? parsed
    : parsed && Array.isArray(parsed.mappings) ? parsed.mappings
    : null;
  if (!list) return null;
  return list.map(m => ({
    dept: String(m.dept ?? ""),
    framework: String(m.framework ?? ""),
    provisionId: String(m.provisionId ?? ""),
    rationale: String(m.rationale ?? ""),
    relatedQuestionIds: Array.isArray(m.relatedQuestionIds) ? m.relatedQuestionIds.map(String) : [],
  }));
}
