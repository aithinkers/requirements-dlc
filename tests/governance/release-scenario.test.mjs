/**
 * REL-001 — the §46 definition-of-done scenario, executed end to end from a
 * clean checkout over the implemented release-0.1 slices. Steps that §45.1
 * defers (K-DLC, test generation, regulated signatures) are absent by design.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CAPABILITIES, JiraConnector, recordedTransport } from "../../core/connectors/jira/index.mjs";
import {
  IdentityRegistry, applyRedaction, buildApprovalPackage, createBaseline, createTombstone,
  evaluatePolicy, readinessCheck, recordDecision
} from "../../core/lib/approval.mjs";
import { LeaseAuthority, createClaim, detectClaimOverlaps, recordCollisionDecision, sharedWrite } from "../../core/lib/collaboration.mjs";
import { checkpoint, createEngagement, loadEngagement, recordApplyResults } from "../../core/lib/engagement.mjs";
import { InMemoryCasBackend, mintIdentity } from "../../core/lib/identity.mjs";
import { intake } from "../../core/lib/intake/index.mjs";
import { contentHash } from "../../core/lib/canonical.mjs";
import { createRevision, isMaterialChange, transitionGovernance } from "../../core/lib/lifecycle.mjs";
import { createCapture, promote, promotionReview, triage } from "../../core/lib/promotion.mjs";

const H = (c) => "sha256:" + c.repeat(64);
const now = "2026-08-15T23:30:00.000Z";
const context = (actor, extra = {}) => ({ actor, actorKind: "human", reason: "§46 scenario", policyVersion: "materiality/v1", contentHash: H("a"), at: now, ...extra });

test("REL-001: the §46 scenario runs end to end on the implemented slices", async () => {
  /* 1–2. Greenfield start from a scope document with anchored evidence. */
  const alexId = mintIdentity();
  const samId = mintIdentity();
  const scopeBytes = await readFile("fixtures/intake/scope.md");
  const evidence = await intake({ bytes: scopeBytes, name: "scope.md" });
  assert.ok(evidence.fragments.length > 0);
  assert.ok(evidence.coverage.description, "skipped/partial content is reported");

  const directory = await mkdtemp(join(tmpdir(), "rdlc-e2e-"));
  let state = createEngagement({ project: "checkout", space: "commerce", scope: "standard", host: "claude-code", session: "e2e", actor: alexId, at: now });
  await checkpoint(state, directory, { at: now });

  /* 3. Capture -> triage -> promoted traceable requirement. */
  const capture = createCapture({ text: evidence.fragments[0].text, provenance: { project: "checkout", sources: ["external://file/scope.md"] }, actor: alexId, at: now });
  const { artifact: triaged } = triage(capture, { type: "functional-requirement" }, context(alexId));
  const { artifact: working } = transitionGovernance(triaged, "working", context(alexId));
  const requirement = { ...working, version: 1, statement: "The checkout service shall preserve an incomplete checkout.", acceptance_criteria: ["c-persist", "c-expire"] };
  const cleanReview = promotionReview({ working: requirement, shared: { artifacts: [] } });
  const promoted = promote({ working: requirement, capture, review: cleanReview, shared: { artifacts: [] } }, context(alexId));
  assert.equal(promoted.artifact.governance_state, "draft");
  assert.ok(Object.isFrozen(promoted.capture), "original capture preserved");

  /* 4. Synthetic Jira company-managed discovery. */
  const fixture = JSON.parse(await readFile("fixtures/jira/synthetic-project.json", "utf8"));
  const mapping = { version: "jira-com/v1", projectKey: "COM", fields: ["summary", "status"] };
  const discovery = new JiraConnector({
    transport: recordedTransport([
      { method: "GET", path: "/rest/api/3/issue/createmeta?projectKeys=COM&expand=projects.issuetypes.fields", response: { status: 200, body: fixture.createmeta } },
      { method: "GET", path: "/rest/api/3/myself", response: { status: 200, body: fixture.myself } }
    ]),
    mapping
  });
  const schema = await discovery.discoverSchema();
  const account = await discovery.discoverPermissions();
  assert.ok(schema.issue_types.some((type) => type.name === "Readiness Review"));
  assert.equal(account.account_id, "acc-alex-immutable");
  assert.ok(CAPABILITIES.deferred.length > 0, "proposals and deferrals are declared, not silently claimed");

  /* 6. Two BAs overlap; claims reveal it; the lease serializes the mutation. */
  const claims = [
    createClaim({ actor: alexId, workstream: "ws-alex", scope: { requirements: [promoted.artifact.id] }, intent: "recovery stories", createdAt: now, expiresAt: "2026-08-16T23:30:00.000Z" }),
    createClaim({ actor: samId, workstream: "ws-sam", scope: { requirements: [promoted.artifact.id] }, intent: "expiry stories", createdAt: now, expiresAt: "2026-08-16T23:30:00.000Z" })
  ];
  const overlaps = detectClaimOverlaps(claims, { now });
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].blocking, false);

  const lease = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => 1000 });
  const attempts = await Promise.all([alexId, samId].map((principal) =>
    lease.acquire({ resource: "alias-authority://commerce/story", purpose: "allocate-display-aliases", holder: { principal }, ttlMs: 5000 })
  ));
  assert.equal(attempts.filter((attempt) => attempt.acquired).length, 1, "concurrent alias mutation serialized by the lease");

  const stale = sharedWrite({
    base: { version: 1, statement: "old" },
    current: { version: 2, statement: "changed by the other BA" },
    proposed: { version: 1, statement: "my change" }
  });
  assert.equal(stale.applied, false, "optimistic precondition stops the stale write");

  /* 7. Audited human collision disposition. */
  const decision = recordCollisionDecision({
    collisionType: "partial-overlap",
    comparedRevisions: [{ artifact: promoted.artifact.id, version: 1 }, { artifact: mintIdentity(), version: 1 }],
    participants: [alexId, samId],
    rationale: "Scope partitioned: recovery vs expiration criteria.",
    outcome: "partition-scope",
    at: now
  });
  assert.equal(decision.outcome, "partition-scope");

  /* 8. Verified Jira identities satisfy readiness against the exact package hash. */
  const registry = new IdentityRegistry();
  const alex = registry.registerPrincipal({ id: alexId, displayName: "Alex Morgan", kind: "human", roles: ["product-owner"] });
  registry.addBinding(alex.id, { provider: "jira", connection: "delivery-jira", accountId: "acc-alex-immutable", verifiedVia: "authenticated-self-binding", verifiedBy: alex.id, verifiedAt: now });

  const artifactHash = contentHash(
    { ...promoted.artifact, schema_version: "rdlc.artifact/v0.2" },
    { "x-rdlc-governed": ["title", "statement"], "x-rdlc-set-keys": {} }
  );
  const opened = buildApprovalPackage({
    artifactHashes: [artifactHash.hash],
    sourceLocks: [{ id: "scope.md", hash: evidence.source.hash }],
    policyVersions: ["approval/v1"],
    requiredApprovers: [{ principal: alex.id, role: "product-owner" }]
  });
  const ready = readinessCheck({
    templatesPass: true, evidenceLinks: ["external://file/scope.md"],
    approverSet: [alex.id], registry, reproduciblePackage: true
  });
  assert.equal(ready.ready, true);

  // Wrong account and stale hash are rejected (§46 step 8).
  assert.throws(() => recordDecision(registry, { provider: "jira", connection: "delivery-jira", accountId: "acc-wrong", decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash, role: "product-owner", authenticationContext: "ctx", at: now }));
  assert.throws(() => recordDecision(registry, { provider: "jira", connection: "delivery-jira", accountId: "acc-alex-immutable", decision: "approve", packageHash: H("f"), expectedPackageHash: opened.package_hash, role: "product-owner", authenticationContext: "ctx", at: now }));
  const approval = recordDecision(registry, { provider: "jira", connection: "delivery-jira", accountId: "acc-alex-immutable", decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash, role: "product-owner", authenticationContext: "oauth", at: now });
  assert.equal(evaluatePolicy({ kind: "all-required", required: [alex.id] }, [approval], { packageHash: opened.package_hash, registry }).satisfied, true);

  /* 9. Basic-integrity baseline with reproducible hashes. */
  const baseline = createBaseline({ packages: [opened], artifactHashes: [artifactHash.hash], sourceLocks: [{ id: "scope.md", hash: evidence.source.hash }], metadata: { title: "BL-1" } });
  const again = createBaseline({ packages: [opened], artifactHashes: [artifactHash.hash], sourceLocks: [{ id: "scope.md", hash: evidence.source.hash }], metadata: { title: "BL-1" } });
  assert.equal(baseline.baseline_root_hash, again.baseline_root_hash, "independent reproduction");

  /* 10–11. Bounded changeset with receipts; interruption resumes without duplication. */
  const created = { id: "20301", key: "COM-301", fields: { summary: "Preserve an incomplete checkout", status: { name: "To Do" }, updated: "2026-08-15T23:31:00.000+0000" }, properties: { "rdlc.operation": { key: "rdlc:e2e-1" } } };
  const jira = new JiraConnector({
    transport: recordedTransport([
      { method: "GET", path: `/rest/api/3/search?jql=${encodeURIComponent("project = COM")}&properties=rdlc.operation&startAt=0`, response: { status: 200, body: { issues: [], total: 0 } } },
      { method: "POST", path: "/rest/api/3/issue", response: { status: 201, body: { id: "20301", key: "COM-301" } } },
      { method: "GET", path: "/rest/api/3/issue/COM-301?expand=changelog", response: { status: 200, body: created } }
    ]),
    mapping, writeMode: "approve-each-batch", now: () => now
  });
  const changeset = { id: mintIdentity(), connection: "delivery-jira", operations: [{ operation_id: "op-001", action: "create", target: { work_type: "Story" }, artifact: promoted.artifact.id, fields: { summary: "Preserve an incomplete checkout", status: { name: "To Do" } }, idempotency_key: "rdlc:e2e-1" }] };
  const applied = await jira.applyChangeset(changeset, { approval: { status: "approved" }, actor: alex.id });
  assert.equal(applied.applied, true);
  assert.match(applied.receipts[0].readback_hash, /^sha256:/);

  state = recordApplyResults(state, changeset.id, applied.results, { actor: alex.id, at: now });
  await checkpoint(state, directory, { at: now });
  const resumed = await loadEngagement(directory);
  assert.equal(resumed.verified, true);
  assert.ok(resumed.state.verified_operations[changeset.id]["op-001"], "resume never duplicates verified writes");

  // Uncertain retry reconciles by idempotency identity instead of duplicating.
  const reconcile = new JiraConnector({
    transport: recordedTransport([
      { method: "GET", path: `/rest/api/3/search?jql=${encodeURIComponent("project = COM")}&properties=rdlc.operation&startAt=0`, response: { status: 200, body: { issues: [created], total: 1 } } },
      { method: "GET", path: "/rest/api/3/issue/COM-301?expand=changelog", response: { status: 200, body: created } }
    ]),
    mapping, writeMode: "approve-each-batch", now: () => now
  });
  const retried = await reconcile.applyChangeset(changeset, { approval: { status: "approved" }, actor: alex.id });
  assert.equal(retried.receipts[0].result, "reconciled-existing");

  /* 12. A material change creates a new revision and invalidates the approval. */
  const baselined = { ...promoted.artifact, governance_state: "baselined", version: 1 };
  assert.equal(isMaterialChange({ changedFields: ["statement"] }).material, true);
  const revision = createRevision(baselined, {
    changedFields: ["statement"],
    approvals: [{ artifact: baselined.id, status: "current", package_hash: opened.package_hash }]
  }, context(alex.id));
  assert.equal(revision.revision.version, 2);
  assert.equal(revision.approvals[0].status, "invalidated");
  assert.equal(revision.priorRevision.governance_state, "baselined", "old baseline never rewritten");

  /* 13. Authorized redaction preserves tombstone evidence, marks non-reconstructable. */
  const tombstone = createTombstone({
    artifact: baselined.id, originalContentHash: artifactHash.hash,
    affectedPackage: opened.package_hash, affectedBaseline: baseline.baseline_root_hash,
    actor: alex.id, authority: "privacy-office", scope: "statement", reasonCode: "erasure", decisionAt: now
  });
  const redacted = applyRedaction(baseline, { tombstones: [tombstone], authority: "privacy-office", storageBoundary: "repository", nonReconstructable: true });
  assert.equal(redacted.projected_state, "non-reconstructable");
  assert.equal(redacted.baseline.baseline_root_hash, baseline.baseline_root_hash);
});

test("REL-001: the conformance statement claims exactly the implemented 0.1 profiles and never Full", async () => {
  const statement = JSON.parse(await readFile("distribution/release/conformance-statement.json", "utf8"));
  assert.equal(statement.specification, "rdlc");
  assert.equal(statement.specification_version, "0.2.0");
  assert.ok(!statement.modules.includes("Full"));
  for (const module_ of ["Core", "Governed-Basic"]) assert.ok(statement.modules.includes(module_), module_);
  assert.ok(statement.connectors.includes("Connected:Jira-Cloud-Company-Managed"));
  assert.ok(statement.harnesses.includes("Harness:Claude-Code"));
  assert.ok(Array.isArray(statement.exceptions) && statement.exceptions.length > 0, "gaps are declared, not hidden");
  assert.equal(statement.release_candidate, false, "no release claim before the full §46 tagged-build evidence");
});
