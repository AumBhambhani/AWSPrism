import { describe, it, expect } from "vitest";
import { sanitiseText, sanitiseUrl, sanitiseFields } from "../utils/sanitise.js";

describe("sanitiseText", () => {
  it("returns null for null", () => expect(sanitiseText(null)).toBeNull());
  it("returns null for undefined", () => expect(sanitiseText(undefined)).toBeNull());
  it("returns null for empty string", () => expect(sanitiseText("")).toBeNull());
  it("returns null for whitespace-only string", () => expect(sanitiseText("   ")).toBeNull());

  it("trims surrounding whitespace", () => expect(sanitiseText("  hello  ")).toBe("hello"));
  it("passes through clean text", () => expect(sanitiseText("Hello, World!")).toBe("Hello, World!"));

  it("strips HTML tags", () => expect(sanitiseText("<b>bold</b>")).toBe("bold"));
  it("strips nested HTML tags", () => expect(sanitiseText("<div><p>text</p></div>")).toBe("text"));
  it("strips script tags", () => expect(sanitiseText("<script>alert(1)</script>")).toBe("alert(1)"));

  it("strips javascript: patterns", () => expect(sanitiseText("javascript:alert(1)")).toBe("alert(1)"));
  it("strips javascript: with spaces (bypass attempt)", () =>
    expect(sanitiseText("javascript :alert(1)")).toBe("alert(1)"));

  it("strips null bytes", () => expect(sanitiseText("hel\x00lo")).toBe("hello"));
  it("strips multiple null bytes", () => expect(sanitiseText("\x00\x00test\x00")).toBe("test"));

  it("truncates to default maxLength of 2000", () => {
    const long = "a".repeat(2100);
    expect(sanitiseText(long)).toHaveLength(2000);
  });
  it("truncates to custom maxLength", () => {
    expect(sanitiseText("hello", 3)).toBe("hel");
  });

  it("coerces numbers to string", () => expect(sanitiseText(42)).toBe("42"));
});

describe("sanitiseUrl", () => {
  it("returns null for null", () => expect(sanitiseUrl(null)).toBeNull());
  it("returns null for undefined", () => expect(sanitiseUrl(undefined)).toBeNull());
  it("returns null for empty string", () => expect(sanitiseUrl("")).toBeNull());

  it("accepts https URLs", () => expect(sanitiseUrl("https://example.com")).toBe("https://example.com"));
  it("accepts http URLs", () => expect(sanitiseUrl("http://example.com")).toBe("http://example.com"));
  it("accepts URLs with paths and query strings", () =>
    expect(sanitiseUrl("https://example.com/path?q=1&r=2")).toBe("https://example.com/path?q=1&r=2"));

  it("rejects javascript: protocol", () => expect(sanitiseUrl("javascript:alert(1)")).toBeNull());
  it("rejects ftp: protocol", () => expect(sanitiseUrl("ftp://files.example.com")).toBeNull());
  it("rejects data: URIs", () => expect(sanitiseUrl("data:text/html,<h1>XSS</h1>")).toBeNull());
  it("rejects relative paths", () => expect(sanitiseUrl("/relative/path")).toBeNull());
  it("rejects plain text", () => expect(sanitiseUrl("not-a-url")).toBeNull());

  it("truncates URLs longer than 2048 chars", () => {
    const long = "https://example.com/" + "a".repeat(2100);
    expect(sanitiseUrl(long)).toHaveLength(2048);
  });
});

describe("sanitiseFields", () => {
  it("sanitises text fields", () => {
    const result = sanitiseFields({ name: "<b>Alice</b>" }, { name: "text" });
    expect(result.name).toBe("Alice");
  });

  it("sanitises url fields", () => {
    const result = sanitiseFields({ site: "javascript:x" }, { site: "url" });
    expect(result.site).toBeNull();
  });

  it("leaves unlisted fields untouched", () => {
    const result = sanitiseFields({ name: "<b>x</b>", role: "ADMIN" }, { name: "text" });
    expect(result.role).toBe("ADMIN");
  });

  it("skips fields not present in body", () => {
    const result = sanitiseFields({ name: "Alice" }, { name: "text", missing: "text" });
    expect(result).not.toHaveProperty("missing");
  });
});
