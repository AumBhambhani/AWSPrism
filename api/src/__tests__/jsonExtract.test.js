import { describe, test, expect } from "vitest";
import { extractFirstJson } from "../utils/jsonExtract.js";

describe("extractFirstJson", () => {
  test("parses a bare JSON object", () => {
    expect(extractFirstJson('{"mappings":[]}')).toEqual({ mappings: [] });
  });

  test("ignores trailing prose after the object (the Nova Pro failure mode)", () => {
    const raw = '{"mappings":[{"dept":"IT"}]}\n\nNote: I only mapped provisions that clearly apply {see rules above}.';
    expect(extractFirstJson(raw)).toEqual({ mappings: [{ dept: "IT" }] });
  });

  test("ignores leading prose before the object", () => {
    expect(extractFirstJson('Here is the mapping:\n{"mappings":[1,2]}')).toEqual({ mappings: [1, 2] });
  });

  test("unwraps a ```json fence", () => {
    expect(extractFirstJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("is not fooled by braces inside string values", () => {
    const raw = '{"rationale":"the policy says {TBD} which is a gap","ok":true}';
    expect(extractFirstJson(raw)).toEqual({ rationale: "the policy says {TBD} which is a gap", ok: true });
  });

  test("handles a top-level array", () => {
    expect(extractFirstJson('[{"x":1}] and then some words')).toEqual([{ x: 1 }]);
  });

  test("returns null when there is no JSON", () => {
    expect(extractFirstJson("I could not produce a mapping.")).toBeNull();
    expect(extractFirstJson("")).toBeNull();
    expect(extractFirstJson(null)).toBeNull();
  });

  test("returns null on an unterminated object rather than throwing", () => {
    expect(extractFirstJson('{"mappings":[{"dept":"IT"')).toBeNull();
  });
});
