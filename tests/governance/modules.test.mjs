import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TemplateError, resolveTemplate, validateAgainstTemplate } from "../../core/lib/templates.mjs";
import { createQuestion, answerFromSources, resolveQuestion, nextGuidedBatch, toBatchFile, ingestBatchFile, ElicitationError } from "../../core/lib/elicitation.mjs";
import { COMPONENT_CLASSES, ComponentError, advanceComponent, disposeComponent, relateComponents, suggestComponent } from "../../core/lib/components.mjs";
import { BUILT_IN_SCALES, EstimationError, confirmEstimate, convertEstimate, createProfile, rollUp, suggestEstimate } from "../../core/lib/estimation.mjs";
import { RAID_TYPES, RaidError, agingReport, createRaidRecord, escalate, scoreRisk, validateAssumption } from "../../core/lib/raid.mjs";
import { CLASSIFICATIONS, DISPOSITIONS, classifyComment, disposeComment, enqueueComment, evaluateApprovalLanguage } from "../../core/lib/comments.mjs";
import { PlanningError, computeWaves, criticalBlockers } from "../../core/lib/planning.mjs";
import { migrateLegacyProject } from "../../scripts/migrate-legacy.mjs";
import { isCanonicalIdentity, mintIdentity } from "../../core/lib/identity.mjs";

const actor = mintIdentity();

/* ---------------------------------------------------------- templates §18.3 */

test("REL-002/templates: precedence resolves and locked controls cannot be weakened (§18.3)", () => {
  const packs = [
    { level: "organization", version: "org/v1", fields: { statement: { required: true, locked: true }, owner: { required: true } } },
    { level: "project", version: "proj/v2", fields: { rationale: { required: true }, owner: { required: false } } }
  ];
  const resolved = resolveTemplate(packs);
  assert.equal(resolved.fields.owner.required, false, "unlocked fields may be relaxed by later packs");
  assert.equal(resolved.locked.statement.level, "organization");
  assert.throws(
    () => resolveTemplate([...packs, { level: "engagement", version: "e/v1", fields: { statement: { required: false } } }]),
    /weaken locked field "statement"/
  );
  // Tightening a locked field is allowed.
  const tightened = resolveTemplate([
    { level: "organization", version: "org/v1", fields: { priority: { locked: true, allowed_values: ["high", "medium", "low"] } } },
    { level: "project", version: "p/v1", fields: { priority: { allowed_values: ["high", "medium"] } } }
  ]);
  assert.deepEqual(tightened.fields.priority.allowed_values, ["high", "medium"]);
  assert.throws(() => resolveTemplate([{ level: "galaxy", version: "v", fields: {} }]), TemplateError);
});

test("REL-002/templates: artifact validation enforces required fields and allowed values (§24.1)", () => {
  const resolved = resolveTemplate([{ level: "framework", version: "f/v1", fields: { statement: { required: true }, priority: { allowed_values: ["high", "low"] } } }]);
  assert.deepEqual(validateAgainstTemplate({ statement: "s", priority: "high" }, resolved), []);
  const failures = validateAgainstTemplate({ priority: "urgent" }, resolved);
  assert.equal(failures.length, 2);
});

/* -------------------------------------------------------- elicitation §18.1 */

test("REL-002/elicitation: questions are durable, source-answered first, and never invented (§18.1)", () => {
  const q1 = createQuestion({ text: "What is the retention period?", reason: "bounds REQ-1 expiry", affectedArtifacts: [mintIdentity(), mintIdentity()] });
  const q2 = createQuestion({ text: "Who owns checkout?", reason: "approval routing", affectedArtifacts: [mintIdentity()] });
  assert.equal(q1.answer_status, "open");
  assert.throws(() => createQuestion({ text: "x", reason: "" }), ElicitationError);

  const answered = answerFromSources([q1, q2], { [q1.id]: { answer: "30 days", evidence: ["external://file/scope.md#section:Outcomes"] } });
  assert.equal(answered[0].answer_status, "answered-from-source");
  assert.equal(answered[0].correctable, true, "the user can correct source answers");
  assert.equal(answered[1].answer_status, "open");
  assert.throws(() => answerFromSources([q2], { [q2.id]: { answer: "x", evidence: [] } }), /requires its evidence/);

  const converted = resolveQuestion(q2, { disposition: "assumption", actor, at: "t" });
  assert.equal(converted.answer_status, "converted-to-assumption");
  assert.ok(isCanonicalIdentity(converted.converted_artifact), "unresolved answers become explicit records");
});

