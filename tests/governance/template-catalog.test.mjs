import assert from "node:assert/strict";
import test from "node:test";

import { loadCatalog } from "../../core/lib/template-catalog.mjs";
import { TemplateError } from "../../core/lib/templates.mjs";
import { promotionReview } from "../../core/lib/promotion.mjs";
import { mintIdentity } from "../../core/lib/identity.mjs";

const catalog = await loadCatalog();

test("FEAT-016: every hierarchy level and core requirement type has an authored template (§18.2, §20.2)", () => {
  const types = catalog.types();
  for (const required of ["functional-requirement", "non-functional-requirement", "portfolio-epic", "initiative", "epic", "capability", "feature", "story", "task"]) {
    assert.ok(types.includes(required), required);
  }
  const story = catalog.resolve("story");
  for (const field of ["statement", "actor", "outcome", "acceptance_criteria", "requirements_covered"]) {
    assert.equal(story.fields[field].required, true, field);
  }
  assert.ok(story.locked.acceptance_criteria, "story acceptance criteria are a locked framework control");
  const portfolio = catalog.resolve("portfolio-epic");
  for (const field of ["outcome", "business_objective", "benefits", "benefit_owner", "success_measures"]) {
    assert.equal(portfolio.fields[field].required, true, field);
  }
  assert.throws(() => catalog.resolve("saga"), TemplateError);
});

test("FEAT-016: overlays tighten but cannot weaken locked framework structure (§18.3)", async () => {
  const overlay = {
    level: "portfolio", version: "port/v1",
    artifact_types: { story: { fields: { components: { required: true }, priority: { allowed_values: ["must", "should"] } } } }
  };
  const overlaid = await loadCatalog({ overlays: [overlay] });
  const story = overlaid.resolve("story");
  assert.equal(story.fields.components.required, true, "portfolio overlay tightened components");
  const weakening = await loadCatalog({
    overlays: [{ level: "project", version: "p/v1", artifact_types: { story: { fields: { acceptance_criteria: { required: false } } } } }]
  });
  assert.throws(() => weakening.resolve("story"), /weaken locked field/);
});

test("FEAT-016: artifact validation names missing expected elements (§24.1)", () => {
  const good = {
    type: "story", statement: "As a shopper my cart survives interruption.", actor: "shopper",
    outcome: "cart preserved", acceptance_criteria: ["persists", "expires"], requirements_covered: [mintIdentity()]
  };
  assert.deepEqual(catalog.validateArtifact(good), []);
  const failures = catalog.validateArtifact({ type: "story", statement: "s" });
  assert.ok(failures.some((failure) => /actor/.test(failure)));
  assert.ok(failures.some((failure) => /acceptance_criteria/.test(failure)));
  assert.deepEqual(catalog.validateArtifact({}), ["artifact has no type; no template can be resolved"]);
});

test("FEAT-016: catalog validation blocks promotion when wired as the template validator (§35.3 step 3)", () => {
  const working = { id: mintIdentity(), version: 1, type: "story", statement: "incomplete story" };
  const review = promotionReview({ working, shared: { artifacts: [] }, validators: { template: catalog.promotionValidator() } });
  assert.equal(review.passed, false);
  assert.ok(review.blocking.some((finding) => finding.rule === "RDLC-PRM-003" && /actor/.test(finding.message)));
});

const jiraMapping = {
  version: "jira-com-story/v1",
  artifact_type: "story",
  fields: {
    statement: "summary",
    actor: "customfield_actor",
    outcome: "customfield_outcome",
    acceptance_criteria: "customfield_ac",
    requirements_covered: "customfield_reqs"
  }
};

function snapshot(fields, revision = "2026-08-16T01:00:00.000+0000") {
  return { item_id: "COM-104", revision, fields };
}

