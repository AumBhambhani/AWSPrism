const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thin `Authtoken`-header fetch client over the Commvault WebConsole REST API.
// Every call the connector makes is a read-only GET; there is no write path.
//
// Commvault has no official Node SDK, so — like the Acronis and Privy connectors
// — this hand-rolls what an SDK would give for free: auth-header injection, a
// bounded 429 retry, and JSON parsing. Commvault's REST responses are not
// cursor-paginated for the resources this connector reads (dashboard summary,
// storage policy list/detail, alert list), so there is no pagination helper.
export function commvaultClient(apiRoot, accessToken) {
  // Every endpoint this connector reads is a GET; there is no write path, so
  // `request` takes just the path (unlike the acronis/privy clients' (method,
  // path) signature).
  async function request(path) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${apiRoot}${path}`, {
        method: "GET",
        headers: {
          Authtoken: accessToken,
          Accept: "application/json",
        },
      });

      if (res.status === 429 && attempt < 3) {
        const retryAfter = Number(res.headers?.get?.("Retry-After"));
        const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Commvault request to GET ${path} failed: ${res.status} ${text.slice(0, 500)}`
        );
      }

      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  return { request };
}
