import assert from "node:assert/strict";
import test from "node:test";

import {
  GOVERNANCE_TRANSITIONS,
  LifecycleError,
  SYNCHRONIZATION_TRANSITIONS,
  VERIFICATION_PROGRESS_ORDER,
  createRevision,
  isMaterialChange,
  setVerificationOutcome,
  transitionGovernance,
  transitionSynchronization,
  transitionVerificationProgress
} from "../../core/lib/lifecycle.mjs";

const context = Object.freeze({
  actor: "urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012",
  actorKind: "human",
  reason: "test",
  policyVersion: "materiality/v1",
  contentHash: "sha256:" + "a".repeat(64),
  at: "2026-08-15T20:00:00.000Z"
});

function artifactIn(state, extra = {}) {
  return {
    id: "urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10",
    version: 3,
    governance_state: state,
    ...extra
  };
}

test("FEAT-005: the governance table covers all 16 states and terminal states are empty", () => {
  assert.equal(Object.keys(GOVERNANCE_TRANSITIONS).length, 16);
  for (const terminal of ["superseded", "retired", "withdrawn"]) {
    assert.deepEqual(GOVERNANCE_TRANSITIONS[terminal], []);
  }
});

test("FEAT-005: every listed governance transition passes and every unlisted one is rejected (§14.2)", () => {
  const states = Object.keys(GOVERNANCE_TRANSITIONS);
  for (const from of states) {
    for (const to of states) {
      const artifact = artifactIn(from);
      const allowed = GOVERNANCE_TRANSITIONS[from].includes(to);
      if (allowed) {
        const { artifact: next, audit } = transitionGovernance(artifact, to, context);
        assert.equal(next.governance_state, to);
        assert.equal(audit.from, from);
        assert.equal(audit.to, to);
      } else {
        assert.throws(() => transitionGovernance(artifact, to, context), LifecycleError, `${from} -> ${to}`);
      }
    }
  }
});

test("FEAT-005: needs-clarification returns only to its recorded return state (§14.2)", () => {
  const { artifact: paused } = transitionGovernance(artifactIn("draft"), "needs-clarification", context);
  assert.equal(paused.return_state, "draft");
  const { artifact: resumed } = transitionGovernance(paused, "draft", context);
  assert.equal(resumed.governance_state, "draft");
  assert.equal(resumed.return_state, undefined);
  // A different non-listed destination stays rejected.
  assert.throws(() => transitionGovernance(paused, "reviewed", context), LifecycleError);
});

test("FEAT-005: transition audit records carry actor, hash, policy, and versions (§14.2)", () => {
  const { audit } = transitionGovernance(artifactIn("captured"), "triaged", context);
  for (const field of ["dimension", "from", "to", "artifact", "content_hash", "policy_version", "actor", "actor_kind", "reason", "at"]) {
    assert.ok(audit[field], field);
  }
  for (const missing of ["actor", "actorKind", "reason", "policyVersion", "contentHash"]) {
    const broken = { ...context };
    delete broken[missing];
    assert.throws(() => transitionGovernance(artifactIn("captured"), "triaged", broken), LifecycleError, missing);
  }
});

test("FEAT-005: an AI actor cannot approve, baseline, or waive (§14.6)", () => {
  const ai = { ...context, actorKind: "ai" };
  assert.throws(() => transitionGovernance(artifactIn("awaiting-approval"), "approved", ai), /AI actor/);
  assert.throws(() => transitionGovernance(artifactIn("approved"), "baselined", ai), /AI actor/);
  const executed = artifactIn("approved", { verification_progress: "executed" });
  assert.throws(
    () => setVerificationOutcome(executed, "waived", { ...ai, waiver: { id: "W-1" } }),
    /human waiver/
  );
});

test("FEAT-005: automated approval requires a visible automation policy (§14.6)", () => {
  const automation = { ...context, actorKind: "deterministic-automation" };
  assert.throws(() => transitionGovernance(artifactIn("awaiting-approval"), "approved", automation), /automation policy/);
  const { artifact } = transitionGovernance(
    artifactIn("awaiting-approval"), "approved",
    { ...automation, automationPolicy: "release-policy/v2" }
  );
  assert.equal(artifact.governance_state, "approved");
});

test("FEAT-005: synchronization table matches §14.3 exactly", () => {
  const states = Object.keys(SYNCHRONIZATION_TRANSITIONS);
  assert.equal(states.length, 7);
  for (const from of states) {
    for (const to of states) {
      const artifact = artifactIn("approved", { synchronization_state: from });
      const allowed = SYNCHRONIZATION_TRANSITIONS[from].includes(to);
      const call = () => transitionSynchronization(artifact, to, { ...context, readbackHash: "sha256:" + "b".repeat(64) });
      if (allowed) assert.equal(call().artifact.synchronization_state, to);
      else assert.throws(call, LifecycleError, `${from} -> ${to}`);
    }
  }
});

