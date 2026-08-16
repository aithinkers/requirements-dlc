import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConnectorConfigError, loadConnectorConfig, validateMapping } from "../../core/lib/connector-config.mjs";
import { loadCatalog } from "../../core/lib/template-catalog.mjs";
import { suggestEstimate } from "../../core/lib/estimation.mjs";
import { mintIdentity } from "../../core/lib/identity.mjs";

const catalog = await loadCatalog();
const confirmer = mintIdentity();

const GOOD_MAPPING = `schema_version: rdlc.connector-mapping/v0.2
version: jira-com/v1
provider: jira
project_key: COM
fields: [summary, description, status, components, customfield_10016, customfield_ac, customfield_reqs]
estimation:
  profile: team-story-points
  provider_field: customfield_10016
  scheme: story-points
  allowed_values: [1, 2, 3, 5, 8, 13]
components:
  provider_field: components
  match_by: name
artifact_types:
  story:
    issue_type: Story
    template_fields:
      statement: summary
      acceptance_criteria: customfield_ac
      requirements_covered: customfield_reqs
  epic:
    issue_type: Epic
    template_fields:
      outcome: summary
`;

async function projectWith(mappingText, connectors = null) {
  const root = await mkdtemp(join(tmpdir(), "rdlc-cfg-"));
  const declaration = connectors ?? `connectors:
  - id: delivery-jira
    provider: jira
    mapping: config/connectors/jira-com.yaml
    write_mode: propose
`;
  await writeFile(join(root, "requirements-project.yaml"), `schema_version: rdlc.project/v0.2\nproject:\n  id: p\n${declaration}`, "utf8");
  await mkdir(join(root, "config", "connectors"), { recursive: true });
  await writeFile(join(root, "config", "connectors", "jira-com.yaml"), mappingText, "utf8");
  return root;
}

test("FEAT-017: a valid config loads into ready-to-use connector, estimation, and template objects", async () => {
  const root = await projectWith(GOOD_MAPPING);
  const [config] = await loadConnectorConfig(root, { catalogTypes: catalog.types(), confirmers: [confirmer] });
  assert.equal(config.id, "delivery-jira");
  assert.equal(config.write_mode, "propose");
  // JiraConnector-ready mapping.
  assert.deepEqual(config.connectorMapping, { version: "jira-com/v1", projectKey: "COM", fields: ["summary", "description", "status", "components", "customfield_10016", "customfield_ac", "customfield_reqs"] });
  // Estimation profile is live: suggestions validate against the configured scale.
  const suggestion = suggestEstimate(config.estimation.profile, { artifact: mintIdentity(), value: 5, method: "reference", rationale: "similar", at: "t" });
  assert.equal(suggestion.status, "suggested");
  assert.throws(() => suggestEstimate(config.estimation.profile, { artifact: "a", value: 4, method: "m", rationale: "r", at: "t" }), /outside the .* scale/);
  assert.equal(config.estimation.provider_field, "customfield_10016");
  // Components binding.
  assert.deepEqual(config.components, { provider_field: "components", match_by: "name" });
  // Template mapping feeds validateProviderItem directly.
  const result = catalog.validateProviderItem(
    { item_id: "COM-9", revision: "r1", fields: { summary: "s" } },
    config.templateMappings.story
  );
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.template_field === "acceptance_criteria" && finding.provider_field === "customfield_ac"));
});

test("FEAT-017: invalid configs fail closed with explainable messages", async () => {
  const badScheme = GOOD_MAPPING.replace("scheme: story-points", "scheme: vibes");
  assert.ok(validateMapping((await import("yaml")).default.parse(badScheme)).some((failure) => /unknown estimation scheme/.test(failure)));

  const unmappedEstimation = GOOD_MAPPING.replace("customfield_10016, ", "");
  assert.ok(validateMapping((await import("yaml")).default.parse(unmappedEstimation)).some((failure) => /not in the mapped fields list/.test(failure)));

  const unknownType = GOOD_MAPPING.replace("  epic:", "  saga:");
  assert.ok(validateMapping((await import("yaml")).default.parse(unknownType), { catalogTypes: catalog.types() }).some((failure) => /no template in the catalog/.test(failure)));

  const duplicateIssueType = GOOD_MAPPING.replace("issue_type: Epic", "issue_type: Story");
  assert.ok(validateMapping((await import("yaml")).default.parse(duplicateIssueType)).some((failure) => /bound to more than one artifact type/.test(failure)));

  const root = await projectWith(badScheme);
  await assert.rejects(loadConnectorConfig(root, { catalogTypes: catalog.types() }), ConnectorConfigError);
  const badMode = await projectWith(GOOD_MAPPING, `connectors:\n  - id: x\n    provider: jira\n    mapping: config/connectors/jira-com.yaml\n    write_mode: yolo\n`);
  await assert.rejects(loadConnectorConfig(badMode), /unknown write mode/);
  const providerMismatch = await projectWith(GOOD_MAPPING.replace("provider: jira", "provider: github"));
  await assert.rejects(loadConnectorConfig(providerMismatch, { catalogTypes: catalog.types() }), /does not match connector/);
});

test("FEAT-017: setup scaffolds the example mapping and a project without connectors loads cleanly", async () => {
  const { runSetup } = await import("../../scripts/setup.mjs");
  const target = await mkdtemp(join(tmpdir(), "rdlc-cfg-setup-"));
  await runSetup({ target, log: () => {} });
  const example = await (await import("node:fs/promises")).readFile(join(target, "config", "connectors", "jira-example.yaml"), "utf8");
  assert.match(example, /rdlc.connector-mapping\/v0.2/);
  assert.match(example, /story-points/);
  const configs = await loadConnectorConfig(target);
  assert.deepEqual(configs, [], "empty connectors list is valid");
});

