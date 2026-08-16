/**
 * rdlc-jcs-v1 canonical serialization and hash profiles (spec §12.5, §12.6).
 *
 * Canonicalization parses the schema-valid logical artifact, normalizes
 * strings to Unicode NFC, normalizes hash-included timestamps to RFC 3339 UTC
 * with a Z suffix, sorts set-like arrays by their schema-declared keys,
 * serializes with RFC 8785 JCS, and hashes the UTF-8 canonical bytes with
 * SHA-256. Every operation fails closed (§12.5).
 */

import { createHash } from "node:crypto";

import rfc8785 from "canonicalize";
import YAML from "yaml";

export const HASH_PROFILE_VERSION = "rdlc-jcs-v1";

export class CanonicalizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Normalize an RFC 3339 instant to UTC with a Z suffix (§12.6).
 * Fractional-second digits are preserved as written when already UTC;
 * offset instants are converted using millisecond precision.
 */
export function normalizeTimestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) {
    throw new CanonicalizationError(`not an RFC 3339 instant: ${value}`);
  }
  if (UTC_TIMESTAMP_PATTERN.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CanonicalizationError(`unparseable instant: ${value}`);
  return parsed.toISOString().replace(/\.000Z$/, "Z");
}

/**
 * Parse YAML or JSON source text rejecting duplicate object keys (§12.5 item 2).
 */
export function parseStrict(text) {
  const document = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) {
    throw new CanonicalizationError(`source cannot be parsed safely: ${document.errors[0].message}`);
  }
  return document.toJS({ maxAliasCount: 100 });
}

function isTimestampLike(value) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value);
}

function compareByKeys(keys) {
  return (a, b) => {
    for (const key of keys) {
      const left = a?.[key];
      const right = b?.[key];
      if (left === right) continue;
      if (left === undefined) return -1;
      if (right === undefined) return 1;
      const l = String(left);
      const r = String(right);
      if (l < r) return -1;
      if (l > r) return 1;
    }
    return 0;
  };
}

/**
 * Recursively normalize a parsed value for canonicalization:
 * NFC strings, normalized UTC timestamps, schema-hinted set-array sorting,
 * and I-JSON number validation (§12.5 items 3–6).
 *
 * `hints` mirrors the schema's `x-rdlc-set-keys` map: property name ->
 * array of sort keys (sorted as a set) or null (order-significant).
 */
export function normalizeValue(value, hints = {}, path = "$") {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalizationError(`non-finite number at ${path}`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new CanonicalizationError(`integer outside the I-JSON safe range must be a schema-defined string at ${path}`);
    }
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.normalize("NFC");
    return isTimestampLike(normalized) ? normalizeTimestamp(normalized) : normalized;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeValue(entry, hints, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      const childPath = `${path}.${key}`;
      let normalized = normalizeValue(entry, hints, childPath);
      const setKeys = hints[key];
      if (Array.isArray(setKeys) && Array.isArray(normalized)) {
        normalized = [...normalized].sort(compareByKeys(setKeys));
      }
      result[key] = normalized;
    }
    return result;
  }
  throw new CanonicalizationError(`unsupported value type ${typeof value} at ${path}`);
}

