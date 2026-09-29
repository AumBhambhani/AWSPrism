import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { sendEmail } from "../../utils/email.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

// F-13 — a password reset must be single-use and must end every session that existed
// before it; the reset token must never work as a login session.

const OLD_PW = "Old@Passw0rd";
const NEW_PW = "New@Passw0rd1";
const OTHER_PW = "Attacker@Pass2";

let ipSeq = 0;
const ip = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

async function account() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `f13-${suffix}.test` });
  const email = `user-${suffix}@f13.test`;
  const user = await createUser(company.id, "LEAD", { email, password: OLD_PW });
  return { company, user, email };
}

const post = (path, body, fromIp = ip()) => request(app).post(path).set("X-Forwarded-For", fromIp).send(body);
const me = (token) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

async function login(email, password) {
  const res = await post("/api/auth/login", { email, password });
  return res;
}

async function resetTokenFor(email) {
  vi.mocked(sendEmail).mockClear();
  const clientIp = ip();
  expect((await post("/api/auth/forgot-password", { email }, clientIp)).status).toBe(200);
  const otp = vi.mocked(sendEmail).mock.calls.at(-1)[0].text.match(/code is: (\d{6})/)[1];
  const verified = await post("/api/auth/verify-otp", { email, otp }, clientIp);
  expect(verified.status).toBe(200);
  return verified.body.resetToken;
}

describe("F-13 password reset", () => {
  test("a reset token can only be used once", async () => {
    const { email } = await account();
    const resetToken = await resetTokenFor(email);
    expect((await post("/api/auth/reset-password", { resetToken, newPassword: NEW_PW })).status).toBe(200);

    const replay = await post("/api/auth/reset-password", { resetToken, newPassword: OTHER_PW });
    expect(replay.status).toBe(400);
    expect((await login(email, OTHER_PW)).status).toBe(401);
    expect((await login(email, NEW_PW)).status).toBe(200);
  });

  test("sessions issued before the reset stop working", async () => {
    const { email } = await account();
    const before = await login(email, OLD_PW);
    expect(before.status).toBe(200);
    expect((await me(before.body.token)).status).toBe(200);

    const resetToken = await resetTokenFor(email);
    expect((await post("/api/auth/reset-password", { resetToken, newPassword: NEW_PW })).status).toBe(200);

    expect((await me(before.body.token)).status).toBe(401);
  });

  test("a new login after the reset works", async () => {
    const { email } = await account();
    const resetToken = await resetTokenFor(email);
    await post("/api/auth/reset-password", { resetToken, newPassword: NEW_PW });
    const after = await login(email, NEW_PW);
    expect(after.status).toBe(200);
    expect((await me(after.body.token)).status).toBe(200);
  });

  test("the reset token is not a login session", async () => {
    const { email } = await account();
    const resetToken = await resetTokenFor(email);
    expect((await me(resetToken)).status).toBe(401);
  });

  test("a login session is not a reset token", async () => {
    const { email } = await account();
    const session = await login(email, OLD_PW);
    const res = await post("/api/auth/reset-password", { resetToken: session.body.token, newPassword: NEW_PW });
    expect(res.status).toBe(400);
    expect((await login(email, OLD_PW)).status).toBe(200);
  });

  test("an older reset token dies when a newer reset completes", async () => {
    const { email } = await account();
    const first = await resetTokenFor(email);
    const second = await resetTokenFor(email);
    expect((await post("/api/auth/reset-password", { resetToken: second, newPassword: NEW_PW })).status).toBe(200);
    expect((await post("/api/auth/reset-password", { resetToken: first, newPassword: OTHER_PW })).status).toBe(400);
  });

  test("existing test-style tokens without a session version still authenticate", async () => {
    const { user } = await account();
    expect((await me(user.token)).status).toBe(200);
  });
});
