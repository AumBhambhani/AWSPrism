// GCP list endpoints (like Google Workspace's) return a plain
// `{ data: { <itemsKey>, nextPageToken } }` promise per call rather than an
// async iterator, so pagination is a manual pageToken loop.
export async function paginate(listFn, baseParams, itemsKey) {
  const results = [];
  let pageToken;
  do {
    const { data } = await listFn({ ...baseParams, pageToken });
    for (const item of data[itemsKey] || []) results.push(item);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}
