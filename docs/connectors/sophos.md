# Sophos Central Connector

## 1. Overview

- **`integrations.key`**: `sophos`
- **`integrations.category`**: `endpoint_security`
- **`integrations.auth_type`**: `oauth2`
- **Status**: `beta`

This connector gathers read-only evidence from Sophos Central Endpoint, Common,
Detections, Audit, XDR, SIEM, Firewall, Web Control and DNS Protection APIs. Each
product area is isolated so an absent licence or read entitlement reports
`not_applicable` for that area without stopping the rest of the run. Cloud Optix
is intentionally separate; see `sophos-cloud.md`.

## 2. Authentication

Create a tenant-level service-principal credential in **Sophos Central Admin >
Global Settings > API Credentials** and assign the narrowest read-only role that
covers the products being audited. Partner and organization credentials are not
accepted by this connector.

Non-secret `config`:

```json
{}
```

Encrypted `secret`:

```json
{ "clientId": "...", "clientSecret": "..." }
```

Prism posts the OAuth2 client-credentials form to
`https://id.sophos.com/api/v2/oauth2/token`, calls
`https://api.central.sophos.com/whoami/v1`, validates `idType: tenant`, and uses
the returned `apiHosts.dataRegion` with `X-Tenant-ID` for tenant-scoped calls.

## 3. API Reference

- Endpoint: `/endpoint/v1/endpoints`, `/policies`, `/endpoint-groups`.
- Common: `/common/v1/alerts`, `/admins`, `/roles`.
- Detections: `POST /detections/v1/queries/detections`, poll the returned run,
  then read `/results`.
- Audit: `/audit-logs/v1/audit-logs` remains beta/live-tenant verification gated.
- XDR: `POST /xdr-query/v1/queries/runs`, poll, then read `/results`.
- SIEM: `/siem/v1/events` and `/siem/v1/alerts`, using `next_cursor` pagination.
- Firewall: `/firewall/v1/firewalls` and `/firewall-groups`.
- DNS Protection: current `/dns-protection/v2/locations`, `/policies`, and
  `/custom-domains` resources.
- Pagination supports both `pages.nextKey`/`pageFromKey` and numeric `page`
  metadata; SIEM uses `next_cursor`/`cursor`.
- HTTP 429 is retried up to four times with bounded `Retry-After` backoff.

