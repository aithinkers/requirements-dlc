import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalError,
  IdentityRegistry,
  verifyDecision,
  applyRedaction,
  buildApprovalPackage,
  createBaseline,
  createTombstone,
  evaluatePolicy,
  readinessCheck,
  recordDecision
} from "../../core/lib/approval.mjs";
import { mintIdentity } from "../../core/lib/identity.mjs";

const H = (c) => "sha256:" + c.repeat(64);

function registryWith() {
  const registry = new IdentityRegistry();
  const alex = registry.registerPrincipal({ displayName: "Alex Morgan", kind: "human", roles: ["product-owner"] });
  const sam = registry.registerPrincipal({ displayName: "Sam Lee", kind: "human", roles: ["compliance"] });
  const bot = registry.registerPrincipal({ displayName: "Release Bot", kind: "automation" });
  registry.addBinding(alex.id, { provider: "jira", connection: "delivery-jira", tenantId: "t1", accountId: "acc-alex", verifiedVia: "authenticated-self-binding", verifiedBy: alex.id, verifiedAt: "2026-08-15T17:40:00.000Z" });
  registry.addBinding(sam.id, { provider: "jira", connection: "delivery-jira", tenantId: "t1", accountId: "acc-sam", verifiedVia: "administrator-attestation", verifiedBy: alex.id, verifiedAt: "2026-08-15T17:41:00.000Z" });
  registry.addBinding(bot.id, { provider: "jira", connection: "delivery-jira", tenantId: "t1", accountId: "acc-bot", verifiedVia: "administrator-attestation", verifiedBy: alex.id, verifiedAt: "2026-08-15T17:42:00.000Z" });
  return { registry, alex, sam, bot };
}

function pkg() {
  return buildApprovalPackage({
    artifactHashes: [H("a")],
    policyVersions: ["approval/v1"],
    requiredApprovers: [{ principal: mintIdentity(), role: "product-owner" }]
  });
}

test("FEAT-009: bindings require accepted verification methods; manual matches are unverified (§27.2)", () => {
  const registry = new IdentityRegistry();
  const p = registry.registerPrincipal({ displayName: "X", kind: "human" });
  assert.throws(
    () => registry.addBinding(p.id, { provider: "jira", connection: "c", accountId: "a", verifiedVia: "email-match", verifiedBy: p.id, verifiedAt: "t" }),
    /unaccepted verification method/
  );
  assert.throws(() => registry.addBinding(p.id, { provider: "jira", connection: "c", accountId: "", verifiedVia: "authenticated-self-binding", verifiedBy: p.id, verifiedAt: "t" }), ApprovalError);
});

test("FEAT-009: approval packages are immutable and reproducible (§27.4)", () => {
  const a = pkg();
  assert.ok(Object.isFrozen(a));
  assert.match(a.package_hash, /^sha256:[0-9a-f]{64}$/);
  const b = buildApprovalPackage({
    artifactHashes: a.artifact_hashes,
    policyVersions: a.policy_versions,
    requiredApprovers: a.required_approvers
  });
  assert.equal(a.package_hash, b.package_hash, "same content reproduces the same hash");
});

test("FEAT-009: decisions bind principal, verified binding, and exact package hash (§27.4)", () => {
  const { registry, alex } = registryWith();
  const opened = pkg();
  const decision = recordDecision(registry, {
    provider: "jira", connection: "delivery-jira", accountId: "acc-alex",
    decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
    role: "product-owner", authenticationContext: "oauth-session-913", at: "2026-08-15T18:00:00.000Z"
  });
  assert.equal(decision.principal, alex.id);
  assert.equal(decision.package_hash, opened.package_hash);
  assert.match(decision.decision_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(decision));
});

test("FEAT-009: a stale hash or unknown account is rejected (§27.6, §46 step 8)", () => {
  const { registry } = registryWith();
  const opened = pkg();
  assert.throws(
    () => recordDecision(registry, {
      provider: "jira", connection: "delivery-jira", accountId: "acc-alex",
      decision: "approve", packageHash: H("f"), expectedPackageHash: opened.package_hash,
      role: "product-owner", authenticationContext: "ctx", at: "t"
    }),
    /does not match the open approval package/
  );
  assert.throws(
    () => recordDecision(registry, {
      provider: "jira", connection: "delivery-jira", accountId: "acc-wrong",
      decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
      role: "product-owner", authenticationContext: "ctx", at: "t"
    }),
    /no verified binding resolves/
  );
});

