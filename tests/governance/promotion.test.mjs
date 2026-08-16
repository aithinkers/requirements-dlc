import assert from "node:assert/strict";
import test from "node:test";

import { mintIdentity } from "../../core/lib/identity.mjs";
import {
  PromotionError,
  computeCoverage,
  createCapture,
  detectCycles,
  promote,
  promotionReview,
  triage
} from "../../core/lib/promotion.mjs";

const context = Object.freeze({
  actor: "urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012",
  actorKind: "human",
  reason: "test",
  policyVersion: "materiality/v1",
  contentHash: "sha256:" + "a".repeat(64),
  at: "2026-08-15T21:00:00.000Z"
});

function workingArtifact(overrides = {}) {
  return {
    id: mintIdentity(),
    version: 1,
    governance_state: "working",
    workstream: "checkout-recovery",
    statement: "The checkout service shall preserve an incomplete checkout.",
    ...overrides
  };
}

test("FEAT-006: captures accept free text plus provenance and preserve origin (§14.4)", () => {
  const capture = createCapture({
    text: "Customers lose their cart when the session times out.\nMore detail...",
    provenance: { project: "checkout", sources: ["external://jira/COM/DISC-42"] },
    actor: context.actor,
    at: context.at
  });
  assert.equal(capture.governance_state, "captured");
  assert.equal(capture.type, "capture");
  assert.match(capture.title, /^Customers lose their cart/);
  assert.deepEqual(capture.sources, ["external://jira/COM/DISC-42"]);
  assert.throws(() => createCapture({ text: " ", provenance: {}, actor: context.actor }), PromotionError);
  assert.throws(() => createCapture({ text: "x", actor: context.actor }), PromotionError);
});

test("FEAT-006: triage assigns type and disposition and only applies to captured material", () => {
  const capture = createCapture({ text: "idea", provenance: { project: "p" }, actor: context.actor });
  const { artifact } = triage(capture, { type: "functional-requirement" }, context);
  assert.equal(artifact.governance_state, "triaged");
  assert.equal(artifact.type, "functional-requirement");
  assert.throws(() => triage(artifact, { type: "x" }, context), PromotionError);
  assert.throws(() => triage(capture, {}, context), PromotionError);
});

test("FEAT-006: cycle detection finds hard cycles and ignores soft edges (§21)", () => {
  const cycles = detectCycles([
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "a" },
    { source: "c", target: "d", hard: false },
    { source: "d", target: "c", hard: false }
  ]);
  assert.equal(cycles.length, 1);
  assert.ok(cycles[0].includes("a") && cycles[0].includes("c"));
  assert.deepEqual(detectCycles([{ source: "x", target: "y" }]), []);
});

test("FEAT-006: coverage states cover the §35.4 table", () => {
  const req = { id: "urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10", acceptance_criteria: ["c1", "c2"] };
  const claim = { status: "active", scope: { requirements: [req.id] } };

  assert.equal(computeCoverage({ requirements: [req] }).get(req.id).state, "uncovered");
  assert.equal(computeCoverage({ requirements: [req], claims: [claim] }).get(req.id).state, "claimed");

  const one = (itemState, extra = {}) => [{ requirement: req.id, criteria: ["c1", "c2"], item: "s1", itemState, ...extra }];
  assert.equal(computeCoverage({ requirements: [req], covers: one("working") }).get(req.id).state, "working-covered");
  assert.equal(computeCoverage({ requirements: [req], covers: one("draft") }).get(req.id).state, "draft-covered");
  assert.equal(computeCoverage({ requirements: [req], covers: one("approved") }).get(req.id).state, "approved-covered");

  const partial = [{ requirement: req.id, criteria: ["c1"], item: "s1", itemState: "draft" }];
  assert.equal(computeCoverage({ requirements: [req], covers: partial }).get(req.id).state, "partially-covered");

  const doubled = [...one("draft"), { requirement: req.id, criteria: ["c1", "c2"], item: "s2", itemState: "draft" }];
  assert.equal(computeCoverage({ requirements: [req], covers: doubled }).get(req.id).state, "over-covered");

  const partitioned = [
    { requirement: req.id, criteria: ["c1", "c2"], item: "s1", itemState: "draft", partition: "web" },
    { requirement: req.id, criteria: ["c1", "c2"], item: "s2", itemState: "draft", partition: "mobile" }
  ];
  assert.equal(computeCoverage({ requirements: [req], covers: partitioned }).get(req.id).state, "intentionally-multiple");

  const conflicting = [...one("draft", { conflicting: true })];
  assert.equal(computeCoverage({ requirements: [req], covers: conflicting }).get(req.id).state, "conflicting-coverage");

  const criteria = computeCoverage({ requirements: [req], covers: partial }).get(req.id).criteria;
  assert.equal(criteria.c1, "draft-covered");
  assert.equal(criteria.c2, "uncovered");
});

