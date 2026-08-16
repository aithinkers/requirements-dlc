import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EngagementError,
  SCOPE_PROFILES,
  STAGE_STATES,
  checkpoint,
  createEngagement,
  loadEngagement,
  recordApplyResults,
  resumeOptions,
  setStage,
  statusSummary
} from "../../core/lib/engagement.mjs";
import { mintIdentity } from "../../core/lib/identity.mjs";

const actor = mintIdentity();
const base = { project: "checkout", space: "commerce", scope: "standard", host: "claude-code", session: "s-1", actor, at: "2026-08-15T23:00:00.000Z" };

test("FEAT-011: engagements require identity fields and a known scope profile (§15.1, §34.1)", () => {
  assert.equal(SCOPE_PROFILES.length, 7);
  assert.throws(() => createEngagement({ ...base, scope: "yolo" }), EngagementError);
  assert.throws(() => createEngagement({ ...base, session: undefined }), EngagementError);
  const state = createEngagement(base);
  assert.match(state.engagement, /^urn:uuid:/);
  assert.equal(state.phase, "0-initialize");
});

test("FEAT-011: stage states follow §34.2 and unknown states fail closed", () => {
  assert.equal(STAGE_STATES.length, 9);
  const state = createEngagement(base);
  const staged = setStage(state, "requirement-drafting", "in-progress", { actor, at: "t" });
  assert.equal(staged.stages["requirement-drafting"].state, "in-progress");
  assert.equal(staged.active_stage, "requirement-drafting");
  assert.throws(() => setStage(state, "x", "paused", { actor, at: "t" }), EngagementError);
});

test("FEAT-011: checkpoints are atomic and verified by the recovery breadcrumb (§34.3)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rdlc-"));
  const state = createEngagement(base);
  await checkpoint(state, directory, { at: "2026-08-15T23:01:00.000Z" });
  const loaded = await loadEngagement(directory);
  assert.equal(loaded.verified, true);
  assert.equal(loaded.state.last_safe_checkpoint, "2026-08-15T23:01:00.000Z");
  assert.equal(loaded.breadcrumb.next_action, state.next_action);
});

test("FEAT-011: a corrupted or interrupted update is detected (§34.3)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rdlc-"));
  const state = createEngagement(base);
  await checkpoint(state, directory, { at: "t" });
  // Simulate a torn write / tamper after the checkpoint.
  const path = join(directory, "rdlc-state.yaml");
  await writeFile(path, (await readFile(path, "utf8")).replace("checkout", "tampered"), "utf8");
  await assert.rejects(loadEngagement(directory), /does not match its recovery breadcrumb/);
});

test("FEAT-011: resume options and status summary derive from files alone (§34.4)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rdlc-"));
  let state = createEngagement(base);
  state = setStage(state, "intent-framing", "completed", { actor, at: "t1" });
  state = setStage(state, "requirement-drafting", "awaiting-user", { actor, at: "t2" });
  state = { ...state, pending_decision: "confirm requirement REQ-1 statement", next_action: "answer the pending question" };
  await checkpoint(state, directory, { at: "t3" });

  const { state: reloaded } = await loadEngagement(directory);
  const options = resumeOptions(reloaded);
  assert.deepEqual(options.map((entry) => entry.option), ["resume-last-checkpoint", "redo-current-stage", "jump-to-stage", "new-engagement"]);
  assert.equal(options[1].stage, "requirement-drafting");
  assert.deepEqual(options[2].stages, ["intent-framing"]);

  const summary = statusSummary(reloaded, { findings: [{ status: "open" }, { status: "resolved" }] });
  assert.deepEqual(summary.completed_stages, ["intent-framing"]);
  assert.equal(summary.pending_user_input, "confirm requirement REQ-1 statement");
  assert.equal(summary.open_findings, 1);
  assert.equal(summary.next_action, "answer the pending question");
});