test("FEAT-009: a revoked binding prevents future decisions but keeps history (§27.2)", () => {
  const { registry } = registryWith();
  const opened = pkg();
  const first = recordDecision(registry, {
    provider: "jira", connection: "delivery-jira", accountId: "acc-sam",
    decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
    role: "compliance", authenticationContext: "ctx", at: "t1"
  });
  registry.revokeBinding(first.principal, "acc-sam", { at: "t2" });
  assert.throws(
    () => recordDecision(registry, {
      provider: "jira", connection: "delivery-jira", accountId: "acc-sam",
      decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
      role: "compliance", authenticationContext: "ctx", at: "t3"
    }),
    /no verified binding/
  );
  assert.equal(first.decision, "approve", "historical evidence retained");
});

test("FEAT-009: policies — all-required, n-of-m, one-per-role; declines block (§27.3)", () => {
  const { registry, alex, sam } = registryWith();
  const opened = pkg();
  const decide = (accountId, role, decision = "approve") => recordDecision(registry, {
    provider: "jira", connection: "delivery-jira", accountId,
    decision, packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
    role, authenticationContext: "ctx", at: "t"
  });
  const a = decide("acc-alex", "product-owner");
  const s = decide("acc-sam", "compliance");

  assert.equal(evaluatePolicy({ kind: "all-required", required: [alex.id, sam.id] }, [a, s], { packageHash: opened.package_hash, registry }).satisfied, true);
  assert.equal(evaluatePolicy({ kind: "all-required", required: [alex.id, sam.id] }, [a], { packageHash: opened.package_hash, registry }).satisfied, false);
  assert.equal(evaluatePolicy({ kind: "n-of-m", eligible: [alex.id, sam.id], quorum: 1 }, [a], { packageHash: opened.package_hash, registry }).satisfied, true);
  assert.equal(evaluatePolicy({ kind: "one-per-role", roles: ["product-owner", "compliance"] }, [a, s], { packageHash: opened.package_hash, registry }).satisfied, true);
  assert.equal(evaluatePolicy({ kind: "one-per-role", roles: ["product-owner", "compliance"] }, [a], { packageHash: opened.package_hash, registry }).satisfied, false);

  const decline = decide("acc-sam", "compliance", "reject");
  const declined = evaluatePolicy({ kind: "all-required", required: [alex.id, sam.id] }, [a, decline], { packageHash: opened.package_hash, registry });
  assert.equal(declined.satisfied, false);
  assert.match(declined.reason, /declined/);
});

test("FEAT-009: an automation principal never satisfies a human role (§27.2)", () => {
  const { registry } = registryWith();
  const opened = pkg();
  const bot = recordDecision(registry, {
    provider: "jira", connection: "delivery-jira", accountId: "acc-bot",
    decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
    role: "product-owner", authenticationContext: "ctx", at: "t"
  });
  assert.throws(
    () => evaluatePolicy({ kind: "one-per-role", roles: ["product-owner"] }, [bot], { packageHash: opened.package_hash, registry }),
    /non-human principal cannot satisfy human role/
  );
  // Explicitly authorized deterministic roles are permitted (§27.2).
  const botCheck = recordDecision(registry, {
    provider: "jira", connection: "delivery-jira", accountId: "acc-bot",
    decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
    role: "release-check", authenticationContext: "ctx", at: "t"
  });
  const allowed = evaluatePolicy(
    { kind: "one-per-role", roles: ["release-check"], automationRoles: ["release-check"] },
    [botCheck],
    { packageHash: opened.package_hash, registry }
  );
  assert.equal(allowed.satisfied, true);
});

test("FEAT-009: readiness requires verified approvers, evidence, and a reproducible package (§27.5)", () => {
  const { registry, alex } = registryWith();
  const stranger = mintIdentity();
  const bad = readinessCheck({
    templatesPass: false,
    blockingFindings: [{ id: "F-1" }],
    evidenceLinks: [],
    dependencyCycles: [["a", "b", "a"]],
    approverSet: [alex.id, stranger],
    registry,
    reproduciblePackage: false
  });
  assert.equal(bad.ready, false);
  assert.ok(bad.failures.length >= 5);
  const good = readinessCheck({
    templatesPass: true,
    blockingFindings: [{ id: "F-1" }],
    waivers: [{ finding: "F-1", valid: true }],
    evidenceLinks: ["kb://x"],
    approverSet: [alex.id],
    registry,
    reproduciblePackage: true
  });
  assert.equal(good.ready, true);
});

