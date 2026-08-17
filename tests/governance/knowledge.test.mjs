import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApprovalPackage, createBaseline } from "../../core/lib/approval.mjs";
import {
  KnowledgeError,
  createKnowledgeLock,
  diffKnowledgeLock,
  isKbReference,
  knowledgeImpact,
  loadKnowledgeProject,
  parseKbReference,
  resolveKbReference,
  verifyKnowledgeLock
} from "../../core/lib/knowledge.mjs";

const CATALOG = "kdlc-retrieval-catalog-1";

async function groundedProject({ concepts }) {
  const root = await mkdtemp(join(tmpdir(), "rdlc-kb-"));
  await writeFile(join(root, "knowledge-project.yaml"), [
    "api_version: kdlc.dev/v1alpha1",
    "kind: Project",
    "knowledge_bases:",
    "  - name: product",
    "    uri: ./knowledge/product",
    "    mode: consume",
    "    role: dependency",
    ""
  ].join("\n"));
  await mkdir(join(root, "knowledge/product"), { recursive: true });
  await writeFile(
    join(root, "knowledge/product/retrieval-catalog.json"),
    JSON.stringify({ version: CATALOG, concepts })
  );
  return root;
}

const CONCEPT = {
  id: "concepts/research/interrupted-checkout",
  path: "concepts/research/interrupted-checkout.md",
  byte_hash: "sha256:" + "a".repeat(64),
  access: { classification: "internal" }
};

test("FEAT-023: kb:// references parse strictly and resolve against mounted catalogs with access fail-closed (§17.3, §17.5)", async () => {
  const root = await groundedProject({ concepts: [CONCEPT] });
  const project = await loadKnowledgeProject(root);
  assert.equal(project.mounts.length, 1);

  const reference = `kb://product/${CONCEPT.id}`;
  assert.deepEqual(parseKbReference(reference), { knowledge_base: "product", concept_id: CONCEPT.id });
  assert.equal(isKbReference("external://jira/x"), false);
  assert.throws(() => parseKbReference("kb://"), KnowledgeError);

  const resolved = await resolveKbReference(project, reference);
  assert.equal(resolved.byte_hash, CONCEPT.byte_hash);
  assert.equal(resolved.access.classification, "internal");

  // Access is checked when a clearance is supplied, and fails closed.
  await resolveKbReference(project, reference, { allowedClassifications: ["internal", "public"] });
  await assert.rejects(
    resolveKbReference(project, reference, { allowedClassifications: ["public"] }),
    (error) => error.code === "RDLC_KB_ACCESS"
  );
  // Unknown mount and unpublished concept fail closed.
  await assert.rejects(resolveKbReference(project, "kb://other/x"), (error) => error.code === "RDLC_KB_UNMOUNTED");
  await assert.rejects(resolveKbReference(project, "kb://product/ghost"), (error) => error.code === "RDLC_KB_UNRESOLVED");
  await rm(root, { recursive: true, force: true });
});

test("FEAT-023: mount paths are confined to the project root (§7.2)", async () => {
  const root = await mkdtemp(join(tmpdir(), "rdlc-kb-escape-"));
  await writeFile(join(root, "knowledge-project.yaml"), [
    "kind: Project",
    "knowledge_bases:",
    "  - name: evil",
    "    uri: ../../outside",
    ""
  ].join("\n"));
  await assert.rejects(loadKnowledgeProject(root), (error) => error.code === "RDLC_KB_PATH");
  await rm(root, { recursive: true, force: true });
});