test("FEAT-016: a Jira item validates against its mapped template with explainable findings (§20.1, §7.7)", () => {
  const complete = snapshot({
    summary: "Preserve cart", customfield_actor: "shopper", customfield_outcome: "cart preserved",
    customfield_ac: ["persists", "expires"], customfield_reqs: [mintIdentity()]
  });
  assert.equal(catalog.validateProviderItem(complete, jiraMapping).valid, true);

  const missing = snapshot({ summary: "Preserve cart", customfield_actor: "shopper" });
  const result = catalog.validateProviderItem(missing, jiraMapping);
  assert.equal(result.valid, false);
  const outcome = result.findings.find((finding) => finding.template_field === "outcome");
  assert.equal(outcome.rule, "RDLC-FMT-001");
  assert.equal(outcome.provider_field, "customfield_outcome", "findings name the provider field");
  assert.equal(outcome.item, "COM-104");
  assert.throws(() => catalog.validateProviderItem(complete, { fields: {} }), TemplateError);
});

test("FEAT-016: unmapped required fields report a mapping gap, not silence (§20.1)", () => {
  const partialMapping = { version: "jira-min/v1", artifact_type: "story", fields: { statement: "summary" } };
  const result = catalog.validateProviderItem(snapshot({ summary: "s" }), partialMapping);
  const gaps = result.findings.filter((finding) => finding.rule === "RDLC-FMT-002");
  assert.ok(gaps.some((finding) => finding.template_field === "acceptance_criteria"));
  assert.match(gaps[0].message, /no provider mapping/);
});

test("FEAT-016: externally updated items that break the format surface as drift findings (§26, §29.6)", () => {
  const updated = [
    snapshot({ summary: "Edited in Jira, criteria deleted", customfield_actor: "shopper", customfield_outcome: "x", customfield_reqs: [mintIdentity()] }, "rev-9"),
    snapshot({ summary: "Still fine", customfield_actor: "a", customfield_outcome: "o", customfield_ac: ["c1"], customfield_reqs: [mintIdentity()] }, "rev-10")
  ];
  const drifted = catalog.detectFormatDrift(updated, jiraMapping);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].item, "COM-104");
  assert.equal(drifted[0].revision, "rev-9");
  assert.equal(drifted[0].rule, "RDLC-FMT-003");
  assert.ok(drifted[0].violations.some((finding) => finding.template_field === "acceptance_criteria"));
  assert.ok(drifted[0].disposition_options.includes("create-change-request"), "drift is review work, never auto-repair");
});

test("FEAT-016: memoized templates are deeply frozen; caller mutation cannot poison the cache (review MEDIUM)", async () => {
  const fresh = await loadCatalog();
  const resolved = fresh.resolve("story");
  assert.throws(() => { resolved.fields.acceptance_criteria.required = false; }, TypeError);
  assert.equal(fresh.resolve("story").fields.acceptance_criteria.required, true);
  // Mutating a caller-held overlay after construction has no effect either.
  const overlay = { level: "project", version: "p/v1", artifact_types: { story: { fields: { components: { required: true } } } } };
  const overlaid = await loadCatalog({ overlays: [overlay] });
  overlay.artifact_types.story.fields.acceptance_criteria = { required: false };
  assert.equal(overlaid.resolve("story").fields.acceptance_criteria.required, true);
  // Snapshot guard and overlay field-name charset (review LOWs).
  const { TemplateError: TE } = await import("../../core/lib/templates.mjs");
  assert.throws(() => fresh.validateProviderItem(null, { version: "v", artifact_type: "story", fields: {} }), TE);
  const dashed = await loadCatalog({ overlays: [{ level: "project", version: "p/v1", artifact_types: { story: { fields: { "risk-note": { required: true } } } } }] });
  const result = dashed.validateProviderItem({ item_id: "X-1", fields: {} }, { version: "v", artifact_type: "story", fields: { "risk-note": "customfield_risk" } });
  const dashFinding = result.findings.find((finding) => finding.template_field === "risk-note");
  assert.equal(dashFinding.provider_field, "customfield_risk", "dashed overlay names attribute correctly");
});