/** Serialize a normalized value with RFC 8785 JCS (§12.5 item 7). */
export function canonicalBytes(value, hints = {}) {
  const serialized = rfc8785(normalizeValue(value, hints));
  if (typeof serialized !== "string") throw new CanonicalizationError("value cannot be canonicalized");
  return Buffer.from(serialized, "utf8");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stampedHash(hash, profile) {
  return Object.freeze({ hash, hash_profile: HASH_PROFILE_VERSION, profile });
}

/** source_hash: original retained source bytes exactly as received (§12.5). */
export function sourceHash(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new CanonicalizationError("source bytes are required");
  return stampedHash(sha256(bytes), "source_hash");
}

const CONTENT_EXCLUDED_FIELDS = Object.freeze([
  "content_hash", "display_id", "created_at", "updated_at", "external_refs"
]);

/**
 * content_hash: schema-declared semantic fields and governed relationships,
 * excluding presentation, aliases, audit, receipts, and operational
 * timestamps (§12.5). `schema` supplies x-rdlc-governed and x-rdlc-set-keys.
 */
export function contentHash(record, schema) {
  if (!record?.schema_version) throw new CanonicalizationError("record schema_version is required");
  const governed = schema?.["x-rdlc-governed"];
  if (!Array.isArray(governed) || governed.length === 0) {
    throw new CanonicalizationError(`schema does not declare x-rdlc-governed fields for ${record.schema_version}`);
  }
  const projection = { schema_version: record.schema_version, id: record.id };
  for (const field of governed) {
    if (CONTENT_EXCLUDED_FIELDS.includes(field)) {
      throw new CanonicalizationError(`excluded field cannot be governed: ${field}`);
    }
    if (record[field] !== undefined) projection[field] = record[field];
  }
  const bytes = canonicalBytes(projection, schema?.["x-rdlc-set-keys"] ?? {});
  return { ...stampedHash(sha256(bytes), "content_hash"), schema_version: record.schema_version };
}

/**
 * approval_package_hash: ordered artifact content hashes, locks, policy
 * versions, approver set, blocking findings, waivers, and material diff;
 * decisions and signatures are excluded (§12.5).
 */
export function approvalPackageHash(pkg) {
  for (const field of ["artifact_hashes", "policy_versions", "required_approvers"]) {
    if (!Array.isArray(pkg?.[field]) || pkg[field].length === 0) {
      throw new CanonicalizationError(`approval package requires non-empty ${field}`);
    }
  }
  for (const field of ["decisions", "signatures"]) {
    if (pkg[field] !== undefined) throw new CanonicalizationError(`approval package must not embed ${field}`);
  }
  const projection = {
    artifact_hashes: pkg.artifact_hashes,
    source_locks: pkg.source_locks ?? [],
    kb_lock: pkg.kb_lock ?? null,
    policy_versions: pkg.policy_versions,
    required_approvers: pkg.required_approvers,
    blocking_findings: pkg.blocking_findings ?? [],
    waivers: pkg.waivers ?? [],
    material_diff: pkg.material_diff ?? null
  };
  const bytes = canonicalBytes(projection, { required_approvers: ["principal"], source_locks: ["id"] });
  return stampedHash(sha256(bytes), "approval_package_hash");
}

/**
 * baseline_root_hash: canonical manifest of approval-package hashes, artifact
 * hashes, source locks, adopted redaction tombstones, and baseline metadata;
 * signatures and later addenda are excluded (§12.5).
 */
export function baselineRootHash(manifest) {
  for (const field of ["approval_package_hashes", "artifact_hashes"]) {
    if (!Array.isArray(manifest?.[field]) || manifest[field].length === 0) {
      throw new CanonicalizationError(`baseline manifest requires non-empty ${field}`);
    }
  }
  const projection = {
    approval_package_hashes: manifest.approval_package_hashes,
    artifact_hashes: manifest.artifact_hashes,
    source_locks: manifest.source_locks ?? [],
    adopted_redaction_tombstones: manifest.adopted_redaction_tombstones ?? [],
    metadata: manifest.metadata ?? {}
  };
  const bytes = canonicalBytes(projection, {});
  return stampedHash(sha256(bytes), "baseline_root_hash");
}

/**
 * redaction_addendum_hash: original baseline root, ordered tombstones,
 * authority, storage boundary, and resulting availability state (§12.5).
 */
export function redactionAddendumHash(addendum) {
  for (const field of ["original_baseline_root", "tombstones", "authority", "storage_boundary", "availability_state"]) {
    if (addendum?.[field] === undefined || (Array.isArray(addendum[field]) && addendum[field].length === 0)) {
      throw new CanonicalizationError(`redaction addendum requires ${field}`);
    }
  }
  const projection = {
    original_baseline_root: addendum.original_baseline_root,
    tombstones: addendum.tombstones,
    authority: addendum.authority,
    storage_boundary: addendum.storage_boundary,
    availability_state: addendum.availability_state
  };
  const bytes = canonicalBytes(projection, {});
  return stampedHash(sha256(bytes), "redaction_addendum_hash");
}

/**
 * readback_hash: provider-normalized fields selected by the versioned
 * connector mapping; everything outside the mapping is excluded (§12.5).
 */
export function readbackHash(providerFields, mapping) {
  if (!mapping?.version || !Array.isArray(mapping.fields) || mapping.fields.length === 0) {
    throw new CanonicalizationError("connector mapping version and fields are required");
  }
  const projection = { mapping_version: mapping.version, fields: {} };
  for (const field of mapping.fields) {
    projection.fields[field] = providerFields?.[field] === undefined ? null : providerFields[field];
  }
  const bytes = canonicalBytes(projection, {});
  return { ...stampedHash(sha256(bytes), "readback_hash"), mapping_version: mapping.version };
}
