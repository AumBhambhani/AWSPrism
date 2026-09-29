import net from "net";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// F-12 (found by the independent closure review) — the real clamscan library resolves
// isInfected: null instead of throwing when clamd's reply is empty (clamd restarted
// mid-scan) or "COMMAND READ TIMED OUT". That must never count as clean. Uses the real
// clamscan against a fake clamd on a local port.

vi.mock("../utils/email.js", () => ({ sendEmail: vi.fn(), sendInvitationEmail: vi.fn() }));

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(32)]);
let reply = "";
let server;

beforeAll(async () => {
  server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let mode = null;
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!mode) {
        const s = buf.toString("latin1");
        if (s.includes("PING")) { sock.end("PONG\n"); mode = "done"; return; }
        if (s.includes("VERSION")) { sock.end("ClamAV 1.0.0/27000/Mon Jan 1 00:00:00 2026\n"); mode = "done"; return; }
        if (s.includes("INSTREAM")) mode = "instream";
      }
      if (mode === "instream" && buf.length >= 4 && buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) {
        mode = "done";
        sock.end(reply);
      }
    });
    sock.on("error", () => {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(server.address().port);
  process.env.CLAMAV_RETRY_MS = "0";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
  delete process.env.CLAMAV_RETRY_MS;
  vi.restoreAllMocks();
  await new Promise((r) => server.close(r));
});

async function scan(clamdReply) {
  reply = clamdReply;
  vi.resetModules();
  const { scanBuffer } = await import("../utils/scanFile.js");
  return scanBuffer(PDF, "application/pdf");
}

describe("F-12 real clamscan verdict handling", () => {
  test("an OK reply is clean", async () => {
    expect(await scan("stream: OK\0")).toEqual({ safe: true });
  });

  test("a FOUND reply is infected", async () => {
    const res = await scan("stream: Eicar-Test-Signature FOUND\0");
    expect(res.safe).toBe(false);
    expect(res.unavailable).toBeUndefined();
  });

  test("an empty reply (clamd restarted mid-scan) is not clean", async () => {
    const res = await scan("");
    expect(res.safe).toBe(false);
    expect(res.unavailable).toBe(true);
  });

  test("COMMAND READ TIMED OUT is not clean", async () => {
    const res = await scan("COMMAND READ TIMED OUT\0");
    expect(res.safe).toBe(false);
    expect(res.unavailable).toBe(true);
  });
});