Official references: [Sophos Central APIs](https://developer.sophos.com/intro),
[tenant setup](https://developer.sophos.com/getting-started-tenant),
[DNS Protection v2](https://developer.sophos.com/dns-protection).

## 4. Checks

| test_key | title | severity | ISO 27001:2013 |
|---|---|---|---|
| `sophos.endpoint.protection_health` | All managed endpoints report good overall health | high | A.12.2.1 |
| `sophos.endpoint.tamper_protection_enabled` | Tamper Protection is enabled on every device | high | A.12.2.1 |
| `sophos.endpoint.services_running` | All required Sophos protection services are running | high | A.12.2.1 |
| `sophos.endpoint.threat_policy_baseline` | Threat Protection policies keep core protections on | high | A.12.2.1 |
| `sophos.endpoint.exploit_mitigation_clear` | No unresolved exploit-mitigation detections | high | A.12.6.1 |
| `sophos.endpoint.no_stale_devices` | No devices have gone unseen past the threshold | medium | A.8.1.1 |
| `sophos.endpoint.isolation_reviewed` | No devices remain isolated without review | medium | A.16.1.5 |
| `sophos.endpoint.encryption_enabled` | Device Encryption is active where assigned | medium | A.10.1.1 |
| `sophos.common.no_unresolved_critical_alerts` | No unresolved critical alerts | critical | A.16.1.5 |
| `sophos.common.high_alerts_triaged` | High alerts meet the triage SLA | high | A.16.1.4 |
| `sophos.common.admin_count_reasonable` | Admin count is within the expected bound | medium | A.9.2.3 |
| `sophos.common.super_admin_least_privilege` | Super Admin membership is minimal | high | A.9.2.3 |
| `sophos.common.mfa_enforced` | MFA is enforced for admin sign-in | high | A.9.4.2 |
| `sophos.detections.critical_resolved` | No open critical XDR detections | critical | A.16.1.5 |
| `sophos.detections.high_reviewed` | High detections are reviewed on time | high | A.16.1.4 |
| `sophos.detections.feed_active` | Detections data is available | low | A.12.4.1 |
| `sophos.audit.log_retrievable` | Audit events are retrievable | medium | A.12.4.1 |
| `sophos.audit.admin_activity_logged` | Administrative changes appear in audit logs | medium | A.12.4.3 |
| `sophos.audit.api_credential_changes_reviewed` | API credential changes are surfaced | medium | A.9.2.5 |
| `sophos.xdr.data_lake_queryable` | Data Lake responds to a baseline query | low | A.12.4.1 |
| `sophos.xdr.telemetry_coverage` | Data Lake covers the endpoint population | medium | A.12.2.1 |
| `sophos.xdr.no_stale_telemetry` | Data Lake telemetry is current | medium | A.12.4.1 |
| `sophos.siem.events_flowing` | SIEM events are current | medium | A.12.4.1 |
| `sophos.siem.alerts_current` | SIEM alerts are current | medium | A.16.1.2 |
| `sophos.siem.integration_credential_active` | SIEM API credential is active | low | A.12.4.1 |
| `sophos.firewall.all_connected` | All managed firewalls are connected | high | A.13.1.1 |
| `sophos.firewall.firmware_current` | Firewall firmware is supported | high | A.12.6.1 |
| `sophos.firewall.central_management_active` | Central management is not suspended | medium | A.13.1.1 |
| `sophos.firewall.ha_configured` | HA-required firewalls are paired | medium | A.13.1.1 |
| `sophos.firewall.config_sync_healthy` | Firewall-group configuration is synchronized | medium | A.12.1.2 |
| `sophos.web.policy_assigned` | Every endpoint group has Web Control | medium | A.13.1.1 |
| `sophos.web.risky_categories_blocked` | Risky categories are blocked | medium | A.13.1.1 |
| `sophos.web.download_scanning_enabled` | Download scanning/TLS inspection is enabled | medium | A.13.1.1 |
| `sophos.web.no_blanket_allow` | No blanket allow exception exists | medium | A.9.4.1 |
| `sophos.dns.protection_active` | A DNS Protection location is active | medium | A.13.1.1 |
| `sophos.dns.malware_categories_blocked` | DNS blocks malware/phishing/C2 | high | A.12.2.1 |
| `sophos.dns.all_locations_have_policy` | Every DNS location has a policy | medium | A.13.1.1 |
| `sophos.dns.safe_search_enforced` | DNS safe search is enforced | low | A.13.1.1 |
| `sophos.dns.custom_blocklist_present` | A maintained custom block list exists | low | A.13.1.1 |

## 5. Seed SQL

The authoritative idempotent catalog rows live in `init.sql` under
`Sophos Central connector: catalog seed data`. At API boot,
`syncTestDefinitions()` also derives DPDPA, GDPR, SOC2, HIPAA, CIS, PCI DSS and
CERT-In mappings from each JavaScript check definition and the Annex A crosswalk.

## 6. Implementation Notes

- `api/src/connectors/sophos/credentials.js` handles OAuth2 and tenant routing.
- `client.js` handles tenant headers, pagination and retry.
- `tests/*.js` contains one module per product area; unexpected response shapes
  return `error` and are never interpreted as a passing control.
- `index.js` memoizes shared resources per run and isolates scope/licence errors.
- Live validation is still required for the MFA, audit, XDR query body, detailed
  Web Control fields, firmware lifecycle, firewall-group sync and HA expectation
  signals before promoting the connector from beta.