test("FEAT-017: mapping paths are confined to the project root; errors carry config context (review MEDIUMs)", async () => {
  const escape = await projectWith(GOOD_MAPPING, `connectors:\n  - id: x\n    provider: jira\n    mapping: ../../../../etc/hosts\n    write_mode: propose\n`);
  await assert.rejects(loadConnectorConfig(escape), /escapes the project root/);
  const absolute = await projectWith(GOOD_MAPPING, `connectors:\n  - id: x\n    provider: jira\n    mapping: /etc/hosts\n    write_mode: propose\n`);
  await assert.rejects(loadConnectorConfig(absolute), /escapes the project root/);

  // No confirmers anywhere: a config-scoped error naming connector and file.
  const noConfirmers = await projectWith(GOOD_MAPPING);
  await assert.rejects(
    loadConnectorConfig(noConfirmers, { catalogTypes: catalog.types() }),
    (error) => error instanceof ConnectorConfigError && /delivery-jira/.test(error.message) && /jira-com.yaml/.test(error.message) && /confirms estimates/.test(error.message)
  );

  // Duplicate connector ids fail closed.
  const duplicate = await projectWith(GOOD_MAPPING, `connectors:\n  - id: a\n    provider: jira\n    mapping: config/connectors/jira-com.yaml\n    write_mode: propose\n  - id: a\n    provider: jira\n    mapping: config/connectors/jira-com.yaml\n    write_mode: propose\n`);
  await assert.rejects(loadConnectorConfig(duplicate, { catalogTypes: catalog.types(), confirmers: [confirmer] }), /duplicate connector id/);

  // Unparseable YAML is reported as such, without echoing content.
  const badYaml = await projectWith("{{{{not yaml");
  await assert.rejects(loadConnectorConfig(badYaml), (error) => /not valid YAML/.test(error.message) && !/not yaml/.test(error.message));
});

test("FEAT-018: azure-devops mappings validate, load, and power template checks; runtime stays roadmap", async () => {
  const YAML = (await import("yaml")).default;
  const { runSetup } = await import("../../scripts/setup.mjs");
  const target = await mkdtemp(join(tmpdir(), "rdlc-ado-"));
  await runSetup({ target, log: () => {} });
  const example = await (await import("node:fs/promises")).readFile(join(target, "config", "connectors", "azure-devops-example.yaml"), "utf8");
  const parsed = YAML.parse(example);
  assert.equal(parsed.provider, "azure-devops");
  assert.match(example, /roadmap \(§45\.3\)/, "runtime status is stated, not implied");
  assert.deepEqual(validateMapping(parsed, { catalogTypes: catalog.types() }), []);

  // Declared and loaded end to end.
  await writeFile(join(target, "requirements-project.yaml"),
    (await (await import("node:fs/promises")).readFile(join(target, "requirements-project.yaml"), "utf8"))
      .replace("connectors: []", "connectors:\n  - id: boards\n    provider: azure-devops\n    mapping: config/connectors/azure-devops-example.yaml\n    write_mode: read-only"), "utf8");
  const [ado] = await loadConnectorConfig(target, { catalogTypes: catalog.types(), confirmers: [confirmer] });
  assert.equal(ado.provider, "azure-devops");
  assert.equal(ado.estimation.provider_field, "Microsoft.VSTS.Scheduling.StoryPoints");
  // Snapshot-level validation works against ADO field names today.
  const result = catalog.validateProviderItem(
    { item_id: "1042", revision: "7", fields: { "System.Title": "Preserve cart" } },
    ado.templateMappings.story
  );
  assert.ok(result.findings.some((finding) => finding.provider_field === "Microsoft.VSTS.Common.AcceptanceCriteria"));

  // Unknown providers and missing ADO organization fail closed.
  assert.ok(validateMapping({ ...parsed, provider: "linear" }).some((failure) => /unknown provider/.test(failure)));
  const { organization, ...withoutOrg } = parsed;
  assert.ok(validateMapping(withoutOrg).some((failure) => /require the organization/.test(failure)));
});

test("FEAT-018: the setup-connector skill ships with the Jira and ADO walkthrough in every harness", async () => {
  const fs = await import("node:fs/promises");
  for (const path of [
    "distribution/claude-code/commands/rdlc-setup-connector.md",
    "distribution/codex/.codex/prompts/rdlc-setup-connector.md",
    "distribution/kiro/.kiro/skills/rdlc-setup-connector/SKILL.md",
    "distribution/kiro-ide/.kiro/skills/rdlc-setup-connector/SKILL.md"
  ]) {
    const body = await fs.readFile(path, "utf8");
    assert.match(body, /rdlc:integration-manager/, path);
    assert.match(body, /Microsoft\.VSTS\.Scheduling\.StoryPoints/, path);
    assert.match(body, /createmeta/, path);
    assert.match(body, /write_mode: propose/, path);
    assert.match(body, /Never place credentials/, path);
  }
  // An authored body without a matching command fails the drift check.
  const stray = "core/commands/bodies/nonexistent.md";
  await fs.writeFile(stray, "orphan", "utf8");
  try {
    const { execFileSync } = await import("node:child_process");
    assert.throws(() => execFileSync("node", ["scripts/generate-distribution.mjs", "--check"], { stdio: "pipe" }), (error) => error.status === 1);
  } finally {
    await fs.rm(stray);
  }
});
