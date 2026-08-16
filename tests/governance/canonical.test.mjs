import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CanonicalizationError,
  HASH_PROFILE_VERSION,
  approvalPackageHash,
  baselineRootHash,
  canonicalBytes,
  contentHash,
  normalizeTimestamp,
  parseStrict,
  readbackHash,
  redactionAddendumHash,
  sourceHash
} from "../../core/lib/canonical.mjs";

const kat = JSON.parse(await readFile("fixtures/canonical/kat.json", "utf8"));

test("FEAT-003: known-answer vectors reproduce exactly", () => {
  assert.equal(kat.profile, HASH_PROFILE_VERSION);
  assert.ok(kat.cases.length >= 9);
  for (const entry of kat.cases) {
    if (entry.kind === "canonical") {
      const bytes = canonicalBytes(entry.input, entry.hints);
      assert.equal(bytes.toString("utf8"), entry.expected_canonical, entry.name);
      assert.equal(sourceHash(bytes).hash, entry.expected_hash, entry.name);
    } else if (entry.kind === "content_hash") {
      assert.equal(contentHash(entry.input, entry.schema).hash, entry.expected_hash, entry.name);
    } else {
      assert.fail(`unknown KAT kind: ${entry.kind}`);
    }
  }
});

test("FEAT-003: KAT coverage spans the §44.1 vector categories", () => {
  const names = kat.cases.map(({ name }) => name).join(" ");
  for (const required of ["unicode", "timestamp", "numeric", "set-like", "ordered", "null", "excluded"]) {
    assert.match(names, new RegExp(required), `missing ${required} vector`);
  }
});

test("FEAT-003: NFC normalization makes composed and decomposed strings hash-equal", () => {
  const composed = canonicalBytes({ t: "café" });
  const decomposed = canonicalBytes({ t: "café" });
  assert.equal(composed.toString("utf8"), decomposed.toString("utf8"));
});

test("FEAT-003: timestamp canonicalization is injective at millisecond precision", () => {
  // One instant, many notations -> exactly one canonical form.
  const canonical = "2026-08-15T17:02:00.000Z";
  for (const notation of [
    "2026-08-15T19:02:00+02:00",
    "2026-08-15T17:02:00Z",
    "2026-08-15T17:02:00.0Z",
    "2026-08-15T17:02:00.000000Z",
    "2026-08-15t17:02:00z"
  ]) {
    assert.equal(normalizeTimestamp(notation), canonical, notation);
  }
  assert.equal(normalizeTimestamp("2026-08-15T17:02:00.250Z"), "2026-08-15T17:02:00.250Z");
  assert.equal(normalizeTimestamp("2026-08-15T17:02:00.2500Z"), "2026-08-15T17:02:00.250Z");
  // Informative sub-millisecond precision fails closed instead of truncating.
  assert.throws(() => normalizeTimestamp("2026-08-15T17:02:00.123456Z"), CanonicalizationError);
  assert.throws(() => normalizeTimestamp("2026-08-15 17:02:00"), CanonicalizationError);
});

test("FEAT-003: object keys are NFC-normalized and collisions fail closed", () => {
  const composedKey = "caf\u00e9";
  const decomposedKey = "café";
  const a = canonicalBytes({ [composedKey]: 1 }).toString("utf8");
  const b = canonicalBytes({ [decomposedKey]: 1 }).toString("utf8");
  assert.equal(a, b);
  assert.throws(
    () => canonicalBytes({ [composedKey]: 1, [decomposedKey]: 2 }),
    CanonicalizationError
  );
});

test("FEAT-003: set-sort ties break deterministically, independent of producer order", () => {
  const forward = canonicalBytes({ r: [{ k: "a", v: 2 }, { k: "a", v: 1 }] }, { r: ["k"] }).toString("utf8");
  const reversed = canonicalBytes({ r: [{ k: "a", v: 1 }, { k: "a", v: 2 }] }, { r: ["k"] }).toString("utf8");
  assert.equal(forward, reversed);
});

test("FEAT-003: duplicate object keys are rejected at parse time", () => {
  assert.throws(() => parseStrict("a: 1\na: 2\n"), CanonicalizationError);
  assert.throws(() => parseStrict('{"a":1,"a":2}'), CanonicalizationError);
  assert.deepEqual(parseStrict('{"a":1}'), { a: 1 });
});