test("FEAT-006: stale base versions produce blocking findings (§35.3 step 2)", () => {
  const base = mintIdentity();
  const working = workingArtifact({
    base_versions: { [base]: { version: 2, content_hash: "sha256:" + "b".repeat(64) } }
  });
  const shared = { artifacts: [{ id: base, version: 3, content_hash: "sha256:" + "c".repeat(64), governance_state: "draft" }] };
  const review = promotionReview({ working, shared });
  assert.equal(review.passed, false);
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-002"));
});

test("FEAT-006: superseded or missing source requirements block promotion (§35.3 step 4)", () => {
  const source = mintIdentity();
  const working = workingArtifact({ source_requirements: [source, mintIdentity()] });
  const shared = { artifacts: [{ id: source, governance_state: "superseded" }] };
  const review = promotionReview({ working, shared });
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-005"));
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-006"));
});

test("FEAT-006: exact-statement duplicates and dependency cycles block; competing edits warn", () => {
  const working = workingArtifact({
    dependencies: [{ source: "s1", target: "s2" }, { source: "s2", target: "s1" }]
  });
  const shared = {
    artifacts: [{ id: mintIdentity(), statement: "The checkout service SHALL preserve an incomplete checkout!" }],
    inFlightEdits: [{ artifact: working.id, workstream: "other-stream" }]
  };
  const review = promotionReview({ working, shared });
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-009"), "normalized duplicate");
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-012"), "cycle");
  assert.ok(review.findings.some((entry) => entry.rule === "RDLC-PRM-010" && entry.severity === "warning"));
});

test("FEAT-006: external ID and baseline staleness collisions block (§35.3 steps 11–12)", () => {
  const working = workingArtifact({
    external_refs: [{ provider: "jira", item_id: "COM-104" }],
    base_baseline: "sha256:" + "d".repeat(64)
  });
  const shared = {
    artifacts: [],
    externalRefs: [{ provider: "jira", item_id: "COM-104", artifact: mintIdentity() }],
    currentBaseline: "sha256:" + "e".repeat(64)
  };
  const review = promotionReview({ working, shared });
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-013"));
  assert.ok(review.blocking.some((entry) => entry.rule === "RDLC-PRM-014"));
});

test("FEAT-006: delegated template, mapping, and hierarchy validators contribute blocking findings", () => {
  const working = workingArtifact();
  const review = promotionReview({
    working,
    shared: { artifacts: [] },
    validators: {
      template: () => ["missing acceptance criteria"],
      mapping: () => ["no issue type resolves 'enabler'"],
      hierarchy: () => ["story cannot parent an epic"]
    }
  });
  const rules = review.blocking.map((entry) => entry.rule);
  assert.ok(rules.includes("RDLC-PRM-003"));
  assert.ok(rules.includes("RDLC-PRM-004"));
  assert.ok(rules.includes("RDLC-PRM-011"));
});

test("FEAT-006: promotion requires a passing review covering the same artifact (§35.3)", () => {
  const working = workingArtifact();
  const clean = promotionReview({ working, shared: { artifacts: [] } });
  assert.equal(clean.passed, true);

  const failing = { ...clean, passed: false };
  assert.throws(() => promote({ working, review: failing }, context), /passing promotion review/);
  const wrongTarget = { ...clean, working: mintIdentity() };
  assert.throws(() => promote({ working, review: wrongTarget }, context), /does not cover/);

  const capture = createCapture({ text: working.statement, provenance: { project: "p" }, actor: context.actor });
  const result = promote({ working, capture, review: clean }, context);
  assert.equal(result.artifact.governance_state, "draft");
  assert.ok(Object.isFrozen(result.capture), "original capture preserved unrewritten");
  assert.equal(result.capture.statement, working.statement);
  assert.equal(result.promotion.review, clean.id);
  assert.equal(result.promotion.actor, context.actor);
  assert.ok(result.promotion.diff);
  assert.equal(result.audit.to, "draft");
});

