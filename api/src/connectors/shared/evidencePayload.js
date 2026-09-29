/**
 * Standardized `evidencePayload` shape for connector check results.
 *
 * Today, every connector check (api/src/connectors/{aws,azure,github,purview}/tests/*.js)
 * builds its own freeform `evidencePayload` object with whatever fields happen to be
 * convenient for that particular check (e.g. `{ dbInstanceIdentifier, publiclyAccessible }`).
 * That's fine — this helper does not require or validate anything about existing payloads,
 * and existing connectors are NOT being refactored to use it.
 *
 * Going forward, NEW connectors/checks are encouraged to build their `evidencePayload` with
 * `buildEvidencePayload()` so a few common, resource-identifying fields land in a consistent
 * place across connectors:
 *
 *   - `resourceType`: a short, connector-defined kind for the resource (e.g. "rds_instance",
 *     "s3_bucket", "storage_account", "repo").
 *   - `resourceId`: the resource's unique identifier (ARN, resource ID, full name, etc.) —
 *     this typically duplicates the top-level `resourceId` already returned alongside
 *     `evidencePayload` in a check's result, but is included here too so the evidence
 *     payload is self-describing on its own.
 *   - `resourceName`: a human-friendly display name for the resource, when it differs from
 *     `resourceId` (e.g. an RDS `DBInstanceIdentifier` vs. its ARN).
 *   - `region`: cloud region/location, when applicable (`null` for global/regionless
 *     resources or non-cloud connectors such as GitHub).
 *   - `details`: an object holding whatever check-specific fields the check wants to surface
 *     (this is where today's freeform fields go, e.g. `{ publiclyAccessible: false }`).
 *
 * This is a thin shape-enforcing constructor, not a validation library — it does not check
 * types or throw on missing fields. `findingEvidencePdf.js` reads `resourceType`,
 * `resourceName`, and `region` off of `evidencePayload` when present, and falls back
 * gracefully (omitting those fields) for payloads that don't use this shape.
 *
 * Example:
 *
 *   evidencePayload: buildEvidencePayload({
 *     resourceType: "rds_instance",
 *     resourceId: instance.DBInstanceArn,
 *     resourceName: instance.DBInstanceIdentifier,
 *     region: instance.AvailabilityZone?.slice(0, -1),
 *     details: { publiclyAccessible: Boolean(instance.PubliclyAccessible) },
 *   })
 */
export function buildEvidencePayload({ resourceType, resourceId, resourceName, region, details } = {}) {
  return {
    resourceType,
    resourceId,
    resourceName,
    region: region ?? null,
    details: details ?? {},
  };
}
