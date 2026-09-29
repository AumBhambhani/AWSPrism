import { describe, test, expect } from "vitest";
import { privacyRightsTests } from "../connectors/onetrust/tests/privacyRights.js";

const byKey = Object.fromEntries(privacyRightsTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const clients = (queues = []) => ({ listDsarQueues: async () => queues });

describe("onetrust.dsar.within_statutory_deadline", () => {
  test("no requests → not_applicable", async () => {
    expect((await run("onetrust.dsar.within_statutory_deadline", clients()))[0].status).toBe("not_applicable");
  });
  test("slaExceeded=Yes or negative remaining days → fail; closed requests ignored", async () => {
    const r = await run(
      "onetrust.dsar.within_statutory_deadline",
      clients([
        { requestQueueId: "q1", status: "In progress", slaExceeded: "Yes" },
        { requestQueueId: "q2", status: "In progress", slaExceeded: "No", remainingDaysForMaxDeadline: -3 },
        { requestQueueId: "q3", status: "In progress", slaExceeded: "No", remainingDaysForMaxDeadline: 5 },
        { requestQueueId: "q4", status: "Complete", slaExceeded: "Yes" },
      ])
    );
    expect(r.map((x) => x.resourceId).sort()).toEqual(["q1", "q2"]);
  });
});

describe("onetrust.dsar.progressing", () => {
  test("early-stage older than 7 active days → fail (net of pause)", async () => {
    const r = await run(
      "onetrust.dsar.progressing",
      clients([
        { requestQueueId: "q1", status: "New", creationDate: daysAgo(20), daysPaused: 2 },
        { requestQueueId: "q2", status: "New", creationDate: daysAgo(20), daysPaused: 18 },
        { requestQueueId: "q3", status: "In progress", creationDate: daysAgo(90) },
      ])
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("q1");
  });
  test("all progressing → pass", async () => {
    const r = await run("onetrust.dsar.progressing", clients([{ requestQueueId: "q1", status: "New", creationDate: daysAgo(2) }]));
    expect(r[0].status).toBe("pass");
  });
});

describe("onetrust.dsar.no_excessive_pause", () => {
  test("paused > 30 days → fail", async () => {
    const r = await run(
      "onetrust.dsar.no_excessive_pause",
      clients([
        { requestQueueId: "q1", status: "In progress", daysPaused: 45 },
        { requestQueueId: "q2", status: "In progress", daysPaused: 5 },
      ])
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("q1");
  });
});