test("FEAT-006: the review record identifies what it was reviewed against (§35.3 gate freshness)", () => {
  const working = workingArtifact();
  const review = promotionReview({
    working,
    shared: { artifacts: [{ id: mintIdentity(), statement: "other" }], currentBaseline: "sha256:" + "f".repeat(64) }
  });
  assert.equal(review.reviewed_against.artifact_count, 1);
  assert.equal(review.reviewed_against.baseline, "sha256:" + "f".repeat(64));
  assert.throws(() => promotionReview({ working }), /shared state is required/);
});

test("FEAT-006: conflicting coverage is never masked by partial coverage (review HIGH)", () => {
  const req = { id: mintIdentity(), acceptance_criteria: ["c1", "c2"] };
  const covers = [{ requirement: req.id, criteria: ["c1"], item: "s1", itemState: "draft", conflicting: true }];
  const entry = computeCoverage({ requirements: [req], covers }).get(req.id);
  assert.equal(entry.state, "conflicting-coverage");
  const review = promotionReview({
    working: { id: mintIdentity(), version: 1, statement: "s", source_requirements: [req.id] },
    shared: { artifacts: [req], covers }
  });
  assert.ok(review.blocking.some((f) => f.rule === "RDLC-PRM-007"));
});

test("FEAT-006: disjoint-criteria covers are decomposition, not over-coverage (review MEDIUM)", () => {
  const req = { id: mintIdentity(), acceptance_criteria: ["c1", "c2"] };
  const covers = [
    { requirement: req.id, criteria: ["c1"], item: "s1", itemState: "draft" },
    { requirement: req.id, criteria: ["c2"], item: "s2", itemState: "draft" }
  ];
  assert.equal(computeCoverage({ requirements: [req], covers }).get(req.id).state, "draft-covered");
  const overlapping = [
    { requirement: req.id, criteria: ["c1", "c2"], item: "s1", itemState: "draft" },
    { requirement: req.id, criteria: ["c2"], item: "s2", itemState: "draft" }
  ];
  assert.equal(computeCoverage({ requirements: [req], covers: overlapping }).get(req.id).state, "over-covered");
});

test("FEAT-006: promotion is bound to the reviewed version, content, and shared state (review HIGH)", () => {
  const working = workingArtifact();
  const shared = { artifacts: [] };
  const review = promotionReview({ working, shared });
  // Content mutated after review.
  const mutated = { ...working, statement: "Changed after review." };
  assert.throws(() => promote({ working: mutated, review }, context), /changed after its promotion review/);
  // Version bumped after review.
  const bumped = { ...working, version: 5 };
  assert.throws(() => promote({ working: bumped, review }, context), /covers version/);
  // Shared state moved after review.
  const movedShared = { artifacts: [{ id: mintIdentity(), version: 1 }] };
  assert.throws(() => promote({ working, review, shared: movedShared }, context), /rerun the review/);
  // Unchanged everything promotes.
  assert.equal(promote({ working, review, shared }, context).artifact.governance_state, "draft");
});

test("FEAT-006: source criteria liveness, semantic comparison hook, and approval staleness (review findings)", () => {
  const criterion = mintIdentity();
  const review = promotionReview({
    working: {
      id: mintIdentity(), version: 1, statement: "s",
      source_criteria: [criterion, mintIdentity()],
      base_approval_package: "sha256:" + "9".repeat(64)
    },
    shared: {
      artifacts: [],
      criteria: [{ id: criterion, governance_state: "superseded" }],
      invalidatedApprovalPackages: ["sha256:" + "9".repeat(64)]
    },
    validators: {
      semanticComparison: () => [
        { message: "same actor and outcome as STORY-9", severity: "blocking" },
        { message: "shares two business rules with STORY-4", severity: "warning" }
      ]
    }
  });
  const rules = review.findings.map((f) => f.rule);
  assert.ok(rules.includes("RDLC-PRM-015"));
  assert.ok(rules.includes("RDLC-PRM-016"));
  assert.ok(rules.includes("RDLC-PRM-018"));
  const comparisons = review.findings.filter((f) => f.rule === "RDLC-PRM-017");
  assert.equal(comparisons.length, 2);
  assert.equal(comparisons.filter((f) => f.severity === "blocking").length, 1);
});

test("FEAT-006: whole-requirement covers without criteria still register as over-coverage", () => {
  const req = { id: mintIdentity() };
  const covers = [
    { requirement: req.id, item: "s1", itemState: "draft" },
    { requirement: req.id, item: "s2", itemState: "draft" }
  ];
  assert.equal(computeCoverage({ requirements: [req], covers }).get(req.id).state, "over-covered");
});