test("FEAT-003: non-I-JSON numbers fail closed", () => {
  assert.throws(() => canonicalBytes({ n: Number.NaN }), CanonicalizationError);
  assert.throws(() => canonicalBytes({ n: Number.POSITIVE_INFINITY }), CanonicalizationError);
  assert.throws(() => canonicalBytes({ n: 9007199254740993 }), CanonicalizationError);
});

test("FEAT-003: set-like arrays sort by schema keys; ordered arrays preserve order", () => {
  const sorted = canonicalBytes(
    { r: [{ k: "b" }, { k: "a" }] },
    { r: ["k"] }
  ).toString("utf8");
  assert.match(sorted, /"a".*"b"/s);
  const ordered = canonicalBytes({ steps: ["b", "a"] }).toString("utf8");
  assert.match(ordered, /"b","a"/);
});

test("FEAT-003: content hash excludes aliases, timestamps, and ungoverned unknown fields", () => {
  const schema = { "x-rdlc-governed": ["title"], "x-rdlc-set-keys": {} };
  const a = contentHash({ schema_version: "s/v1", id: "x", title: "T", display_id: "A-1", extra: 1 }, schema);
  const b = contentHash({ schema_version: "s/v1", id: "x", title: "T", display_id: "B-9", extra: 2 }, schema);
  const c = contentHash({ schema_version: "s/v1", id: "x", title: "Changed" }, schema);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
  assert.equal(a.hash_profile, HASH_PROFILE_VERSION);
  assert.equal(a.schema_version, "s/v1");
});

test("FEAT-003: content hash fails closed without governed schema declarations", () => {
  assert.throws(() => contentHash({ schema_version: "s/v1", id: "x" }, {}), CanonicalizationError);
  assert.throws(() => contentHash({ id: "x" }, { "x-rdlc-governed": ["title"] }), CanonicalizationError);
  assert.throws(
    () => contentHash({ schema_version: "s/v1", id: "x" }, { "x-rdlc-governed": ["display_id"] }),
    CanonicalizationError
  );
});

test("FEAT-003: approval package hash excludes decisions and requires core inputs", () => {
  const pkg = {
    artifact_hashes: ["sha256:" + "a".repeat(64)],
    policy_versions: ["approval-policy/v1"],
    required_approvers: [{ principal: "urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012", role: "product-owner" }]
  };
  const first = approvalPackageHash(pkg);
  assert.equal(first.profile, "approval_package_hash");
  assert.throws(() => approvalPackageHash({ ...pkg, decisions: [] }), CanonicalizationError);
  assert.throws(() => approvalPackageHash({ ...pkg, artifact_hashes: [] }), CanonicalizationError);
});

test("FEAT-003: baseline root and redaction addendum hashes are stable and fail closed", () => {
  const manifest = {
    approval_package_hashes: ["sha256:" + "b".repeat(64)],
    artifact_hashes: ["sha256:" + "a".repeat(64)],
    metadata: { baseline: "BL-1" }
  };
  const root = baselineRootHash(manifest);
  assert.equal(root.hash, baselineRootHash({ ...manifest }).hash);
  assert.throws(() => baselineRootHash({ artifact_hashes: [] }), CanonicalizationError);

  const addendum = {
    original_baseline_root: root.hash,
    tombstones: [{ artifact: "urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10", original_hash: "sha256:" + "c".repeat(64) }],
    authority: "privacy-office",
    storage_boundary: "repository",
    availability_state: "non-reconstructable"
  };
  const addendumHash = redactionAddendumHash(addendum);
  assert.equal(addendumHash.profile, "redaction_addendum_hash");
  assert.throws(() => redactionAddendumHash({ ...addendum, tombstones: [] }), CanonicalizationError);
});

test("FEAT-003: readback hash covers only mapped fields under a mapping version", () => {
  const mapping = { version: "jira-commerce/v3", fields: ["summary", "status"] };
  const a = readbackHash({ summary: "S", status: "To Do", unmapped: "x" }, mapping);
  const b = readbackHash({ summary: "S", status: "To Do", unmapped: "y" }, mapping);
  const c = readbackHash({ summary: "S", status: "Done" }, mapping);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
  assert.equal(a.mapping_version, "jira-commerce/v3");
  assert.throws(() => readbackHash({}, { fields: [] }), CanonicalizationError);
});

test("FEAT-003: hashes are lowercase sha256:<64 hex> with profile versions attached", () => {
  const record = sourceHash(Buffer.from("evidence"));
  assert.match(record.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.hash_profile, HASH_PROFILE_VERSION);
});
