const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Container/grouping kinds (multi-source registrations) rather than actual
// scannable data assets — skip them when iterating sources. Per
// task-3a-research-supplement.md's capability matrix.
const CONTAINER_KINDS = new Set(["azuresubscription", "azureresourcegroup", "amazonaccount", "none"]);

function isContainerKind(kind) {
  return CONTAINER_KINDS.has((kind || "").toLowerCase());
}

// Scope limit: first page only, no pagination via the response's `nextLink`
// — matches this codebase's existing Azure connectors, which also don't
// paginate.
async function fetchScannableSources(dataMap) {
  const response = await dataMap.get("/datasources");
  const sources = response.value || [];
  return sources.filter((source) => !isContainerKind(source.kind));
}

function allScanResults(source) {
  const scans = source.scans || [];
  return scans.flatMap((scan) => scan.scanResults || []);
}

export async function checkSourcesScanned(dataMap) {
  const sources = await fetchScannableSources(dataMap);
  if (sources.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }];
  }

  const now = Date.now();

  return sources.map((source) => {
    const resourceId = source.id || source.name || "unknown";
    const successResults = allScanResults(source).filter((r) => (r.status || "").toLowerCase() === "completed");

    if (successResults.length === 0) {
      return {
        resourceId,
        status: "fail",
        message: `${source.name || resourceId} has no successful scan runs`,
        evidencePayload: {},
      };
    }

    const mostRecent = successResults.reduce((latest, r) => {
      const rTime = new Date(r.endTime || r.startTime).getTime();
      const latestTime = new Date(latest.endTime || latest.startTime).getTime();
      return rTime > latestTime ? r : latest;
    });
    const mostRecentTime = new Date(mostRecent.endTime || mostRecent.startTime).getTime();
    const withinWindow = now - mostRecentTime <= THIRTY_DAYS_MS;

    return {
      resourceId,
      status: withinWindow ? "pass" : "fail",
      message: withinWindow
        ? `${source.name || resourceId} completed a successful scan within the last 30 days`
        : `${source.name || resourceId}'s most recent successful scan is older than 30 days`,
      evidencePayload: { mostRecentScanTime: mostRecent.endTime || mostRecent.startTime || null },
    };
  });
}

export async function checkScanScheduleConfigured(dataMap) {
  // Each check function fetches /datasources independently rather than
  // sharing a cache with checkSourcesScanned — kept simple/standalone per
  // task-3a-research-supplement.md guidance not to over-engineer this.
  const sources = await fetchScannableSources(dataMap);
  if (sources.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }];
  }

  return sources.map((source) => {
    const resourceId = source.id || source.name || "unknown";
    // Inferred from scan-run history (`runType`) rather than a direct
    // trigger-configuration read, since the triggers endpoint's response
    // shape wasn't confirmed by research (see task-3a-research-supplement.md).
    const isRecurring = allScanResults(source).some((r) => (r.runType || "").toLowerCase() === "scheduled");
    return {
      resourceId,
      status: isRecurring ? "pass" : "fail",
      message: isRecurring
        ? `${source.name || resourceId} has a recurring scan schedule configured`
        : `${source.name || resourceId} does not have a recurring scan schedule configured`,
      evidencePayload: {},
    };
  });
}

