import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// UNCONFIRMED (connector plan Task 0, items 3-4): the Agents OData collection
// path and its connectivity field names.
//   - path: `/odata/Agents` is a guess
//   - `IsOnline` / `Status` / `LastCheckIn` are placeholder field names
// A response shape or field the check doesn't recognise degrades to
// `status: "error"` rather than a guessed pass/fail.
const AGENTS_ENDPOINT = "/odata/Agents"; // TODO CONFIRM

// An agent that has not checked in within this window is treated as offline even
// if a boolean online flag is absent. Echoed into every evidence payload.
export const AGENT_OFFLINE_HOURS = 24;

const ONLINE_TOKENS = new Set(["online", "connected", "active", "ok", "running"]);
const OFFLINE_TOKENS = new Set(["offline", "disconnected", "inactive", "unreachable", "error"]);

function hoursSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

function unrecognisedShapeRow(response) {
  return [
    {
      resourceId: "install",
      status: "error",
      message:
        "Carbonite Server Backup Agents response did not match the expected OData " +
        "{ value: [...] } shape — this endpoint/field mapping needs to be reconfirmed against " +
        "this install's live Swagger UI before the check can be trusted (see the connector plan Task 0).",
      evidencePayload: buildEvidencePayload({
        resourceType: "carbonite_server_agent",
        resourceId: "install",
        resourceName: "Carbonite Server Backup agents",
        region: null,
        details: { rawResponseKeys: Object.keys(response || {}) },
      }),
    },
  ];
}

// Resolves an agent to "online" | "offline" | "unknown" from whatever fields are
// present, preferring an explicit flag/status, then falling back to check-in
// recency. "unknown" (nothing usable present) becomes a `status: "error"` row.
function resolveAgentState(agent) {
  if (typeof agent?.IsOnline === "boolean") return agent.IsOnline ? "online" : "offline";
  if (typeof agent?.Online === "boolean") return agent.Online ? "online" : "offline";

  const rawStatus = agent?.Status ?? agent?.ConnectionStatus ?? agent?.State;
  if (rawStatus != null) {
    const s = String(rawStatus).toLowerCase();
    if (ONLINE_TOKENS.has(s)) return "online";
    if (OFFLINE_TOKENS.has(s)) return "offline";
  }

  const lastCheckIn = agent?.LastCheckIn ?? agent?.LastContactUtc ?? agent?.LastSeen ?? null;
  const ageHours = lastCheckIn == null ? null : hoursSince(lastCheckIn);
  if (ageHours != null) return ageHours > AGENT_OFFLINE_HOURS ? "offline" : "online";

  return "unknown";
}

export async function checkAgentsOnline(carboniteServer) {
  const response = await carboniteServer.request(AGENTS_ENDPOINT);
  const agents = response?.value;

  if (!Array.isArray(agents)) return unrecognisedShapeRow(response);

  if (agents.length === 0) {
    return [
      {
        resourceId: "install",
        status: "not_applicable",
        message: "No backup agents are registered on this Carbonite Server Backup install",
        evidencePayload: buildEvidencePayload({
          resourceType: "carbonite_server_agent",
          resourceId: "install",
          resourceName: "Carbonite Server Backup agents",
          region: null,
          details: { agents: 0, offlineAfterHours: AGENT_OFFLINE_HOURS },
        }),
      },
    ];
  }

  return agents.map((agent) => {
    const resourceId = String(agent?.Id ?? agent?.AgentId ?? agent?.Name ?? agent?.MachineName ?? "unknown");
    const resourceName = String(agent?.Name ?? agent?.MachineName ?? agent?.ComputerName ?? resourceId);
    const lastCheckIn = agent?.LastCheckIn ?? agent?.LastContactUtc ?? agent?.LastSeen ?? null;
    const state = resolveAgentState(agent);

    const payload = (details) =>
      buildEvidencePayload({
        resourceType: "carbonite_server_agent",
        resourceId,
        resourceName,
        region: null,
        details: { agentState: state, lastCheckIn, offlineAfterHours: AGENT_OFFLINE_HOURS, ...details },
      });

    if (state === "unknown") {
      return {
        resourceId,
        status: "error",
        message:
          `Could not determine whether agent "${resourceName}" is online — no known online flag, status, ` +
          `or last-check-in field was present on this install's Agents response. The field mapping needs ` +
          `live confirmation against the Swagger UI before this check can be trusted.`,
        evidencePayload: payload({ agentKeys: Object.keys(agent || {}) }),
      };
    }

    if (state === "offline") {
      return {
        resourceId,
        status: "fail",
        message: `Agent "${resourceName}" is offline / not checking in`,
        evidencePayload: payload({}),
      };
    }

    return {
      resourceId,
      status: "pass",
      message: `Agent "${resourceName}" is online and checking in`,
      evidencePayload: payload({}),
    };
  });
}

export const monitoringTests = [
  {
    key: "carbonite-server.monitoring.agent_online",
    title: "Backup agents are online and checking in",
    failTitle: "A backup agent is offline / not checking in",
    severityDefault: "high",
    isoReferences: ["A.12.3.1", "A.12.4.1"],
    dpdpaControlAreas: ["Backup & Recovery", "Logging & Monitoring"],
    run: (clients) => checkAgentsOnline(clients.carboniteServer),
  },
];