test("REL-002/elicitation: guided batching defaults to three; batch files round-trip (§18.1)", () => {
  const questions = Array.from({ length: 5 }, (_, index) =>
    createQuestion({ text: `Q${index}?`, reason: "r", affectedArtifacts: Array.from({ length: index }, () => mintIdentity()) })
  );
  const batch = nextGuidedBatch(questions);
  assert.equal(batch.length, 3);
  assert.ok(batch[0].affected_artifacts.length >= batch[2].affected_artifacts.length, "most-blocking first");

  const file = toBatchFile(questions.slice(0, 2));
  const edited = file.replace(/ANSWER:\n/, "ANSWER:\n30 days\n");
  const ingested = ingestBatchFile(questions.slice(0, 2), edited, { actor, at: "t" });
  assert.equal(ingested[0].answer_status, "answered");
  assert.equal(ingested[0].answer, "30 days");
  assert.equal(ingested[1].answer_status, "open");
});

/* --------------------------------------------------------- components §19 */

test("REL-002/components: suggestions carry evidence, dispositions are human, confirmation never silent (§19)", () => {
  assert.equal(COMPONENT_CLASSES.length, 9);
  const suggestion = suggestComponent({
    name: "Cart Persistence Service", componentClass: "application-service",
    responsibility: "Durable cart storage", causedBy: [mintIdentity()], confidence: "medium"
  });
  assert.equal(suggestion.lifecycle_state, "suggested");
  assert.ok(suggestion.findings.some((finding) => /solution-decomposition-without-evidence/.test(finding.message)), "technical component without evidence is flagged");

  assert.throws(() => disposeComponent(suggestion, { disposition: "accept", actorKind: "ai", at: "t" }), /human actor/);
  const accepted = disposeComponent(suggestion, { disposition: "accept", actorKind: "human", at: "t" });
  assert.equal(accepted.lifecycle_state, "candidate");
  assert.throws(() => advanceComponent(accepted, "confirmed", { actorKind: "ai" }), /human decision at every step/);
  const confirmed = advanceComponent(accepted, "confirmed", { actorKind: "human" });
  assert.equal(advanceComponent(confirmed, "active", { actorKind: "human" }).lifecycle_state, "active");
  assert.throws(() => advanceComponent(accepted, "active", { actorKind: "human" }), ComponentError);
  assert.throws(() => relateComponents("a", "b", "friends-with"), ComponentError);
  assert.equal(relateComponents("a", "b", "realizes").type, "realizes");
});

/* --------------------------------------------------------- estimation §22 */

test("REL-002/estimation: suggestions never overwrite confirmations; no automatic conversion (§22.3)", () => {
  const profile = createProfile({
    id: "team-a-points", scheme: "story-points", allowedValues: BUILT_IN_SCALES.fibonacci,
    meaning: "relative effort and uncertainty", confirmers: [actor],
    conversions: { "t-shirt": { 1: "XS", 3: "S", 5: "M" } }
  });
  const suggested = suggestEstimate(profile, { artifact: mintIdentity(), value: 5, method: "reference-comparison", rationale: "similar to STORY-9", at: "t" });
  assert.equal(suggested.status, "suggested");
  assert.throws(() => suggestEstimate(profile, { artifact: "a", value: 4, method: "m", rationale: "r", at: "t" }), /outside the .* scale/);

  const confirmed = confirmEstimate(profile, suggested, { value: 8, actor, at: "t2" });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.history.length, 2, "history retains author, method, rationale");
  assert.throws(() => confirmEstimate(profile, confirmed, { value: 13, actor, at: "t3" }), /approved change/);
  assert.equal(confirmEstimate(profile, confirmed, { value: 13, actor, at: "t3", approvedChange: "CR-7" }).value, 13);
  assert.throws(() => confirmEstimate(profile, suggested, { value: 5, actor: mintIdentity(), at: "t" }), /not a configured confirmer/);

  assert.throws(() => convertEstimate(profile, 5, "ideal-hours"), /never converted to time/);
  assert.equal(convertEstimate(profile, 5, "t-shirt"), "M");
  assert.throws(() => convertEstimate(profile, 8, "t-shirt"), /no mapping entry/);

  const other = createProfile({ id: "team-b-points", scheme: "story-points", allowedValues: [1, 2, 3], meaning: "effort", confirmers: [actor] });
  assert.throws(
    () => rollUp([{ profile: "team-a-points", value: 5 }, { profile: "team-b-points", value: 2 }], { "team-a-points": profile, "team-b-points": other }),
    /incompatible team scales/
  );
  assert.equal(rollUp([{ profile: "team-a-points", value: 5 }, { profile: "team-a-points", value: 3 }], { "team-a-points": profile }), 8);
});