// IMPORTANT — provenance note: the table below is an INVENTED, best-effort
// approximation of Atlas typeName-family -> capability support. It is NOT
// sourced verbatim from task-3a-research-supplement.md. That file's
// capability matrix is keyed on the Scanning API's PascalCase `kind` enum
// (e.g. `AzureSqlDatabase`, `AzureDataExplorer`, `AzureSqlDataWarehouse`),
// which is a different API (the /datasources Scanning API) using a different
// naming convention than the snake_case Atlas `typeName` values returned by
// the entity-search API this table matches against. Purview's Atlas typeName
// taxonomy is not publicly documented (confirmed during Task 0 research), so
// there is no real source to mechanically translate the `kind` matrix from —
// every prefix below is a guess at what the corresponding typeName family
// probably looks like, informed by (but not copied from) the research
// supplement's `kind` -> capability findings.
//
// Entries are tried in order and the first prefix match wins, so more
// specific families must be listed before broader ones they'd otherwise be
// swallowed by — e.g. the Synapse dedicated SQL pool / SQL Data Warehouse
// family (matrix: classification yes, label no) is listed before the
// general "azure_sql" family (matrix: classification yes, label yes), since
// typeName can't be confirmed to actually distinguish the two at the API
// level; this ordering is itself a guess, documented as a known limitation
// rather than resolved with confirmed data.
//
// Unrecognized/unmatched types (including sap*, power_bi/powerbi, and
// anything not covered below) default to "not supported" for both checks —
// safer than guessing at a false compliance signal.
const TYPE_CAPABILITY_RULES = [
  // Azure Synapse dedicated SQL pool / SQL Data Warehouse: classification
  // only (matrix AzureSqlDataWarehouse: Yes/No). Listed first so it takes
  // precedence over the broader "azure_sql" rule below when it matches.
  { prefixes: ["azure_sql_dw", "azure_sql_data_warehouse", "dedicated_sql_pool"], classification: true, label: false },
  // Azure SQL Database / Managed Instance: both supported (matrix
  // AzureSqlDatabase, AzureSqlDatabaseManagedInstance: Yes/Yes).
  { prefixes: ["azure_sql", "azure_sql_mi", "sql_managed_instance"], classification: true, label: true },
  // Azure Storage (Blob) and Azure Files: both supported (matrix
  // AzureStorage, AzureFileService: Yes/Yes). "azure_blob" covers the Atlas
  // typeNames actually observed for blob-storage assets (azure_blob_path,
  // azure_blob_account, azure_blob_service).
  { prefixes: ["azure_storage", "azure_file", "azurefile", "azure_blob"], classification: true, label: true },
  // Azure Data Lake Storage Gen1/Gen2: both supported (matrix AdlsGen1
  // (flagged assumption in the matrix itself), AdlsGen2: Yes/Yes).
  { prefixes: ["azure_datalake", "adls"], classification: true, label: true },
  // Azure Cosmos DB: both supported (matrix AzureCosmosDb: Yes/Yes).
  { prefixes: ["azure_cosmos"], classification: true, label: true },
  // Azure Synapse Analytics Workspace (the workspace resource itself, not
  // the dedicated SQL pool handled above): both supported (matrix
  // AzureSynapseWorkspace/AzureSynapse: Yes/Yes).
  { prefixes: ["azure_synapse"], classification: true, label: true },
  // Azure Data Explorer (Kusto): both supported (matrix AzureDataExplorer:
  // Yes/Yes).
  { prefixes: ["azure_data_explorer", "azure_kusto", "kusto"], classification: true, label: true },
  // Azure Database for PostgreSQL: both supported (matrix AzurePostgreSql:
  // Yes/Yes). Deliberately not a bare "postgresql" prefix — the matrix marks
  // the non-Azure/Amazon PostgreSQL family as unsupported (No/No), and a
  // bare prefix would wrongly capture that family too.
  { prefixes: ["azure_postgresql", "azure_postgres"], classification: true, label: true },
  // SQL Server (on-premises, registered via Purview's SQL Server source
  // type): both supported (matrix SqlServerDatabase: Yes/Yes).
  { prefixes: ["sqlserver", "sql_server", "mssql"], classification: true, label: true },
  // Azure Database for MySQL: both supported (matrix AzureMySql: Yes/Yes).
  // Deliberately not a bare "mysql" prefix — same reasoning as the Postgres
  // rule above: a bare prefix could over-match an unsupported non-Azure
  // MySQL source type, producing a false `fail` rather than `not_applicable`.
  { prefixes: ["azure_mysql"], classification: true, label: true },
  // Amazon RDS (SQL): classification only (matrix AmazonSql: Yes/No).
  // Deliberately not bare "rds" — same over-matching concern as above.
  { prefixes: ["amazon_rds", "amazon_sql"], classification: true, label: false },
  // Amazon S3: classification only (matrix AmazonS3: Yes/No).
  { prefixes: ["amazon_s3"], classification: true, label: false },
  // Oracle: classification only (matrix Oracle: Yes/No).
  { prefixes: ["oracle"], classification: true, label: false },
  // Teradata: classification only (matrix Teradata: Yes/No).
  { prefixes: ["teradata"], classification: true, label: false },
  // SAP (S/4HANA, ECC) and Power BI: neither supported (matrix: No/No).
  { prefixes: ["sap", "power_bi", "powerbi"], classification: false, label: false },
];

function getEntityTypeName(entity) {
  return entity.typeName || entity.entityType || "";
}

function findCapabilityRule(typeName) {
  const lower = (typeName || "").toLowerCase();
  return TYPE_CAPABILITY_RULES.find((rule) => rule.prefixes.some((prefix) => lower.startsWith(prefix)));
}

function sourceTypeSupportsClassification(typeName) {
  return findCapabilityRule(typeName)?.classification === true;
}

function sourceTypeSupportsSensitivityLabeling(typeName) {
  return findCapabilityRule(typeName)?.label === true;
}

function entityResourceId(entity) {
  return entity.guid || entity.id || entity.qualifiedName || entity.name || "unknown";
}

async function searchEntities(dataMap) {
  // Scope limit: first page only, no pagination — same limit as
  // fetchScannableSources above.
  const response = await dataMap.post("/datamap/api/search/query?api-version=2023-09-01", { keywords: null, limit: 100 });
  return response.value || response.entities || [];
}

