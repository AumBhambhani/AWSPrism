import * as cheerio from "cheerio";

// Minimal SOAP 1.1 client for OpenText Carbonite Core Endpoint Backup's legacy
// "Dashboard Service" (a WCF `.svc` endpoint). It is the *only* Carbonite API
// confirmed to expose device backup-status data — there is no REST/JSON
// equivalent and no Node SDK, so this hand-rolls what a SOAP client would give:
// envelope construction, a POST via built-in `fetch`, and XML response parsing.
//
// Parsing uses `cheerio` in xml mode (already a dependency for scanner/) rather
// than a new SOAP/XML package — the confirmed call surface is just two read
// operations (GetDeviceList, GetDashboardDeviceInfo).
//
// EVERYTHING about the wire format here is UNCONFIRMED (connector plan Task 0,
// item 5): the vendor docs only show C#/PowerShell "Add Service Reference"
// examples and never publish the raw envelope, the SOAPAction strings, or the
// XML namespace. Defaults below assume the WCF basicHttpBinding norm (SOAP 1.1,
// `http://tempuri.org/` service namespace, `<ns>/<IContract>/<Op>` SOAPAction).
// Confirm against a live tenant's `?WSDL` before this connector leaves beta.

export const DEFAULT_SERVICE_NS = "http://tempuri.org/"; // TODO CONFIRM (Task 0, item 5)
export const DEFAULT_CONTRACT = "IDashboardService"; // TODO CONFIRM — WCF SOAPAction is <ns><Contract>/<Op>

const SOAP_ENV_NS = "http://schemas.xmlsoap.org/soap/envelope/";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Serialises a plain JS value into child XML elements. Objects → nested elements,
// arrays → repeated elements, primitives → text. `null`/`undefined` are skipped.
function valueToXml(tag, value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => valueToXml(tag, v)).join("");
  if (typeof value === "object") {
    const inner = Object.entries(value).map(([k, v]) => valueToXml(k, v)).join("");
    return `<${tag}>${inner}</${tag}>`;
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

// Builds a SOAP 1.1 envelope for one Dashboard Service operation. The
// `CallingContext` object carries auth *inside the body* (not a header) —
// { ContextIdentity, AuthenticationToken, TokenType } per the vendor docs.
export function buildSoapEnvelope({ operation, serviceNs = DEFAULT_SERVICE_NS, callingContext, params = {} }) {
  const ccXml = valueToXml("callingContext", callingContext);
  const paramsXml = Object.entries(params).map(([k, v]) => valueToXml(k, v)).join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="${SOAP_ENV_NS}">` +
    `<soap:Body>` +
    `<${operation} xmlns="${serviceNs}">${ccXml}${paramsXml}</${operation}>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

// Recursively converts an element's children to a JS value. Repeated child tag
// names collapse to arrays; a leaf element becomes its trimmed text. `xsi:nil`
// / empty elements become null.
function elementToValue($, el) {
  const $el = $(el);
  const children = $el.children();
  if (children.length === 0) {
    if ($el.attr("i:nil") === "true" || $el.attr("xsi:nil") === "true") return null;
    const text = $el.text().trim();
    return text === "" ? null : text;
  }
  const out = {};
  children.each((_, child) => {
    const name = child.tagName || child.name;
    const bare = String(name).replace(/^.*:/, "");
    const value = elementToValue($, child);
    if (bare in out) {
      if (!Array.isArray(out[bare])) out[bare] = [out[bare]];
      out[bare].push(value);
    } else {
      out[bare] = value;
    }
  });
  return out;
}

// Bare (namespace-stripped, lowercased) local name of an element.
function localName(el) {
  return String(el?.tagName || el?.name || "").replace(/^.*:/, "").toLowerCase();
}

// First element anywhere in the tree whose local name matches `name`
// (case-insensitive) — tolerates namespace prefixes that CSS selectors can't
// express (`s:Fault`, `a:GetDeviceListResponse`, ...).
function findByLocalName($, name) {
  const target = name.toLowerCase();
  let hit = null;
  $("*").each((_, el) => {
    if (!hit && localName(el) === target) hit = el;
  });
  return hit;
}

// Parses a Dashboard Service SOAP response. Throws on a SOAP Fault or on
// `ServiceResponse.Status` other than "Completed" (InvalidCredentials,
// InvalidInput, ServerUnableToProcessRequest, ...). Returns the `<{op}Result>`
// subtree as a JS object (including its Status / OverallStatus fields).
export function parseSoapResponse(xml, operation) {
  const $ = cheerio.load(xml, { xml: true });

  const faultEl = findByLocalName($, "Fault");
  if (faultEl) {
    const reasonEl =
      findByLocalName($, "faultstring") || findByLocalName($, "text") || findByLocalName($, "reason");
    const reason = (reasonEl ? $(reasonEl).text().trim() : "") || "unknown SOAP fault";
    throw new Error(`Carbonite Dashboard Service returned a SOAP fault: ${reason}`);
  }

  // WCF names the result element "<Operation>Result" inside "<Operation>Response".
  const resultEl = findByLocalName($, `${operation}Result`);
  const responseEl = findByLocalName($, `${operation}Response`);

  if (!resultEl && !responseEl) {
    throw new Error(
      `Carbonite Dashboard Service response for ${operation} did not contain a ` +
        `<${operation}Result> element — the envelope shape needs to be reconfirmed ` +
        `against this tenant's live WSDL (see the connector plan Task 0).`
    );
  }

  const result = elementToValue($, resultEl || responseEl);

  // `ServiceResponse.Status` sits either on the result or one level up depending
  // on the WCF data-contract; check both.
  let status = result && typeof result === "object" ? result.Status : null;
  if (!status && responseEl) {
    const statusEl = $(responseEl).find("*").filter((_, el) => localName(el) === "status").first();
    status = statusEl.length ? statusEl.text().trim() : null;
  }

  if (status && status !== "Completed") {
    if (String(status).toLowerCase().includes("invalidcredentials")) {
      throw new Error(`Carbonite Dashboard Service rejected the credentials (Status: ${status})`);
    }
    throw new Error(`Carbonite Dashboard Service call ${operation} did not complete (Status: ${status})`);
  }

  return result;
}

export async function callDashboardService({
  endpoint,
  operation,
  serviceNs = DEFAULT_SERVICE_NS,
  contract = DEFAULT_CONTRACT,
  callingContext,
  params = {},
  fetchImpl = fetch,
}) {
  const envelope = buildSoapEnvelope({ operation, serviceNs, callingContext, params });
  const soapAction = `${serviceNs}${contract}/${operation}`; // TODO CONFIRM (Task 0, item 5)

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${soapAction}"`,
    },
    body: envelope,
  });

  const xml = await res.text().catch(() => "");

  if (!res.ok && !xml.trim()) {
    throw new Error(`Carbonite Dashboard Service ${operation} failed: HTTP ${res.status}`);
  }

  // A SOAP fault is delivered with HTTP 500 and an XML body — parseSoapResponse
  // extracts the fault reason, so only throw the bare HTTP error when there is
  // no parseable body at all (handled above).
  try {
    return parseSoapResponse(xml, operation);
  } catch (err) {
    if (!res.ok && !/SOAP fault|Status:/i.test(err.message)) {
      throw new Error(`Carbonite Dashboard Service ${operation} failed: HTTP ${res.status} — ${err.message}`);
    }
    throw err;
  }
}
