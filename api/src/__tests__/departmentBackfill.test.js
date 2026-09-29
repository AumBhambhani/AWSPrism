import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  tokeniseOwner,
  canonicalDepartment,
  matchOwnerToDepartments,
  CANONICAL_DEPARTMENTS,
} from "../utils/departmentBackfill.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REAL_OWNER_STRINGS = JSON.parse(
  readFileSync(path.join(__dir, "fixtures/defaultOwnerStrings.json"), "utf8")
);

const depts = (...names) => names.map((name, i) => ({ id: i + 1, name }));

describe("tokeniseOwner", () => {
  test("splits on slash, comma, ampersand and 'and'", () => {
    expect(tokeniseOwner("IT / Security")).toEqual(["IT", "Security"]);
    expect(tokeniseOwner("Legal, Privacy & HR")).toEqual(["Legal", "Privacy", "HR"]);
    expect(tokeniseOwner("Risk and Compliance")).toEqual(["Risk", "Compliance"]);
  });

  test("empty / null owner yields no tokens", () => {
    expect(tokeniseOwner(null)).toEqual([]);
    expect(tokeniseOwner("  ")).toEqual([]);
  });
});

describe("canonicalDepartment", () => {
  test("role titles map onto their department", () => {
    expect(canonicalDepartment("CISO")).toBe("Security");
    expect(canonicalDepartment("DPO")).toBe("Privacy");
    expect(canonicalDepartment("Business Owners")).toBe("Business");
  });

  test("canonical names map to themselves, case-insensitively", () => {
    expect(canonicalDepartment("it")).toBe("IT");
    expect(canonicalDepartment("Legal")).toBe("Legal");
  });

  test("unknown token has no canonical department", () => {
    expect(canonicalDepartment("Astrology")).toBeNull();
  });

  test("every token in every real default_owner string is recognised", () => {
    const unknown = new Set();
    for (const owner of REAL_OWNER_STRINGS) {
      for (const token of tokeniseOwner(owner)) {
        if (canonicalDepartment(token) === null && token.toLowerCase() !== "external assessor") {
          unknown.add(token);
        }
      }
    }
    expect([...unknown]).toEqual([]);
  });

  test("alias targets are all canonical department names", () => {
    for (const owner of REAL_OWNER_STRINGS) {
      for (const token of tokeniseOwner(owner)) {
        const c = canonicalDepartment(token);
        if (c) expect(CANONICAL_DEPARTMENTS).toContain(c);
      }
    }
  });
});

describe("matchOwnerToDepartments", () => {
  test("order-swapped owners resolve to the same departments", () => {
    const d = depts("IT", "Security");
    expect(matchOwnerToDepartments("IT / Security", d).ids.sort())
      .toEqual(matchOwnerToDepartments("Security / IT", d).ids.sort());
  });

  test("aliases resolve onto existing departments and are deduped", () => {
    const d = depts("Security", "Privacy");
    expect(matchOwnerToDepartments("CISO / Security / DPO", d)).toEqual({ ids: [1, 2], unmatched: [] });
  });

  test("a department literally named after the token wins over the alias", () => {
    const d = depts("Privacy", "DPO");
    expect(matchOwnerToDepartments("DPO", d)).toEqual({ ids: [2], unmatched: [] });
  });

  test("tokens with no matching company department are reported, never invented", () => {
    const d = depts("IT");
    expect(matchOwnerToDepartments("IT / Legal", d)).toEqual({ ids: [1], unmatched: ["Legal"] });
  });

  test("matching is case-insensitive against company department names", () => {
    const d = depts("information technology", "it");
    expect(matchOwnerToDepartments("IT", d).ids).toEqual([2]);
  });
});
