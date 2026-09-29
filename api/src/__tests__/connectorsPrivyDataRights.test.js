import { describe, test, expect } from "vitest";
import { dataRightsTests } from "../connectors/privy/tests/dataRights.js";

const byKey = Object.fromEntries(dataRightsTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function clients({ requests = [] } = {}) {
  return { listRightsRequests: async () => requests };
}

describe("privy.rights.within_statutory_deadline", () => {
  test("no requests → not_applicable", async () => {
    const r = await run("privy.rights.within_statutory_deadline", clients());
    expect(r[0].status).toBe("not_applicable");
  });
  test("SLA-breached open request → fail", async () => {
    const r = await run("privy.rights.within_statutory_deadline", clients({ requests: [{ id: "q1", status: "in_progress", slaBreached: true }] }));
    expect(r[0]).toMatchObject({ resourceId: "q1", status: "fail" });
  });
  test("open request past due date → fail", async () => {
    const r = await run("privy.rights.within_statutory_deadline", clients({ requests: [{ id: "q2", status: "in_progress", dueDate: daysAgo(2) }] }));
    expect(r[0].status).toBe("fail");
  });
  test("healthy open request → pass", async () => {
    const r = await run("privy.rights.within_statutory_deadline", clients({ requests: [{ id: "q3", status: "in_progress", daysToDeadline: 10 }] }));
    expect(r[0].status).toBe("pass");
  });
  test("closed request is ignored", async () => {
    const r = await run("privy.rights.within_statutory_deadline", clients({ requests: [{ id: "q4", status: "completed", slaBreached: true }] }));
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("privy.rights.progressing", () => {
  test("early-stage request untouched > 7 days → fail", async () => {
    const r = await run("privy.rights.progressing", clients({ requests: [{ id: "q1", status: "verifying identity", createdAt: daysAgo(20) }] }));
    expect(r[0].status).toBe("fail");
  });
  test("paused time is netted out", async () => {
    const r = await run("privy.rights.progressing", clients({ requests: [{ id: "q2", status: "new", createdAt: daysAgo(20), daysPaused: 18 }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.rights.register_operating", () => {
  test("a request in the last year → pass", async () => {
    const r = await run("privy.rights.register_operating", clients({ requests: [{ id: "q1", createdAt: daysAgo(30) }] }));
    expect(r[0].status).toBe("pass");
  });
  test("nothing recent → fail", async () => {
    const r = await run("privy.rights.register_operating", clients({ requests: [{ id: "q1", createdAt: daysAgo(400) }] }));
    expect(r[0].status).toBe("fail");
  });
});