test("FEAT-009: baselines are immutable and reproduce their root hash", () => {
  const opened = pkg();
  const baseline = createBaseline({
    packages: [opened],
    artifactHashes: [H("a")],
    metadata: { title: "BL-1" }
  });
  assert.ok(Object.isFrozen(baseline));
  assert.match(baseline.baseline_root_hash, /^sha256:[0-9a-f]{64}$/);
  const again = createBaseline({ packages: [opened], artifactHashes: [H("a")], metadata: { title: "BL-1" } });
  assert.equal(baseline.baseline_root_hash, again.baseline_root_hash);
  assert.throws(() => createBaseline({ packages: [], artifactHashes: [H("a")] }), ApprovalError);
});

test("FEAT-009: redaction preserves tombstones and original hashes without rewriting the baseline (§41.1)", () => {
  const opened = pkg();
  const artifact = mintIdentity();
  const baseline = createBaseline({ packages: [opened], artifactHashes: [H("a")] });
  const tombstone = createTombstone({
    artifact,
    originalContentHash: H("c"),
    affectedPackage: opened.package_hash,
    affectedBaseline: baseline.baseline_root_hash,
    actor: mintIdentity(),
    authority: "privacy-office",
    scope: "statement",
    reasonCode: "gdpr-erasure",
    decisionAt: "2026-08-15T22:00:00.000Z"
  });
  assert.equal(tombstone.original_content_hash, H("c"));
  assert.throws(
    () => createTombstone({ artifact, originalContentHash: H("c"), affectedPackage: "p", affectedBaseline: "b", actor: "a", authority: "x", scope: "s", reasonCode: "r", decisionAt: "t", content: "the secret" }),
    /must exclude the content/
  );

  const { addendum, projected_state, baseline: untouched } = applyRedaction(baseline, {
    tombstones: [tombstone],
    authority: "privacy-office",
    storageBoundary: "repository",
    nonReconstructable: true,
    exceptions: ["provider backup retention until 2026-12-01"]
  });
  assert.equal(projected_state, "non-reconstructable");
  assert.equal(untouched.baseline_root_hash, baseline.baseline_root_hash, "original root untouched");
  assert.equal(addendum.original_baseline_root, baseline.baseline_root_hash);
  assert.match(addendum.addendum_hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(addendum.deletion_exceptions, ["provider backup retention until 2026-12-01"]);
  assert.ok(!JSON.stringify(addendum).includes("the secret"));
});

test("FEAT-009: forged or mutated decision records fail integrity verification (review HIGH)", () => {
  const { registry, alex } = registryWith();
  const opened = pkg();
  const forged = { principal: alex.id, principal_kind: "human", decision: "approve", package_hash: opened.package_hash, role: "product-owner" };
  assert.throws(
    () => evaluatePolicy({ kind: "all-required", required: [alex.id] }, [forged], { packageHash: opened.package_hash, registry }),
    /fails integrity verification/
  );
  const real = recordDecision(registry, {
    provider: "jira", connection: "delivery-jira", accountId: "acc-alex",
    decision: "reject", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
    role: "product-owner", authenticationContext: "ctx", at: "t"
  });
  const flipped = { ...real, decision: "approve" };
  assert.throws(
    () => evaluatePolicy({ kind: "all-required", required: [alex.id] }, [flipped], { packageHash: opened.package_hash, registry }),
    /fails integrity verification/
  );
  assert.equal(verifyDecision(real), true);
  assert.equal(verifyDecision(flipped), false);
});

test("FEAT-009: one provider account binds to exactly one principal (review HIGH)", () => {
  const registry = new IdentityRegistry();
  const a = registry.registerPrincipal({ displayName: "A", kind: "human" });
  const b = registry.registerPrincipal({ displayName: "B", kind: "human" });
  registry.addBinding(a.id, { provider: "jira", connection: "c", accountId: "acc-1", verifiedVia: "authenticated-self-binding", verifiedBy: a.id, verifiedAt: "t" });
  assert.throws(
    () => registry.addBinding(b.id, { provider: "jira", connection: "c", accountId: "acc-1", verifiedVia: "administrator-attestation", verifiedBy: a.id, verifiedAt: "t" }),
    /already bound to principal/
  );
  // After revocation the account may be re-bound.
  registry.revokeBinding(a.id, "acc-1", { at: "t2" });
  registry.addBinding(b.id, { provider: "jira", connection: "c", accountId: "acc-1", verifiedVia: "administrator-attestation", verifiedBy: a.id, verifiedAt: "t3" });
});

test("FEAT-009: asserted roles must be held; separation of duties requires distinct principals (review MEDIUM)", () => {
  const { registry } = registryWith();
  const opened = pkg();
  assert.throws(
    () => recordDecision(registry, {
      provider: "jira", connection: "delivery-jira", accountId: "acc-alex",
      decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash,
      role: "compliance", authenticationContext: "ctx", at: "t"
    }),
    /does not hold role/
  );
  // One principal holding both roles cannot satisfy SoD alone.
  const multi = new IdentityRegistry();
  const solo = multi.registerPrincipal({ displayName: "Solo", kind: "human", roles: ["product-owner", "compliance"] });
  multi.addBinding(solo.id, { provider: "jira", connection: "c", accountId: "acc-solo", verifiedVia: "authenticated-self-binding", verifiedBy: solo.id, verifiedAt: "t" });
  const d1 = recordDecision(multi, { provider: "jira", connection: "c", accountId: "acc-solo", decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash, role: "product-owner", authenticationContext: "ctx", at: "t" });
  const d2 = recordDecision(multi, { provider: "jira", connection: "c", accountId: "acc-solo", decision: "approve", packageHash: opened.package_hash, expectedPackageHash: opened.package_hash, role: "compliance", authenticationContext: "ctx", at: "t" });
  const relaxed = evaluatePolicy({ kind: "one-per-role", roles: ["product-owner", "compliance"] }, [d1, d2], { packageHash: opened.package_hash, registry: multi });
  assert.equal(relaxed.satisfied, true, "without SoD one principal may fill both roles");
  const strict = evaluatePolicy({ kind: "one-per-role", roles: ["product-owner", "compliance"], separationOfDuties: true }, [d1, d2], { packageHash: opened.package_hash, registry: multi });
  assert.equal(strict.satisfied, false);
  assert.match(strict.reason, /distinct principals/);
});

test("FEAT-009: redaction addenda bind to their baseline and hash order-stably (review MEDIUM)", () => {
  const opened = pkg();
  const baseline = createBaseline({ packages: [opened], artifactHashes: [H("a")] });
  const other = createBaseline({ packages: [opened], artifactHashes: [H("b")] });
  const mk = (artifact, root) => createTombstone({
    artifact, originalContentHash: H("c"), affectedPackage: opened.package_hash, affectedBaseline: root,
    actor: mintIdentity(), authority: "privacy-office", scope: "s", reasonCode: "r", decisionAt: "t"
  });
  const t1 = mk(mintIdentity(), baseline.baseline_root_hash);
  const t2 = mk(mintIdentity(), baseline.baseline_root_hash);
  const wrong = mk(mintIdentity(), other.baseline_root_hash);
  assert.throws(
    () => applyRedaction(baseline, { tombstones: [wrong], authority: "x", storageBoundary: "repo" }),
    /different baseline/
  );
  const forward = applyRedaction(baseline, { tombstones: [t1, t2], authority: "x", storageBoundary: "repo" });
  const reversed = applyRedaction(baseline, { tombstones: [t2, t1], authority: "x", storageBoundary: "repo" });
  assert.equal(forward.addendum.addendum_hash, reversed.addendum.addendum_hash);
});

test("FEAT-009: baselines are deeply frozen (review LOW)", () => {
  const opened = pkg();
  const baseline = createBaseline({ packages: [opened], artifactHashes: [H("a")], sourceLocks: [{ id: "L1", rev: 1 }], metadata: { nested: { x: 1 } } });
  assert.throws(() => { baseline.source_locks[0].rev = 2; }, TypeError);
  assert.throws(() => { baseline.metadata.nested.x = 2; }, TypeError);
});
