// Google's Node client (unlike Azure's async-iterator SDKs) returns a plain
// `{ data: { items, nextPageToken } }` promise per call, so pagination is a
// manual pageToken loop. `itemsKey` varies per API (Directory API list
// endpoints use "users"/"groups"/"tokens"/etc.; Reports API uses "items";
// Cloud Identity Policy API uses "policies").
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