/* ---------------------------------------------------------------- RAID §23 */

test("REL-002/raid: type-specific fields, configurable scoring, aging, escalation, validation (§23)", () => {
  assert.equal(RAID_TYPES.length, 5);
  assert.throws(() => createRaidRecord({ type: "risk", statement: "s", owner: actor, at: "t" }), /requires probability/);
  const risk = createRaidRecord({
    type: "risk", statement: "Jira sandbox unavailable", owner: actor, at: "2026-08-15T00:00:00Z",
    probability: "medium", impact: "high", exposure_method: "matrix", mitigation: "recorded fixtures"
  });
  const matrix = { name: "org-3x3", cells: { medium: { high: "amber-9" } } };
  assert.deepEqual(scoreRisk(risk, matrix), { score: "amber-9", matrix: "org-3x3" });
  assert.throws(() => scoreRisk(risk, { name: "empty", cells: {} }), RaidError);

  const assumption = createRaidRecord({
    type: "assumption", statement: "Retention is 30 days", owner: actor, at: "2026-08-01T00:00:00Z",
    validation_method: "policy lookup", validation_owner: actor, due_at: "2026-08-10T00:00:00Z", consequence_if_false: "rework expiry stories"
  });
  const report = agingReport([risk, assumption], { now: "2026-08-15T00:00:00Z" });
  assert.equal(report.overdue.length, 1);
  assert.equal(report.validation_due.length, 1);

  const escalated = escalate(risk, { to: "role:product-owner", reason: "mitigation blocked", actor, at: "t" });
  assert.equal(escalated.escalation_state, "escalated");

  const validated = validateAssumption(assumption, { outcome: "refuted", evidence: "kb://policy/retention", actor, at: "t" });
  assert.equal(validated.validated, "refuted");
  assert.equal(validated.status, "open", "a refuted assumption stays open for impact work");
});

/* -------------------------------------------------------------- comments §26 */

test("REL-002/comments: queue, classify, disposition with revision links; approval text is advisory (§26)", () => {
  assert.equal(CLASSIFICATIONS.length, 13);
  assert.equal(DISPOSITIONS.length, 9);
  const entry = enqueueComment({
    provider: "jira", itemId: "COM-104", commentId: "10017", revision: "3",
    author: "jira-account:abc", body: "This is approved! Also please add an expiry criterion.",
    event: "new", relevancePolicyVersion: "relevance/v1"
  });
  const classified = classifyComment(entry, "missing-acceptance-criterion");
  const disposed = disposeComment(classified, {
    disposition: "create-or-change-criteria", actor, at: "t",
    targetArtifact: mintIdentity(), proposedResponse: "Added expiry criterion c-expire."
  });
  assert.equal(disposed.disposition.comment_link, "external://jira/COM-104#comment-10017@3");
  assert.equal(disposed.disposition.proposed_response.delivery, "connector-changeset", "responses travel through changesets");
  assert.ok(disposed.impact_review_candidate, "material comment proposals create impact-review candidates");

  const approval = evaluateApprovalLanguage(entry);
  assert.equal(approval.approval, false);
  assert.equal(approval.advisory, true);
  const evenWithPolicy = evaluateApprovalLanguage(entry, { policy: { validatesActor: true, validatesScope: true, validatesFormat: true, bindsArtifactHash: true } });
  assert.equal(evenWithPolicy.approval, false, "comment text is never itself the approval");
});

