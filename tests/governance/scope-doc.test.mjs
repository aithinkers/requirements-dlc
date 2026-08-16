import assert from "node:assert/strict";
import test from "node:test";

import { loadCatalog } from "../../core/lib/template-catalog.mjs";
import { validateMapping } from "../../core/lib/connector-config.mjs";
import {
  ScopeDocError,
  buildScopeDocument,
  renderScopeDocumentMarkdown,
  validateReleaseAssignments
} from "../../core/lib/scope-doc.mjs";

const releases = [
  { type: "release", name: "2026.2", target_date: "2026-06-30", goals: ["checkout revamp"], status: "active" },
  { type: "release", name: "2026.3", target_date: "2026-09-30", goals: ["loyalty"], status: "planned" },
  { type: "release", name: "old", target_date: "2025-01-01", goals: ["-"], status: "cancelled" }
];
const artifacts = [
  { type: "story", title: "Cart survives interruption", target_release: "2026.2" },
  { type: "feature", title: "Loyalty points", target_release: "2026.3" },
  { type: "story", title: "Gift wrap" },
  { type: "epic", title: "Checkout", target_release: "2026.2" }
];

test("FEAT-021: release and scope-document templates exist with locked scope elements (§18.2)", async () => {
  const catalog = await loadCatalog();
  const release = catalog.resolve("release");
  assert.equal(release.fields.name.required, true);
  assert.deepEqual(release.fields.status.allowed_values, ["planned", "active", "released", "cancelled"]);
  const scope = catalog.resolve("scope-document");
  for (const locked of ["intent", "in_scope", "out_of_scope"]) assert.ok(scope.locked[locked], locked);
  assert.equal(catalog.resolve("story").fields.target_release.required, false);
  const failures = catalog.validateArtifact({ type: "scope-document", intent: "i" });
  assert.ok(failures.some((failure) => /out_of_scope/.test(failure)));
});

test("FEAT-021: release assignments fail closed with explainable findings", () => {
  assert.deepEqual(validateReleaseAssignments(artifacts, releases), []);
  const findings = validateReleaseAssignments(
    [
      { type: "story", title: "Ghost", target_release: "2027.9" },
      { type: "task", title: "Chore", target_release: "2026.2" },
      { type: "story", title: "Stale", target_release: "old" }
    ],
    releases
  );
  assert.equal(findings.length, 3);
  assert.equal(findings[0].rule, "RDLC-REL-001");
  assert.match(findings[0].message, /not declared/);
  assert.equal(findings[1].rule, "RDLC-REL-002");
  assert.equal(findings[2].rule, "RDLC-REL-003");
  assert.throws(() => validateReleaseAssignments([], [releases[0], { ...releases[0] }]), /duplicate release name/);
});

test("FEAT-021: release-scoped document assembles from recorded decisions only", () => {
  const document = buildScopeDocument({
    intent: "Ship the revamped checkout without losing carts.",
    stakeholders: ["PO: Kim", "Ops"],
    successMeasures: ["cart loss < 0.1%"],
    artifacts,
    releases,
    release: "2026.2",
    deferrals: [{ item: "Gift receipts", decision: "deferred", reason: "legal review pending", decided_by: "urn:example:kim" }],
    assumptions: ["payment provider unchanged"]
  });
  assert.deepEqual(document.in_scope.map((entry) => entry.item), ["Cart survives interruption", "Checkout"]);
  assert.deepEqual(document.out_of_scope.map((entry) => entry.item), ["Loyalty points", "Gift receipts"]);
  assert.match(document.out_of_scope[0].reason, /2026\.3/);
  assert.deepEqual(document.open_questions, ['Is "Gift wrap" (story) in release "2026.2"? It has no release assignment yet.']);
  assert.deepEqual(document.coverage, { planning_items: 4, in_scope: 2, out_of_scope: 1, unassigned: 1, external_deferrals: 1 });
  const { coverage } = document;
  assert.equal(coverage.in_scope + coverage.out_of_scope + coverage.unassigned, coverage.planning_items, "coverage arithmetic reconciles");

  // The document satisfies its own template.
  return loadCatalog().then((catalog) => assert.deepEqual(catalog.validateArtifact(document), []));
});

test("FEAT-021: unscoped documents include everything; guessing is impossible", () => {
  const document = buildScopeDocument({
    intent: "i", stakeholders: ["s"], successMeasures: ["m"], artifacts, releases
  });
  assert.equal(document.in_scope.length, 4);
  assert.equal(document.release, undefined);
  assert.throws(() => buildScopeDocument({ intent: "", stakeholders: ["s"], successMeasures: ["m"] }), /requires intent/);
  assert.throws(
    () => buildScopeDocument({ intent: "i", stakeholders: ["s"], successMeasures: ["m"], releases, release: "2029.1" }),
    /not declared/
  );
  assert.throws(
    () => buildScopeDocument({ intent: "i", stakeholders: ["s"], successMeasures: ["m"], artifacts: [{ type: "story", title: "x", target_release: "nope" }], releases }),
    /repaired first/
  );
  assert.throws(
    () => buildScopeDocument({ intent: "i", stakeholders: ["s"], successMeasures: ["m"], deferrals: [{ item: "x", decision: "dropped" }] }),
    ScopeDocError
  );
});

