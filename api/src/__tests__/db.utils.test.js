import { describe, it, expect } from "vitest";
import { toCamel, mapRow, mapRows, buildUpdate } from "../db/index.js";

describe("toCamel", () => {
  it("converts snake_case keys to camelCase", () => {
    expect(toCamel({ company_id: 1, is_verified: true })).toEqual({ companyId: 1, isVerified: true });
  });

  it("leaves single-word keys unchanged", () => {
    expect(toCamel({ id: 1, name: "Alice" })).toEqual({ id: 1, name: "Alice" });
  });

  it("handles multiple underscores", () => {
    expect(toCamel({ created_at_utc: "2024" })).toEqual({ createdAtUtc: "2024" });
  });

  it("preserves values of all types", () => {
    expect(toCamel({ flag: true, count: 0, data: null })).toEqual({ flag: true, count: 0, data: null });
  });

  it("returns null for null input", () => {
    expect(toCamel(null)).toBeNull();
  });
});

describe("mapRow", () => {
  it("returns null when result has no rows", () => {
    expect(mapRow({ rows: [] })).toBeNull();
  });

  it("returns the first row as camelCase", () => {
    expect(mapRow({ rows: [{ user_id: 5, full_name: "Bob" }] })).toEqual({ userId: 5, fullName: "Bob" });
  });

  it("ignores extra rows", () => {
    const result = mapRow({ rows: [{ id: 1 }, { id: 2 }] });
    expect(result).toEqual({ id: 1 });
  });
});

describe("mapRows", () => {
  it("returns an empty array when result has no rows", () => {
    expect(mapRows({ rows: [] })).toEqual([]);
  });

  it("maps all rows to camelCase", () => {
    const result = mapRows({ rows: [{ user_id: 1 }, { user_id: 2 }] });
    expect(result).toEqual([{ userId: 1 }, { userId: 2 }]);
  });
});

describe("buildUpdate", () => {
  it("returns null for an empty object", () => {
    expect(buildUpdate({})).toBeNull();
  });

  it("builds a SET clause for one field", () => {
    const result = buildUpdate({ name: "Alice" });
    expect(result.set).toBe("name = $1");
    expect(result.values).toEqual(["Alice"]);
    expect(result.keys).toEqual(["name"]);
  });

  it("builds a SET clause for multiple fields", () => {
    const result = buildUpdate({ name: "Alice", email: "a@b.com" });
    expect(result.set).toBe("name = $1, email = $2");
    expect(result.values).toEqual(["Alice", "a@b.com"]);
  });

  it("respects a custom startIndex", () => {
    const result = buildUpdate({ name: "Alice" }, 3);
    expect(result.set).toBe("name = $3");
  });

  it("skips fields whose value is undefined", () => {
    const result = buildUpdate({ name: "Alice", bio: undefined });
    expect(result.set).toBe("name = $1");
    expect(result.values).toEqual(["Alice"]);
  });
});
