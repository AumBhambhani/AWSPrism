// OData $top/$skip pagination for the Defender for Endpoint API.
// This is NOT @odata.nextLink-based — Defender uses offset pagination, not cursors.
export async function oDataPaginate(getToken, baseUrl, path, pageSize = 1000) {
  const items = [];
  let skip = 0;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${separator}$top=${pageSize}&$skip=${skip}`;
    const token = await getToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Defender request to ${url} failed: ${res.status} ${text}`);
    }
    const body = await res.json();
    const page = body.value || [];
    items.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }
  return items;
}

// Single Defender GET, returning the parsed response body.
export async function defenderGet(getToken, baseUrl, path) {
  const token = await getToken();
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Defender request to ${baseUrl}${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}