test("FEAT-021: title collisions cannot silently swallow an assigned item (review round 2)", () => {
  const twins = [
    { id: "A", type: "story", title: "Login", target_release: "2026.2" },
    { id: "B", type: "story", title: "Login" }
  ];
  // Ambiguous title deferral is an error, not a guess.
  assert.throws(
    () => buildScopeDocument({ intent: "i", stakeholders: ["s"], successMeasures: ["m"], artifacts: twins, releases, release: "2026.2", deferrals: [{ item: "Login", decision: "deferred", reason: "later" }] }),
    /matches 2 planning items/
  );
  // Deferring by unique id keeps the assigned twin fully accounted for.
  const document = buildScopeDocument({
    intent: "i", stakeholders: ["s"], successMeasures: ["m"], artifacts: twins, releases, release: "2026.2",
    deferrals: [{ item: "B", decision: "deferred", reason: "later" }]
  });
  assert.deepEqual(document.in_scope.map((entry) => entry.item), ["Login"]);
  assert.deepEqual(document.coverage, { planning_items: 2, in_scope: 1, out_of_scope: 1, unassigned: 0, external_deferrals: 0 });
});

test("FEAT-021: malformed target_release types fail closed; cancelled releases cannot be documented", () => {
  const findings = validateReleaseAssignments([{ type: "story", title: "x", target_release: ["2026.2"] }], releases);
  assert.equal(findings[0].rule, "RDLC-REL-004");
  assert.match(findings[0].message, /array/);
  assert.throws(
    () => buildScopeDocument({ intent: "i", stakeholders: ["s"], successMeasures: ["m"], releases, release: "old" }),
    /cancelled/
  );
});

test("FEAT-021: markdown rendering is shareable and ordered for readers", () => {
  const document = buildScopeDocument({
    intent: "Ship checkout.", stakeholders: ["Kim"], successMeasures: ["m"], artifacts, releases, release: "2026.2"
  });
  const markdown = renderScopeDocumentMarkdown(document);
  assert.match(markdown, /^# Scope: release 2026\.2/);
  for (const heading of ["## Intent", "## In scope", "## Out of scope", "## Assumptions", "## Stakeholders", "## Success measures", "## Open questions", "## Coverage"]) {
    assert.ok(markdown.includes(heading), heading);
  }
  assert.match(markdown, /awaiting a decision/);
  assert.throws(() => renderScopeDocumentMarkdown({ type: "story" }), ScopeDocError);
});

test("FEAT-021: connector mapping accepts a releases binding and fails closed on bad ones (§20.1)", () => {
  const base = {
    schema_version: "rdlc.connector-mapping/v0.2", version: "v1", provider: "jira", project_key: "COM",
    fields: ["summary", "fixVersions"]
  };
  assert.deepEqual(validateMapping({ ...base, releases: { provider_field: "fixVersions" } }), []);
  assert.ok(validateMapping({ ...base, releases: { provider_field: "missing" } }).some((failure) => /not in the mapped fields/.test(failure)));
  assert.ok(validateMapping({ ...base, releases: { provider_field: "fixVersions", match_by: "path" } }).some((failure) => /match_by/.test(failure)));
});

test("FEAT-021: a mapped target_release drifts like any other template field (§26, §29.6)", async () => {
  const catalog = await loadCatalog();
  const mapping = {
    version: "jira-story-rel/v1", artifact_type: "story",
    fields: {
      statement: "summary", actor: "customfield_actor", outcome: "customfield_outcome",
      acceptance_criteria: "customfield_ac", requirements_covered: "customfield_reqs", target_release: "fixVersions"
    }
  };
  const complete = {
    item_id: "COM-9", revision: "r2",
    fields: { summary: "s", customfield_actor: "a", customfield_outcome: "o", customfield_ac: ["c"], customfield_reqs: ["urn:x"], fixVersions: "2026.2" }
  };
  assert.equal(catalog.validateProviderItem(complete, mapping).valid, true);
  // target_release is optional, so its absence is not drift; required fields still are.
  const missingRequired = { item_id: "COM-9", revision: "r3", fields: { summary: "s", fixVersions: "2026.9" } };
  const drifted = catalog.detectFormatDrift([missingRequired], mapping);
  assert.equal(drifted.length, 1);
  assert.ok(drifted[0].violations.every((violation) => violation.template_field !== "target_release"));
});
