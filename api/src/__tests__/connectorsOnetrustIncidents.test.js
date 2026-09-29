import { describe, test, expect } from "vitest";
import { incidentsTests } from "../connectors/onetrust/tests/incidents.js";

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

describe("onetrust.incidents.no_stale_open", () => {
  test("no incidents → not_applicable", async () => {
    expect((await run("onetrust.incidents.no_stale_open", clients()))[0].status).toBe("not_applicable");
  });
  test("open incident with no update in 30+ days → fail", async () => {
    const r = await run(
      "onetrust.incidents.no_stale_open",
      clients({
        incidents: [
          { incidentId: "i1", number: "INC-1", status: "OPEN", lastUpdatedDate: daysAgo(60) },
          { incidentId: "i2", status: "OPEN", lastUpdatedDate: daysAgo(3) },
          { incidentId: "i3", status: "CLOSED", lastUpdatedDate: daysAgo(400) },
        ],
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("i1");
  });
});

describe("onetrust.incidents.breach_decision_recorded", () => {
  test("no open incident older than 72h → not_applicable", async () => {
    const r = await run("onetrust.incidents.breach_decision_recorded", clients({ incidents: [{ incidentId: "i1", status: "OPEN", createdDate: hoursAgo(10) }] }));
    expect(r[0].status).toBe("not_applicable");
  });
  test("old open incident with no decision field → not_applicable", async () => {
    const r = await run(
      "onetrust.incidents.breach_decision_recorded",
      clients({ incidents: [{ incidentId: "i1", status: "OPEN", createdDate: daysAgo(5) }], details: { i1: { foo: "bar" } } })
    );
    expect(r[0].status).toBe("not_applicable");
  });
  test("old open incident with an unset decision field → fail", async () => {
    const r = await run(
      "onetrust.incidents.breach_decision_recorded",
      clients({ incidents: [{ incidentId: "i1", status: "OPEN", createdDate: daysAgo(5) }], details: { i1: { breachNotificationDecision: "PENDING" } } })
    );
    expect(r[0].status).toBe("fail");
  });
  test("old open incident with a recorded decision → pass", async () => {
    const r = await run(
      "onetrust.incidents.breach_decision_recorded",
      clients({ incidents: [{ incidentId: "i1", status: "OPEN", createdDate: daysAgo(5) }], details: { i1: { breachNotificationDecision: "NOTIFY_REGULATOR" } } })
    );
    expect(r[0].status).toBe("pass");
  });
});

describe("onetrust.incidents.register_operating", () => {
  test("an incident in the last 12 months → pass", async () => {
    const r = await run("onetrust.incidents.register_operating", clients({ incidents: [{ incidentId: "i1", createdDate: daysAgo(30) }] }));
    expect(r[0].status).toBe("pass");
  });
  test("nothing recent → fail", async () => {
    const r = await run("onetrust.incidents.register_operating", clients({ incidents: [{ incidentId: "i1", createdDate: daysAgo(500) }] }));
    expect(r[0].status).toBe("fail");
  });
});