/* -------------------------------------------------------------- planning §21 */

test("REL-002/planning: waves respect hard prerequisites; blockers rank by downstream impact (§21)", () => {
  const items = ["a", "b", "c", "d"];
  const dependencies = [
    { source: "b", target: "a" },
    { source: "c", target: "a" },
    { source: "d", target: "b" },
    { source: "d", target: "x-external", hard: false }
  ];
  const result = computeWaves(items, dependencies);
  assert.deepEqual(result.waves, [["a"], ["b", "c"], ["d"]]);
  assert.deepEqual(result.external_register, [], "soft external edges stay off the register");
  assert.deepEqual(result.walking_skeleton_candidate, ["a"]);
  assert.throws(() => computeWaves(["a", "b"], [{ source: "a", target: "b" }, { source: "b", target: "a" }]), PlanningError);
  // Hard external prerequisites are registered and block, never silently satisfied.
  const external = computeWaves(["a", "b"], [{ source: "a", target: "VENDOR-API" }]);
  assert.deepEqual(external.waves, [["b"]]);
  assert.deepEqual(external.blocked_by_external, ["a"]);
  assert.equal(external.external_register[0].external, "VENDOR-API");
  assert.match(external.unresolved_questions[0], /VENDOR-API/);
  const blockers = criticalBlockers(items, dependencies);
  assert.equal(blockers[0].item, "a");
  assert.equal(blockers[0].blocks, 3);
});

/* -------------------------------------------------------------- migration §2.4 */

test("REL-002/migration: idempotent 0.1->0.2 migration with a full mapping report (§2.4, §44.1)", async () => {
  const legacy = JSON.parse(await readFile("fixtures/migration/legacy-project.json", "utf8"));
  const { project, report } = migrateLegacyProject(legacy);
  assert.equal(project.schema_version, "rdlc.project/v0.2");
  assert.equal(report.renamed_containers, 1);
  assert.equal(report.mappings.length, 3);
  for (const mapping of report.mappings) {
    assert.ok(isCanonicalIdentity(mapping.new_identity));
    assert.ok(mapping.old_identity);
  }
  // Statuses split without inventing evidence.
  const synced = report.mappings.find((mapping) => mapping.old_status === "approved-and-synced");
  assert.equal(synced.new_states.synchronization_state, "not-synchronized");
  assert.equal(synced.new_states.governance_state, "reviewed", "a legacy approval never mints a 0.2 approved state");
  assert.match(synced.note, /no conforming decision or read-back evidence/);
  const tested = report.mappings.find((mapping) => mapping.old_status === "tested");
  assert.equal(tested.new_states.verification_outcome, "none");
  // Relationships rewritten to UUID URNs.
  const story = project.artifacts.find((artifact) => artifact.display_id === "STORY-1");
  assert.ok(isCanonicalIdentity(story.relationships[0].target));
  // Legacy approvals become historical evidence only.
  assert.equal(project.historical_approvals[0].status, "historical-evidence");
  assert.ok(isCanonicalIdentity(project.historical_approvals[0].artifact), "historical approvals reference the minted identity");
  assert.equal(project.historical_approvals[0].legacy_artifact_alias, "REQ-1");
  // Idempotence.
  const again = migrateLegacyProject(project);
  assert.equal(again.report.already_migrated, true);
  assert.deepEqual(again.project, project);
});

/* ------------------------------------------------------ self-review fixture */

test("REL-002/self-review: the §44.3 fixture is anchored, adjudicated, and class-labeled", async () => {
  const fixture = JSON.parse(await readFile("fixtures/self-review/findings.json", "utf8"));
  assert.match(fixture.anchor, /0\.2\.0 baseline \+ ADR-001/);
  assert.ok(fixture.findings.length >= 8);
  for (const finding of fixture.findings) {
    assert.ok(finding.class, finding.id);
    assert.ok(["accepted", "rejected-as-moot", "open-erratum"].includes(finding.disposition), finding.id);
    assert.ok(finding.fixed_in, finding.id);
  }
});

