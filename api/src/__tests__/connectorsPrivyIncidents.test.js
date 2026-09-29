import { describe, test, expect } from "vitest";
import { incidentsTests } from "../connectors/privy/tests/incidents.js";

const byKey = Object.fromEntries(incidentsTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

function clients({ incidents = [], details = {} } = {}) {
  return {
    listIncidents: async () => incidents,
    getIncident: async (id) => {
      if (details[id] instanceof Error) throw details[id];
      return details[id] || {};
    },
  };
}

describe("privy.incidents.no_stale_open", () => {
  test("no incidents → not_applicable", async () => {
    const r = await run("privy.incidents.no_stale_open", clients());
    expect(r[0].status).toBe("not_applicable");
  });
  test("stale open incident → fail", async () => {
    const r = await run("privy.incidents.no_stale_open", clients({ incidents: [{ id: "i1", status: "open", updatedAt: daysAgo(45) }] }));
    expect(r[0].status).toBe("fail");
  });
  test("recently updated open incident → pass", async () => {
    const r = await run("privy.incidents.no_stale_open", clients({ incidents: [{ id: "i1", status: "open", updatedAt: daysAgo(3) }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.incidents.breach_decision_recorded", () => {
  test("no old open incidents → not_applicable", async () => {
    const r = await run("privy.incidents.breach_decision_recorded", clients({ incidents: [{ id: "i1", status: "open", createdAt: hoursAgo(2) }] }));
    expect(r[0].status).toBe("not_applicable");
  });
  test(">72h open incident with no decision field → not_applicable", async () => {
    const r = await run("privy.incidents.breach_decision_recorded", clients({
      incidents: [{ id: "i1", status: "open", createdAt: hoursAgo(100) }],
      details: { i1: {} },
    }));
    expect(r[0].status).toBe("not_applicable");
  });
  test(">72h open incident with an unset decision → fail", async () => {
    const r = await run("privy.incidents.breach_decision_recorded", clients({
      incidents: [{ id: "i1", status: "open", createdAt: hoursAgo(100) }],
      details: { i1: { breachNotificationDecision: "PENDING" } },
    }));
    expect(r[0].status).toBe("fail");
  });
  test(">72h open incident with a recorded decision → pass", async () => {
    const r = await run("privy.incidents.breach_decision_recorded", clients({
      incidents: [{ id: "i1", status: "open", createdAt: hoursAgo(100) }],
      details: { i1: { breachNotificationDecision: "NOTIFY_BOARD" } },
    }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.incidents.register_operating", () => {
  test("an incident this year → pass", async () => {
    const r = await run("privy.incidents.register_operating", clients({ incidents: [{ id: "i1", createdAt: daysAgo(30) }] }));
    expect(r[0].status).toBe("pass");
  });
  test("nothing recent → fail", async () => {
    const r = await run("privy.incidents.register_operating", clients({ incidents: [] }));
    expect(r[0].status).toBe("fail");
  });
});