test("FEAT-011: a resumed session never duplicates verified external writes (§34.3, §46 step 11)", () => {
  let state = createEngagement(base);
  const changeset = mintIdentity();
  state = recordApplyResults(state, changeset, {
    "op-001": { status: "verified", receipt: { id: "r-1" } },
    "op-002": { status: "uncertain" }
  }, { actor, at: "t" });
  assert.deepEqual(state.receipts, ["r-1"]);
  assert.deepEqual(state.uncertain_writes, [{ changeset, operation_id: "op-002" }]);
  // After reconciliation the uncertain write resolves and is not duplicated.
  state = recordApplyResults(state, changeset, {
    "op-001": { status: "verified", receipt: { id: "r-1" } },
    "op-002": { status: "verified", receipt: { id: "r-2" } }
  }, { actor, at: "t2" });
  assert.deepEqual(state.uncertain_writes, []);
  assert.ok(state.verified_operations[changeset]["op-001"]);
});

test("FEAT-011: the generated Claude Code distribution passes the drift check and rejects tampering (§36)", async () => {
  execFileSync("node", ["scripts/generate-distribution.mjs", "--check"], { stdio: "pipe" });
  const target = "distribution/claude-code/commands/rdlc-status.md";
  const original = await readFile(target, "utf8");
  try {
    await writeFile(target, original + "\nhand edit\n", "utf8");
    assert.throws(
      () => execFileSync("node", ["scripts/generate-distribution.mjs", "--check"], { stdio: "pipe" }),
      (error) => error.status === 1
    );
  } finally {
    await writeFile(target, original, "utf8");
  }
});

test("FEAT-011: the distribution covers the full §37 command set with mutation guards", async () => {
  const core = JSON.parse(await readFile("core/commands/commands.json", "utf8"));
  assert.equal(core.commands.length, 27);
  const sync = await readFile("distribution/claude-code/commands/rdlc-sync.md", "utf8");
  assert.match(sync, /present the exact connection, organization, project, items, operations, and write policy/);
  const status = await readFile("distribution/claude-code/commands/rdlc-status.md", "utf8");
  assert.match(status, /GENERATED from core\/commands\/commands.json/);
  assert.match(status, /untrusted data/);
});

test("FEAT-011: receipts never duplicate on reconciliation re-reporting (review MEDIUM)", () => {
  let state = createEngagement(base);
  const changeset = mintIdentity();
  const results = { "op-001": { status: "verified", receipt: { id: "r-1" } } };
  state = recordApplyResults(state, changeset, results, { actor, at: "t" });
  state = recordApplyResults(state, changeset, results, { actor, at: "t2" });
  assert.deepEqual(state.receipts, ["r-1"]);
});

test("FEAT-011: a crash between breadcrumb and state renames is reported as interrupted, pointing forward (review LOW)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rdlc-"));
  let state = createEngagement(base);
  await checkpoint(state, directory, { at: "2026-08-15T23:01:00.000Z" });
  // Simulate the crash window: newer breadcrumb written, state rename lost.
  const next = { ...state, next_action: "apply changeset CS-1" };
  const { canonicalBytes, sourceHash } = await import("../../core/lib/canonical.mjs");
  const YAML = (await import("yaml")).default;
  const stamped = { ...next, last_safe_checkpoint: "2026-08-15T23:05:00.000Z" };
  await writeFile(join(directory, "recovery.yaml"), YAML.stringify({
    schema_version: "rdlc.recovery/v0.2",
    engagement: stamped.engagement,
    state_hash: sourceHash(canonicalBytes({ state: stamped })).hash,
    next_action: stamped.next_action,
    checkpointed_at: "2026-08-15T23:05:00.000Z"
  }), "utf8");
  await assert.rejects(loadEngagement(directory), /interrupted checkpoint is suspected.*apply changeset CS-1/);
});

test("FEAT-012: all ten §38 role lenses generate as agents with the untrusted-content and proposal rules", async () => {
  const roles = JSON.parse(await readFile("core/roles/roles.json", "utf8"));
  assert.equal(roles.roles.length, 10);
  const expected = ["facilitator", "business-analyst", "product-owner", "portfolio-analyst", "requirements-reviewer", "traceability-auditor", "test-designer", "integration-manager", "compliance-reviewer", "delivery-planner"];
  assert.deepEqual(roles.roles.map((role) => role.id), expected);
  for (const role of expected) {
    const body = await readFile(`distribution/claude-code/agents/rdlc-${role}.md`, "utf8");
    assert.match(body, /GENERATED from core\/roles\/roles.json/);
    assert.match(body, /untrusted data/);
    assert.match(body, /remains a proposal until integrated and gated/);
    assert.match(body, /never set\napproved, baselined, or waived/);
  }
});

