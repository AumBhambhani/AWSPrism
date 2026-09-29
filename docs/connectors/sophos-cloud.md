# Sophos Cloud Optix Connector (proposed)

## 1. Overview

This is a design placeholder for a separate `sophos-cloud` connector. Cloud
Optix uses a distinct API and security boundary from Sophos Central, so it is
not included in the `sophos` endpoint-security connector.

## 2. Authentication

Proposed `api_key` authentication against the customer Cloud Optix tenant host.
The encrypted secret would contain the API key; non-secret config would contain
the validated `https://*.optix.sophos.com` base URL.

## 3. Proposed scope

- Cloud environment/account inventory coverage.
- High-risk cloud security findings and ageing.
- Compliance-standard assessment status.
- Public exposure and identity-risk posture.
- Logging and configuration-monitoring coverage.

## 4. Status

Design spec only; not implemented. Before implementation, verify the current
Cloud Optix API contract, pagination, least-privilege key role, tenant routing,
and available compliance-standard endpoints against a live tenant.