test("REL-002/planning: dependency records require type, rationale, origin, confidence, hardness (§21)", async () => {
  const { createDependency, createNonDevelopmentTask, NON_DEVELOPMENT_CATEGORIES } = await import("../../core/lib/planning.mjs");
  const dependency = createDependency({ source: "a", target: "b", type: "api-contract", rationale: "consumes cart API", origin: "ai", confidence: "medium", hard: true });
  assert.equal(dependency.status, "candidate", "AI dependencies stay candidates (§21)");
  assert.equal(createDependency({ source: "a", target: "b", type: "data", rationale: "r", origin: "human", confidence: "high", hard: false }).status, "accepted");
  assert.throws(() => createDependency({ source: "a", target: "b", type: "api-contract", origin: "ai", confidence: "medium", hard: true }), /requires rationale/);
  assert.throws(() => createDependency({ source: "a", target: "b", type: "vibes", rationale: "r", origin: "ai", confidence: "low", hard: true }), PlanningError);
  assert.equal(NON_DEVELOPMENT_CATEGORIES.length, 14);
  const task = createNonDevelopmentTask({ category: "legal", title: "DPA review", completionPolicy: "counsel sign-off", owner: actor });
  assert.equal(task.type, "task");
  assert.ok(!("acceptance_criteria" in task), "no fake user story (§20.3)");
  assert.throws(() => createNonDevelopmentTask({ category: "vibes", title: "t", completionPolicy: "p", owner: actor }), PlanningError);
});

test("REL-002/semantic-review: the initial reviewer emits clearly labeled suggestions only (§24.2, §45.1)", async () => {
  const { semanticReview } = await import("../../core/lib/semantic-review.mjs");
  const result = semanticReview({
    statement: "The system shall be fast and easy and flexible or robust as needed",
    acceptance_criteria: ["the system shall be fast and easy and flexible or robust as needed"]
  });
  assert.equal(result.semantic, true);
  assert.ok(result.findings.length >= 4);
  for (const finding of result.findings) {
    assert.equal(finding.semantic, true);
    assert.equal(finding.status, "suggestion", "semantic findings never block on their own");
    assert.equal(finding.severity, "advisory");
    assert.ok(finding.review_version);
  }
  const rules = result.findings.map((finding) => finding.rule);
  assert.ok(rules.includes("RDLC-SEM-001"), "vague terms");
  assert.ok(rules.includes("RDLC-SEM-002"), "compound requirement");
  assert.ok(rules.includes("RDLC-SEM-004") || rules.includes("RDLC-SEM-005"), "criteria checks");
  assert.deepEqual(semanticReview({ statement: "The checkout service shall preserve an incomplete checkout for the configured retention period.", acceptance_criteria: ["rejects invalid sessions with an error"] }).findings, []);
});

test("REL-002/fixes: locked-field null bypass closed; unknown-profile rollUp refused; AI advancement blocked (review findings)", async () => {
  const { resolveTemplate } = await import("../../core/lib/templates.mjs");
  assert.throws(() => resolveTemplate([
    { level: "organization", version: "o/v1", fields: { priority: { locked: true, required: true, allowed_values: ["a", "b"] } } },
    { level: "project", version: "p/v1", fields: { priority: { allowed_values: null } } }
  ]), /weaken locked field/);
  assert.throws(() => resolveTemplate([
    { level: "organization", version: "o/v1", fields: { statement: { locked: true, required: true } } },
    { level: "project", version: "p/v1", fields: { statement: { required: null } } }
  ]), /weaken locked field/);

  const { rollUp: roll } = await import("../../core/lib/estimation.mjs");
  assert.throws(() => roll([{ profile: "ghost-a", value: 100 }, { profile: "ghost-b", value: 5 }], {}), /unknown estimation profile/);

  const { advanceComponent: advance, suggestComponent: suggest } = await import("../../core/lib/components.mjs");
  const suggestion = suggest({ name: "X", componentClass: "product-area", responsibility: "r", causedBy: [mintIdentity()], confidence: "low" });
  assert.throws(() => advance(suggestion, "candidate", { actorKind: "ai" }), /human decision at every step/);
});