export async function checkClassificationApplied(dataMap) {
  const entities = await searchEntities(dataMap);
  if (entities.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No scanned assets were found", evidencePayload: {} }];
  }

  return entities.map((entity) => {
    const resourceId = entityResourceId(entity);
    const typeName = getEntityTypeName(entity);

    if (!sourceTypeSupportsClassification(typeName)) {
      return {
        resourceId,
        status: "not_applicable",
        message: `Asset type "${typeName}" does not support classification`,
        evidencePayload: { typeName },
      };
    }

    const classifications = Array.isArray(entity.classification)
      ? entity.classification
      : Array.isArray(entity.classifications)
        ? entity.classifications
        : [];
    const hasClassifications = classifications.length > 0;

    return {
      resourceId,
      status: hasClassifications ? "pass" : "fail",
      message: hasClassifications ? "Asset has classifications applied" : "Asset has no classifications applied",
      evidencePayload: { typeName, classificationCount: classifications.length },
    };
  });
}

// Looks for any key (on entity.attributes, falling back to the entity itself)
// whose name case-insensitively contains "label" — no confirmed REST field
// name exists for sensitivity labels on Data Map entities (see
// task-3a-research-supplement.md), so this is a defensive best guess.
function findLabelValue(entity) {
  const source = entity.attributes && typeof entity.attributes === "object" ? entity.attributes : entity;
  if (!source || typeof source !== "object") return undefined;
  const key = Object.keys(source).find((k) => k.toLowerCase().includes("label"));
  return key ? source[key] : undefined;
}

export async function checkSensitivityLabelsApplied(dataMap) {
  const entities = await searchEntities(dataMap);
  if (entities.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No scanned assets were found", evidencePayload: {} }];
  }

  const labelSupport = entities.map((entity) => sourceTypeSupportsSensitivityLabeling(getEntityTypeName(entity)));
  const anyLabelFieldFound = entities.some((entity, i) => labelSupport[i] && findLabelValue(entity) !== undefined);

  // If at least one entity's type supports labeling but not a single one of
  // them exposes a recognizable label field anywhere in the result set, this
  // is an unconfirmed-API-shape gap, not a per-asset compliance failure —
  // collapse to a single not_applicable rather than asserting a false
  // negative on every labelable asset (see task-3a-research-supplement.md).
  if (labelSupport.some(Boolean) && !anyLabelFieldFound) {
    return [
      {
        resourceId: "account",
        status: "not_applicable",
        message:
          "Sensitivity label data was not found in the API response; this may require Microsoft 365 licensing in the tenant, or the field name differs from what this check expects — verify manually in the Purview portal.",
        evidencePayload: {},
      },
    ];
  }

  return entities.map((entity, i) => {
    const resourceId = entityResourceId(entity);
    const typeName = getEntityTypeName(entity);

    if (!labelSupport[i]) {
      return {
        resourceId,
        status: "not_applicable",
        message: `Asset type "${typeName}" does not support sensitivity labeling`,
        evidencePayload: { typeName },
      };
    }

    const hasLabel = Boolean(findLabelValue(entity));
    return {
      resourceId,
      status: hasLabel ? "pass" : "fail",
      message: hasLabel ? "Asset has a sensitivity label applied" : "Asset has no sensitivity label applied",
      evidencePayload: { typeName },
    };
  });
}

export const datamapTests = [
  { key: "purview.datamap.sources_scanned", title: "Registered data sources have a recent successful scan", failTitle: "Registered data source has no recent successful scan", severityDefault: "high", isoReferences: ["A.8.1.1"], dpdpaControlAreas: ["Data Inventory / RoPA"], run: (clients) => checkSourcesScanned(clients.dataMap) },
  { key: "purview.datamap.scan_schedule_configured", title: "Registered data sources have a recurring scan schedule", failTitle: "Registered data source has no recurring scan schedule configured", severityDefault: "medium", isoReferences: ["A.8.1.1"], dpdpaControlAreas: ["Data Inventory / RoPA"], run: (clients) => checkScanScheduleConfigured(clients.dataMap) },
  { key: "purview.datamap.classification_applied", title: "Scanned assets have classifications applied", failTitle: "Scanned asset has no classifications applied", severityDefault: "medium", isoReferences: ["A.8.2.1"], dpdpaControlAreas: ["Data Inventory / RoPA"], run: (clients) => checkClassificationApplied(clients.dataMap) },
  { key: "purview.datamap.sensitivity_labels_applied", title: "Scanned assets have sensitivity labels applied", failTitle: "Scanned asset has no sensitivity label applied", severityDefault: "medium", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["DLP / Data Leakage Prevention"], run: (clients) => checkSensitivityLabelsApplied(clients.dataMap) },
];