test("FEAT-012: the plugin manifest points at generated agents and commands and is drift-protected", async () => {
  const manifest = JSON.parse(await readFile("distribution/claude-code/.claude-plugin/plugin.json", "utf8"));
  assert.equal(manifest.name, "rdlc");
  assert.equal(manifest.agents, "./agents");
  assert.equal(manifest.commands, "./commands");
  const target = "distribution/claude-code/agents/rdlc-facilitator.md";
  const original = await readFile(target, "utf8");
  try {
    await writeFile(target, original + "edit\n", "utf8");
    assert.throws(
      () => execFileSync("node", ["scripts/generate-distribution.mjs", "--check"], { stdio: "pipe" }),
      (error) => error.status === 1
    );
  } finally {
    await writeFile(target, original, "utf8");
  }
});

test("FEAT-013: setup installs the plugin and scaffold idempotently and protects user edits", async () => {
  const { runSetup } = await import("../../scripts/setup.mjs");
  const target = await mkdtemp(join(tmpdir(), "rdlc-setup-"));
  const quiet = () => {};

  const first = await runSetup({ target, log: quiet });
  assert.ok(first.installed.includes("requirements-project.yaml"));
  assert.ok(first.installed.includes(join(".claude", "commands", "rdlc-start.md")), "commands land where Claude Code discovers them");
  assert.ok(first.installed.includes(join(".claude", "agents", "rdlc-facilitator.md")), "agents land where Claude Code discovers them");
  assert.ok(!first.installed.some((file) => file.includes(join(".claude", "plugins"))), "no undiscovered plugins/ path (issue #34)");
  assert.ok(first.scaffolded.includes("rdlc/spaces/main/engagements"));
  const manifest = await readFile(join(target, "requirements-project.yaml"), "utf8");
  assert.match(manifest, /authority_mode: files-authoritative/);
  assert.match(manifest, /external_content: untrusted/);

  // Idempotent: a second run changes nothing.
  const second = await runSetup({ target, log: quiet });
  assert.equal(second.installed.length, 0);
  assert.equal(second.scaffolded.length, 0);
  assert.equal((await runSetup({ target, check: true, log: quiet })).drift.length, 0);

  // User-modified files are protected without --force.
  await writeFile(join(target, "requirements-project.yaml"), manifest + "# my edit\n", "utf8");
  const third = await runSetup({ target, log: quiet });
  assert.deepEqual(third.protected, ["requirements-project.yaml"]);
  assert.match(await readFile(join(target, "requirements-project.yaml"), "utf8"), /# my edit/);
  const forced = await runSetup({ target, force: true, log: quiet });
  assert.deepEqual(forced.installed, ["requirements-project.yaml"]);
  await assert.rejects(runSetup({ target: join(target, "missing"), log: quiet }), /does not exist/);
});

test("FEAT-014: setup migrates the undiscovered 0.1.1 layout and the marketplace manifest resolves the plugin", async () => {
  const { runSetup } = await import("../../scripts/setup.mjs");
  const quiet = () => {};
  const target = await mkdtemp(join(tmpdir(), "rdlc-migrate-"));
  // Simulate a 0.1.1 install.
  const legacy = join(target, ".claude", "plugins", "rdlc", "commands");
  await (await import("node:fs/promises")).mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "rdlc-start.md"), "legacy", "utf8");

  const result = await runSetup({ target, log: quiet });
  assert.match(result.migrated, /\.claude\/plugins\/rdlc$/);
  await assert.rejects(readFile(join(legacy, "rdlc-start.md")), undefined, "legacy copy removed");
  const discovered = await readFile(join(target, ".claude", "commands", "rdlc-start.md"), "utf8");
  assert.match(discovered, /rdlc-start/);
  const agents = await (await import("node:fs/promises")).readdir(join(target, ".claude", "agents"));
  assert.equal(agents.length, 10);

  const marketplace = JSON.parse(await readFile(".claude-plugin/marketplace.json", "utf8"));
  assert.equal(marketplace.plugins[0].name, "rdlc");
  assert.equal(marketplace.plugins[0].source, "./distribution/claude-code");
  const plugin = JSON.parse(await readFile("distribution/claude-code/.claude-plugin/plugin.json", "utf8"));
  assert.equal(plugin.name, "rdlc");
});

