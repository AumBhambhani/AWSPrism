import { describe, test, expect } from "vitest";
import { fingerprintSubmissions, withRequiredDepartments, REQUIRED_DEPARTMENTS } from "../routes/selfAssessment.js";

// fingerprintSubmissions is a pure function — it never calls query(), so this
// stays a true unit test per CLAUDE.md's "unit tests never touch a real DB"
// rule even though it's exported from a route file.

function sub(department, userEmail, answers) {
  return { department, userEmail, answers };
}

describe("fingerprintSubmissions — cache key for the AI regulatory-exposure mapping", () => {
  test("is stable across submission array order and object key order", () => {
    const a = [sub("IT", "it@co.com", { b: "NO", a: "YES" }), sub("HR", "hr@co.com", { c: "PARTIAL" })];
    const b = [sub("HR", "hr@co.com", { c: "PARTIAL" }), sub("IT", "it@co.com", { a: "YES", b: "NO" })];
    expect(fingerprintSubmissions(a)).toBe(fingerprintSubmissions(b));
  });

  test("changes when an answer value changes", () => {
    const before = [sub("IT", "it@co.com", { "it-15": "NO" })];
    const after = [sub("IT", "it@co.com", { "it-15": "YES" })];
    expect(fingerprintSubmissions(before)).not.toBe(fingerprintSubmissions(after));
  });

  test("changes when a new submitter is added", () => {
    const before = [sub("IT", "it@co.com", { "it-15": "NO" })];
    const after = [...before, sub("IT", "it2@co.com", { "it-15": "NO" })];
    expect(fingerprintSubmissions(before)).not.toBe(fingerprintSubmissions(after));
  });

  test("is unaffected by submittedAt (only department/user/answers matter)", () => {
    const a = [{ department: "IT", userEmail: "it@co.com", answers: { "it-15": "NO" }, submittedAt: "2026-01-01" }];
    const b = [{ department: "IT", userEmail: "it@co.com", answers: { "it-15": "NO" }, submittedAt: "2026-09-01" }];
    expect(fingerprintSubmissions(a)).toBe(fingerprintSubmissions(b));
  });
});

describe("withRequiredDepartments — IT and HR are mandatory", () => {
  test("adds IT and HR when they were not selected", () => {
    expect(withRequiredDepartments(["Legal", "Marketing"])).toEqual(["IT", "HR", "Legal", "Marketing"]);
    expect(withRequiredDepartments([])).toEqual(["IT", "HR"]);
    expect(withRequiredDepartments(undefined)).toEqual(["IT", "HR"]);
  });

  test("never duplicates them, whatever the casing or spacing", () => {
    expect(withRequiredDepartments(["hr", " IT ", "Legal"])).toEqual(["hr", "IT", "Legal"]);
    expect(withRequiredDepartments(["IT", "HR", "IT"])).toEqual(["IT", "HR"]);
  });

  test("keeps custom departments and the required list is exactly IT and HR", () => {
    expect(REQUIRED_DEPARTMENTS).toEqual(["IT", "HR"]);
    expect(withRequiredDepartments(["Sales"])).toContain("Sales");
  });
});
