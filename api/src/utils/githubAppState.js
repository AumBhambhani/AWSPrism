import jwt from "jsonwebtoken";

// Same "suffix the shared JWT secret with a purpose string" trick vault.js's
// requireVaultPin already uses (JWT_SECRET + ":vault") — lets this token type
// be verified independently of a real user session without provisioning a
// second secret. 15 minutes comfortably covers "click through two GitHub
// screens" without leaving a long-lived bearer token floating in browser URLs.
function stateSecret() {
  return process.env.JWT_SECRET + ":github-app-state";
}

export function signGithubAppState({ connectionId, companyId }) {
  return jwt.sign({ connectionId, companyId }, stateSecret(), { expiresIn: "15m" });
}

export function verifyGithubAppState(token) {
  try {
    const decoded = jwt.verify(token, stateSecret());
    return { connectionId: decoded.connectionId, companyId: decoded.companyId };
  } catch {
    throw new Error("Invalid or expired state token");
  }
}
