import { describe, it, expect, vi } from "vitest";
import { requireRole, requireReadOnly, requireSuperAdmin } from "../middleware/roles.js";

function mockReq(role) {
  return { user: { role } };
}

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("requireRole", () => {
  it("calls next() when role is in the allowed list", () => {
    const next = vi.fn();
    requireRole(["ADMIN", "LEAD"])(mockReq("ADMIN"), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when role is not allowed", () => {
    const res = mockRes();
    requireRole(["ADMIN"])(mockReq("REVIEWER"), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  it("returns 403 when req.user is missing", () => {
    const res = mockRes();
    requireRole(["ADMIN"])({ user: null }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("does not call next() on 403", () => {
    const next = vi.fn();
    requireRole(["ADMIN"])(mockReq("REVIEWER"), mockRes(), next);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows any role in the list", () => {
    const roles = ["ADMIN", "LEAD", "CONTRIBUTOR"];
    for (const role of roles) {
      const next = vi.fn();
      requireRole(roles)(mockReq(role), mockRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });
});

describe("requireReadOnly", () => {
  it("calls next() for a role in the allowed list", () => {
    const next = vi.fn();
    requireReadOnly(["ADMIN"])(mockReq("ADMIN"), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("automatically permits AUDITOR even when not in the list", () => {
    const next = vi.fn();
    requireReadOnly(["ADMIN"])(mockReq("AUDITOR"), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 for REVIEWER when not in the allowed list", () => {
    const res = mockRes();
    requireReadOnly(["ADMIN"])(mockReq("REVIEWER"), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("requireSuperAdmin", () => {
  it("calls next() for SUPERADMIN", () => {
    const next = vi.fn();
    requireSuperAdmin(mockReq("SUPERADMIN"), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 for ADMIN", () => {
    const res = mockRes();
    requireSuperAdmin(mockReq("ADMIN"), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when req.user is missing", () => {
    const res = mockRes();
    requireSuperAdmin({ user: null }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