test("FEAT-015: codex and kiro distributions generate from the same core with intact guarantees", async () => {
  const { readdir } = await import("node:fs/promises");
  assert.equal((await readdir("distribution/codex/.codex/prompts")).length, 27);
  assert.equal((await readdir("distribution/codex/.codex/agents")).length, 20, "md + toml per role");
  for (const host of ["kiro", "kiro-ide"]) {
    assert.equal((await readdir(`distribution/${host}/.kiro/skills`)).length, 27);
    assert.equal((await readdir(`distribution/${host}/.kiro/agents`)).length, 20, "md + json per role");
  }
  const codexAgent = await readFile("distribution/codex/.codex/agents/rdlc-facilitator.md", "utf8");
  assert.match(codexAgent, /untrusted data/);
  assert.match(codexAgent, /remains a proposal until integrated and gated/);
  const toml = await readFile("distribution/codex/.codex/agents/rdlc-facilitator.toml", "utf8");
  assert.match(toml, /^name = "rdlc-facilitator"/m);
  const kiroSkill = await readFile("distribution/kiro/.kiro/skills/rdlc-sync/SKILL.md", "utf8");
  assert.match(kiroSkill, /present the exact connection, organization, project, items, operations, and write policy/);
  const ideSkill = await readFile("distribution/kiro-ide/.kiro/skills/rdlc-sync/SKILL.md", "utf8");
  assert.match(ideSkill, /Kiro IDE/, "separate adapter, identical semantics (§36)");
  const manifest = JSON.parse(await readFile("distribution/kiro/.kiro/agents/rdlc-facilitator.json", "utf8"));
  assert.equal(manifest.prompt, "rdlc-facilitator.md");
});

test("FEAT-015: setup installs codex and kiro surfaces with the same semantics", async () => {
  const { runSetup } = await import("../../scripts/setup.mjs");
  const quiet = () => {};
  const target = await mkdtemp(join(tmpdir(), "rdlc-hosts-"));
  const codex = await runSetup({ target, tool: "codex", log: quiet });
  assert.ok(codex.installed.includes(join(".codex", "prompts", "rdlc-start.md")));
  assert.ok(codex.installed.includes(join(".codex", "agents", "rdlc-facilitator.toml")));
  const kiro = await runSetup({ target, tool: "kiro-ide", log: quiet });
  assert.ok(kiro.installed.includes(join(".kiro", "skills", "rdlc-start", "SKILL.md")));
  // Idempotence per tool; unknown tools fail closed.
  assert.equal((await runSetup({ target, tool: "codex", log: quiet })).installed.length, 0);
  await assert.rejects(runSetup({ target, tool: "cursor", log: quiet }), /unknown tool/);
});

test("FEAT-019: the stage graph covers every §15 phase with leads, conditions, and scope applicability", async () => {
  const graph = JSON.parse(await readFile("core/stages/stages.json", "utf8"));
  assert.ok(graph.stages.length >= 28);
  const phases = new Set(graph.stages.map((stage) => stage.phase));
  for (const phase of ["0-initialize", "1-frame", "2-discover", "3-model", "4-define", "5-plan", "6-validate", "7-govern", "8-synchronize", "9-verify", "10-evolve"]) {
    assert.ok(phases.has(phase), phase);
  }
  const roles = JSON.parse(await readFile("core/roles/roles.json", "utf8")).roles.map((role) => role.id);
  for (const stage of graph.stages) {
    assert.ok(["ALWAYS", "CONDITIONAL"].includes(stage.condition), stage.slug);
    assert.ok(roles.includes(stage.lead_role), `${stage.slug} lead ${stage.lead_role}`);
    assert.ok(stage.produces.length > 0, stage.slug);
    if (stage.condition === "ALWAYS") assert.equal(stage.scopes, null, `${stage.slug} ALWAYS stages apply to all scopes`);
  }
  // Every ALWAYS stage from the spec's table is present.
  const always = graph.stages.filter((stage) => stage.condition === "ALWAYS").map((stage) => stage.slug);
  for (const slug of ["workspace-detection", "scope-selection", "intent-framing", "requirement-drafting", "schema-template-validation", "semantic-review", "trace-coverage-review", "comment-resolution", "readiness-approval"]) {
    assert.ok(always.includes(slug), slug);
  }
});

