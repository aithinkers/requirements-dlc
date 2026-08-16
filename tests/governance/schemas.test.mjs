import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import YAML from "yaml";

import { createValidator, schemaFiles, validateRecord } from "../../core/schemas/v0.2/index.mjs";

const ajv = await createValidator();

async function loadFixture(name) {
  return YAML.parse(await readFile(`fixtures/spec-examples/${name}`, "utf8"));
}

test("FEAT-002: every specification example fixture validates against its schema", async () => {
  const entries = (await readdir("fixtures/spec-examples")).filter((name) => name.endsWith(".yaml"));
  assert.ok(entries.length >= 9, "all nine spec-example fixtures are present");
  for (const name of entries) {
    const record = await loadFixture(name);
    const { valid, failures } = await validateRecord(record, ajv);
    assert.ok(valid, `${name}: ${failures.join("; ")}`);
  }
});

test("FEAT-002: every declared schema_version resolves to a registered schema", async () => {
  for (const [version, file] of Object.entries(schemaFiles)) {
    assert.ok(ajv.getSchema(`https://rdlc.dev/schemas/v0.2/${file}`), `${version} -> ${file}`);
  }
});

test("FEAT-002: unknown schema_version fails closed", async () => {
  const { valid, failures } = await validateRecord({ schema_version: "rdlc.artifact/v9.9" }, ajv);
  assert.equal(valid, false);
  assert.match(failures[0], /unknown or missing schema_version/);
});

test("FEAT-002: envelope rejects missing canonical identity", async () => {
  const record = await loadFixture("artifact.yaml");
  delete record.id;
  const { valid } = await validateRecord(record, ajv);
  assert.equal(valid, false);
});

test("FEAT-002: envelope rejects a non-v7 or malformed UUID URN", async () => {
  const record = await loadFixture("artifact.yaml");
  for (const bad of [
    "urn:uuid:0198b7e0-6a2f-4b41-8d3e-2f7c9a6b4d10",
    "urn:uuid:not-a-uuid",
    "0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10"
  ]) {
    const { valid } = await validateRecord({ ...record, id: bad }, ajv);
    assert.equal(valid, false, `must reject id ${bad}`);
  }
});

test("FEAT-002: envelope rejects an unknown governance state", async () => {
  const record = await loadFixture("artifact.yaml");
  const { valid } = await validateRecord({ ...record, governance_state: "published" }, ajv);
  assert.equal(valid, false);
});

test("FEAT-002: relationship targets must be UUID URNs, never display aliases", async () => {
  const record = await loadFixture("artifact.yaml");
  record.relationships = [{ type: "derives-from", target: "REQ-103" }];
  const { valid } = await validateRecord(record, ajv);
  assert.equal(valid, false);
});

test("FEAT-002: relationship type outside §13 is rejected", async () => {
  const record = await loadFixture("artifact.yaml");
  record.relationships = [
    { type: "related-to", target: "urn:uuid:0198b7d0-5b1e-7a30-9c2d-1e6b8f5a3c09" }
  ];
  const { valid } = await validateRecord(record, ajv);
  assert.equal(valid, false);
});

test("FEAT-002: source snapshot requires provider revision identity", async () => {
  const jira = await loadFixture("source-snapshot-jira.yaml");
  delete jira.revision;
  assert.equal((await validateRecord(jira, ajv)).valid, false);

  const confluence = await loadFixture("source-snapshot-confluence.yaml");
  delete confluence.page_version;
  assert.equal((await validateRecord(confluence, ajv)).valid, false);
});

test("FEAT-002: hash fields require lowercase sha256:<64 hex>", async () => {
  const record = await loadFixture("source-snapshot-jira.yaml");
  for (const bad of ["sha256:...", "sha256:ABC", "md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]) {
    assert.equal((await validateRecord({ ...record, source_hash: bad }, ajv)).valid, false, bad);
  }
});

test("FEAT-002: principal binding requires verification fields; unverified match is not a binding", async () => {
  const record = await loadFixture("principal.yaml");
  delete record.bindings[0].verified_via;
  assert.equal((await validateRecord(record, ajv)).valid, false);
});

test("FEAT-002: changeset create operations require artifact, target, and idempotency key", async () => {
  const record = await loadFixture("changeset.yaml");
  delete record.operations[0].idempotency_key;
  assert.equal((await validateRecord(record, ajv)).valid, false);
});

test("FEAT-002: lease requires an authority, expiry, and known purpose", async () => {
  const record = await loadFixture("lease.yaml");
  assert.equal((await validateRecord({ ...record, purpose: "anything" }, ajv)).valid, false);
  const noExpiry = await loadFixture("lease.yaml");
  delete noExpiry.expires_at;
  assert.equal((await validateRecord(noExpiry, ajv)).valid, false);
});

test("FEAT-002: project manifest requires declared authority mode and rejects unknown modes", async () => {
  const record = await loadFixture("project.yaml");
  record.project.authority_mode = "database-authoritative";
  assert.equal((await validateRecord(record, ajv)).valid, false);
});

test("FEAT-002: work claim scope must not be empty", async () => {
  const record = await loadFixture("work-claim.yaml");
  record.scope = {};
  assert.equal((await validateRecord(record, ajv)).valid, false);
});

test("FEAT-002: changeset link target must be a UUID URN, not a display alias", async () => {
  const record = await loadFixture("changeset.yaml");
  record.operations[1].target = "COM-104";
  assert.equal((await validateRecord(record, ajv)).valid, false);
});