test("FEAT-005: synchronized-from-applying requires read-back evidence (§29.1)", () => {
  const artifact = artifactIn("approved", { synchronization_state: "applying" });
  assert.throws(() => transitionSynchronization(artifact, "synchronized", context), /read-back/);
});

test("FEAT-005: verification progress is strictly sequential and executed needs evidence", () => {
  let artifact = artifactIn("approved");
  for (const to of VERIFICATION_PROGRESS_ORDER.slice(1, -1)) {
    artifact = transitionVerificationProgress(artifact, to, context).artifact;
  }
  assert.throws(() => transitionVerificationProgress(artifact, "executed", context), /execution evidence/);
  artifact = transitionVerificationProgress(artifact, "executed", { ...context, executionEvidence: "runs/r1.json" }).artifact;
  assert.equal(artifact.verification_progress, "executed");
  // Skipping a stage is invalid.
  assert.throws(
    () => transitionVerificationProgress(artifactIn("draft"), "implemented", context),
    LifecycleError
  );
});

test("FEAT-005: outcomes derive from evidence under a versioned mapping; waived is not passed", () => {
  const executed = artifactIn("approved", { verification_progress: "executed" });
  assert.throws(() => setVerificationOutcome(executed, "passed", context), /execution evidence/);
  const { artifact: passed } = setVerificationOutcome(executed, "passed", {
    ...context, executionEvidence: "runs/r1.json", resultMappingVersion: "results/v1"
  });
  assert.equal(passed.verification_outcome, "passed");
  const { artifact: waived } = setVerificationOutcome(executed, "waived", { ...context, waiver: { id: "W-1" } });
  assert.equal(waived.verification_outcome, "waived");
  assert.notEqual(waived.verification_outcome, "passed");
  // Outcome without executed progress fails.
  assert.throws(
    () => setVerificationOutcome(artifactIn("approved"), "failed", { ...context, executionEvidence: "e", resultMappingVersion: "v" }),
    /executed verification progress/
  );
});

test("FEAT-005: §14.5 default materiality — material, non-material, and unclassified", () => {
  assert.equal(isMaterialChange({ changedFields: ["statement"] }).material, true);
  assert.equal(isMaterialChange({ changedRelationships: ["depends-on"] }).material, true);
  assert.equal(isMaterialChange({ changedFields: ["display_id", "updated_at"] }).material, false);
  const unclassified = isMaterialChange({ changedFields: ["novel_field"] });
  assert.equal(unclassified.material, true);
  assert.match(unclassified.cause, /unclassified/);
});

test("FEAT-005: a narrowing policy must name field, authority, version, and rationale (§27.7)", () => {
  assert.throws(
    () => isMaterialChange({ changedFields: ["priority"] }, { nonMaterial: [{ field: "priority" }] }),
    /authority, version, and rationale/
  );
  const narrowed = isMaterialChange(
    { changedFields: ["priority"] },
    { authority: "org-policy", version: "v3", nonMaterial: [{ field: "priority", rationale: "priority not used by approval in this project" }] }
  );
  assert.equal(narrowed.material, false);
});

test("FEAT-005: a material change creates a new revision and invalidates current approvals (§14.5)", () => {
  const artifact = artifactIn("baselined");
  const approvals = [
    { artifact: artifact.id, status: "current", package_hash: "sha256:" + "c".repeat(64) },
    { artifact: "urn:uuid:0198b7d0-5b1e-7a30-9c2d-1e6b8f5a3c09", status: "current" }
  ];
  const result = createRevision(artifact, { changedFields: ["statement"], approvals }, context);
  assert.equal(result.revision.version, 4);
  assert.equal(result.revision.governance_state, "working");
  assert.equal(result.priorRevision.version, 3);
  assert.equal(result.priorRevision.governance_state, "baselined");
  assert.ok(Object.isFrozen(result.priorRevision));
  assert.equal(result.approvals[0].status, "invalidated");
  assert.equal(result.approvals[1].status, "current", "unaffected approvals are retained");
  assert.deepEqual(result.impact.requires, ["impact-analysis", "new-content-hash", "new-review-package"]);
  // Non-material changes cannot mint a revision.
  assert.throws(
    () => createRevision(artifact, { changedFields: ["display_id"], approvals }, context),
    /material change/
  );
});