test("FEAT-019: scope profiles author stage inclusion consistently with the graph", async () => {
  const { readdir } = await import("node:fs/promises");
  const graph = JSON.parse(await readFile("core/stages/stages.json", "utf8"));
  const scopes = (await readdir("core/scopes")).map((name) => name.replace(".md", ""));
  assert.deepEqual(scopes.sort(), ["audit", "change", "migration", "portfolio", "quick", "regulated", "standard"]);
  for (const scope of scopes) {
    const body = await readFile(`core/scopes/${scope}.md`, "utf8");
    for (const stage of graph.stages) {
      const included = stage.condition === "ALWAYS" || (stage.scopes && stage.scopes.includes(scope));
      assert.equal(body.includes(`- ${stage.slug}`), included, `${scope}: ${stage.slug}`);
    }
  }
  const quick = await readFile("core/scopes/quick.md", "utf8");
  assert.match(quick, /recorded reason/, "trim rationale present");
});

test("FEAT-019: agents carry full personas with stage ownership in every harness", async () => {
  for (const path of [
    "distribution/claude-code/agents/rdlc-business-analyst.md",
    "distribution/codex/.codex/agents/rdlc-business-analyst.md",
    "distribution/kiro/.kiro/agents/rdlc-business-analyst.md"
  ]) {
    const body = await readFile(path, "utf8");
    assert.match(body, /## Stages owned/, path);
    assert.match(body, /## Responsibilities/, path);
    assert.match(body, /## Working discipline/, path);
    assert.match(body, /never an invented value/, path);
  }
  const facilitator = await readFile("distribution/claude-code/agents/rdlc-facilitator.md", "utf8");
  assert.match(facilitator, /## Example/);
  // Orphan personas fail the drift check.
  const fs = await import("node:fs/promises");
  await fs.writeFile("core/roles/bodies/nonexistent.md", "orphan", "utf8");
  try {
    assert.throws(() => execFileSync("node", ["scripts/generate-distribution.mjs", "--check"], { stdio: "pipe" }), (error) => error.status === 1);
  } finally {
    await fs.rm("core/roles/bodies/nonexistent.md");
  }
});

test("FEAT-019: core commands ship procedural bodies and the reference tree installs (§36)", async () => {
  for (const verb of ["start", "capture", "triage", "draft", "promote", "discover", "review", "readiness", "sync", "status"]) {
    const body = await readFile(`distribution/claude-code/commands/rdlc-${verb}.md`, "utf8");
    assert.match(body, /## Procedure/, verb);
    assert.ok(body.length > 800, `${verb} body is substantive (${body.length})`);
  }
  const start = await readFile("distribution/claude-code/commands/rdlc-start.md", "utf8");
  assert.match(start, /rdlc\/reference\/stage-protocol\.md/);

  const { runSetup } = await import("../../scripts/setup.mjs");
  const target = await mkdtemp(join(tmpdir(), "rdlc-ref-"));
  await runSetup({ target, log: () => {} });
  assert.match(await readFile(join(target, "rdlc", "reference", "stage-protocol.md"), "utf8"), /R-DLC stage protocol/);
  const stages = JSON.parse(await readFile(join(target, "rdlc", "reference", "stages.json"), "utf8"));
  assert.ok(stages.stages.length >= 28);
  const scopes = await (await import("node:fs/promises")).readdir(join(target, "rdlc", "reference", "scopes"));
  assert.equal(scopes.length, 7);
  // Kiro installs carry the reference tree too.
  const kiroTarget = await mkdtemp(join(tmpdir(), "rdlc-ref-kiro-"));
  await runSetup({ target: kiroTarget, tool: "kiro", log: () => {} });
  assert.match(await readFile(join(kiroTarget, "rdlc", "reference", "stage-protocol.md"), "utf8"), /R-DLC stage protocol/);
});