test("FEAT-023: the knowledge lock is deterministic, digest-bound, and tamper-evident (§17.1, §17.4)", async () => {
  const root = await groundedProject({ concepts: [CONCEPT] });
  const project = await loadKnowledgeProject(root);
  const lock = await createKnowledgeLock(project, { lockedAt: "2026-08-16T12:00:00Z" });
  const again = await createKnowledgeLock(project, { lockedAt: "2026-08-16T12:00:00Z" });
  assert.equal(lock.lock_digest, again.lock_digest, "identical knowledge yields an identical digest");
  assert.equal(verifyKnowledgeLock(lock), true);
  const tampered = JSON.parse(JSON.stringify(lock));
  tampered.mounts[0].concepts[0].byte_hash = "sha256:" + "b".repeat(64);
  assert.throws(() => verifyKnowledgeLock(tampered), (error) => error.code === "RDLC_KB_LOCK");

  // The digest rides in approval packages and baselines (§17.4).
  const pkg = buildApprovalPackage({
    artifactHashes: ["sha256:" + "c".repeat(64)],
    kbLock: lock.lock_digest,
    policyVersions: [{ policy: "review", version: "v1" }],
    requiredApprovers: ["role:product-owner"]
  });
  assert.equal(pkg.kb_lock, lock.lock_digest);
  const baseline = createBaseline({
    packages: [pkg],
    artifactHashes: ["sha256:" + "c".repeat(64)],
    sourceLocks: [{ id: "knowledge.lock", hash: lock.lock_digest }]
  });
  assert.equal(baseline.source_locks[0].hash, lock.lock_digest);
  await rm(root, { recursive: true, force: true });
});

test("FEAT-023: catalog drift after locking surfaces as explicit changes and impact-review candidates, never rewrites (§17.7, §17.8)", async () => {
  const removed = { ...CONCEPT, id: "concepts/policies/retention", path: "concepts/policies/retention.md" };
  const root = await groundedProject({ concepts: [CONCEPT, removed] });
  const project = await loadKnowledgeProject(root);
  const lock = await createKnowledgeLock(project, { lockedAt: "2026-08-16T12:00:00Z" });
  assert.deepEqual(await diffKnowledgeLock(project, lock), [], "no drift right after locking");

  // The KB moves: one concept changes, one disappears, one appears.
  await writeFile(join(root, "knowledge/product/retrieval-catalog.json"), JSON.stringify({
    version: CATALOG,
    concepts: [
      { ...CONCEPT, byte_hash: "sha256:" + "d".repeat(64) },
      { id: "concepts/new/arrival", path: "concepts/new/arrival.md", byte_hash: "sha256:" + "e".repeat(64), access: { classification: "internal" } }
    ]
  }));
  const changes = await diffKnowledgeLock(project, lock);
  assert.deepEqual(changes.map(({ concept_id, kind }) => ({ concept_id, kind })).sort((a, b) => (a.concept_id < b.concept_id ? -1 : 1)), [
    { concept_id: "concepts/new/arrival", kind: "added" },
    { concept_id: "concepts/policies/retention", kind: "removed" },
    { concept_id: "concepts/research/interrupted-checkout", kind: "changed" }
  ]);

  const artifacts = Object.freeze([
    Object.freeze({
      id: "urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10",
      display_id: "REQ-104",
      sources: Object.freeze([`kb://product/${CONCEPT.id}`, "external://jira/commerce/DISC-42"])
    }),
    Object.freeze({
      id: "urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d11",
      display_id: "REQ-105",
      sources: Object.freeze(["kb://product/concepts/policies/retention"])
    }),
    Object.freeze({ id: "urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d12", sources: Object.freeze(["user-capture://c1"]) })
  ]);
  const candidates = knowledgeImpact({ changes, artifacts });
  assert.equal(candidates.length, 2, "only artifacts citing moved concepts get candidates; additions raise none");
  const changed = candidates.find(({ artifact_display_id }) => artifact_display_id === "REQ-104");
  assert.equal(changed.rule, "RDLC-KB-001");
  assert.equal(changed.severity, "warning");
  assert.match(changed.message, /changed since the knowledge lock/);
  const gone = candidates.find(({ artifact_display_id }) => artifact_display_id === "REQ-105");
  assert.equal(gone.rule, "RDLC-KB-002");
  assert.equal(gone.severity, "blocking");
  for (const candidate of candidates) {
    assert.equal(candidate.schema_version, "rdlc.finding/v0.2");
    assert.equal(candidate.status, "open");
    assert.match(candidate.id, /^urn:uuid:/);
  }
  await rm(root, { recursive: true, force: true });
});
