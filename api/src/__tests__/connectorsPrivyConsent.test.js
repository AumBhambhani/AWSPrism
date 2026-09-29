import { describe, test, expect } from "vitest";
import { consentTests } from "../connectors/privy/tests/consent.js";

const byKey = Object.fromEntries(consentTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function clients({ points = [], artifacts = [] } = {}) {
  return {
    listConsentCollectionPoints: async () => points,
    listConsentArtifacts: async () => artifacts,
  };
}

describe("privy.consent.collection_points_registered", () => {
  test("no active points → fail", async () => {
    const r = await run("privy.consent.collection_points_registered", clients());
    expect(r[0].status).toBe("fail");
  });
  test("an active point → pass", async () => {
    const r = await run("privy.consent.collection_points_registered", clients({ points: [{ id: "p1", status: "active" }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.consent.artifacts_being_captured", () => {
  test("a recent artefact → pass", async () => {
    const r = await run("privy.consent.artifacts_being_captured", clients({ artifacts: [{ createdAt: daysAgo(3) }] }));
    expect(r[0].status).toBe("pass");
  });
  test("only stale artefacts → fail", async () => {
    const r = await run("privy.consent.artifacts_being_captured", clients({ artifacts: [{ createdAt: daysAgo(90) }] }));
    expect(r[0].status).toBe("fail");
  });
});

describe("privy.consent.notice_versioned", () => {
  test("active point with no notice version → fail", async () => {
    const r = await run("privy.consent.notice_versioned", clients({ points: [{ id: "p1", status: "active" }] }));
    expect(r[0].status).toBe("fail");
  });
  test("versioned + freshly reviewed → pass", async () => {
    const r = await run("privy.consent.notice_versioned", clients({ points: [{ id: "p1", status: "active", noticeVersion: "3", noticeUpdatedAt: daysAgo(30) }] }));
    expect(r[0].status).toBe("pass");
  });
  test("no active points → not_applicable", async () => {
    const r = await run("privy.consent.notice_versioned", clients({ points: [{ id: "p1", status: "archived" }] }));
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("privy.consent.withdrawal_supported", () => {
  test("withdrawal disabled → fail", async () => {
    const r = await run("privy.consent.withdrawal_supported", clients({ points: [{ id: "p1", status: "active", withdrawalEnabled: false }] }));
    expect(r[0].status).toBe("fail");
  });
  test("withdrawal enabled → pass", async () => {
    const r = await run("privy.consent.withdrawal_supported", clients({ points: [{ id: "p1", status: "active", withdrawalEnabled: true }] }));
    expect(r[0].status).toBe("pass");
  });
});
