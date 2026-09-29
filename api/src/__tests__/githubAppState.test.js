import { describe, test, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signGithubAppState, verifyGithubAppState } from "../utils/githubAppState.js";

describe("githubAppState", () => {
  test("round-trips connectionId/companyId through sign then verify", () => {
    const token = signGithubAppState({ connectionId: 42, companyId: 7 });
    const decoded = verifyGithubAppState(token);
    expect(decoded).toEqual({ connectionId: 42, companyId: 7 });
  });

  test("throws for a token signed with the wrong purpose suffix", () => {
    const wrongToken = jwt.sign({ connectionId: 42, companyId: 7 }, process.env.JWT_SECRET + ":something-else", { expiresIn: "15m" });
    expect(() => verifyGithubAppState(wrongToken)).toThrow("Invalid or expired state token");
  });

  test("throws for an expired token", () => {
    const expiredToken = jwt.sign({ connectionId: 42, companyId: 7 }, process.env.JWT_SECRET + ":github-app-state", { expiresIn: -10 });
    expect(() => verifyGithubAppState(expiredToken)).toThrow("Invalid or expired state token");
  });

  test("throws for garbage input", () => {
    expect(() => verifyGithubAppState("not-a-real-token")).toThrow("Invalid or expired state token");
  });
});
