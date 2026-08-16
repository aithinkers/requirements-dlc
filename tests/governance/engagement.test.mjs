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
  const target = "dist/claude-code/commands/rdlc-status.md";
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
  assert.equal(core.commands.length, 26);
  const sync = await readFile("dist/claude-code/commands/rdlc-sync.md", "utf8");
  assert.match(sync, /present the exact connection, organization, project, items, operations, and write policy/);
  const status = await readFile("dist/claude-code/commands/rdlc-status.md", "utf8");
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
