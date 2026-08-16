/**
 * Persistent engagement state, checkpoints, and resume (spec §34).
 *
 * Workflow state lives in the engagement record, never only in a chat.
 * Checkpoints are atomic (temp-file + rename) and paired with an independent
 * recovery breadcrumb so corruption or an interrupted update is detectable.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import YAML from "yaml";

import { canonicalBytes, sourceHash } from "./canonical.mjs";
import { mintIdentity } from "./identity.mjs";

export class EngagementError extends Error {
  constructor(message, category = "state-corruption-suspected") {
    super(message);
    this.name = "EngagementError";
    this.category = category;
  }
}

/** §34.2 core stage states. */
export const STAGE_STATES = Object.freeze([
  "not-started", "in-progress", "awaiting-user", "awaiting-approval",
  "needs-changes", "completed", "skipped", "blocked", "failed-recoverable"
]);

/** §15 scope profiles. */
export const SCOPE_PROFILES = Object.freeze(["quick", "standard", "portfolio", "regulated", "audit", "migration", "change"]);

/** Create a new engagement state record (§34.1). */
export function createEngagement({ project, space, scope, host, session, actor, at }) {
  if (!SCOPE_PROFILES.includes(scope)) throw new EngagementError(`unknown scope profile: ${scope}`, "validation-failure");
  for (const [field, value] of Object.entries({ project, space, host, session, actor, at })) {
    if (!value) throw new EngagementError(`an engagement requires ${field}`, "validation-failure");
  }
  return {
    schema_version: "rdlc.state/v0.2",
    engagement: mintIdentity(),
    project,
    space,
    scope,
    phase: "0-initialize",
    active_stage: "workspace-detection",
    stages: {},
    current_artifact: null,
    pending_decision: null,
    last_safe_checkpoint: null,
    next_action: "run workspace and connector detection",
    artifact_versions: {},
    open_gates: [],
    approval_packages: [],
    changesets: [],
    receipts: [],
    uncertain_writes: [],
    sync_cursors: {},
    host,
    session,
    updated_by: actor,
    updated_at: at
  };
}

/** §34.2 — set a stage state; unknown states fail closed. */
export function setStage(state, stage, stageState, { actor, at, reason = null }) {
  if (!STAGE_STATES.includes(stageState)) throw new EngagementError(`unknown stage state: ${stageState}`, "validation-failure");
  return {
    ...state,
    stages: { ...state.stages, [stage]: { state: stageState, reason, at } },
    active_stage: stageState === "completed" ? state.active_stage : stage,
    updated_by: actor,
    updated_at: at
  };
}

function stateHash(state) {
  return sourceHash(canonicalBytes({ state })).hash;
}

/**
 * §34.3 — atomic checkpoint via temp+rename with an independently comparable
 * recovery breadcrumb. The breadcrumb is renamed BEFORE the state file: a
 * crash between the two renames leaves a new breadcrumb with the old state,
 * which loadEngagement reports as an interrupted update pointing forward to
 * the recorded next action — never a silently torn state.
 */
export async function checkpoint(state, directory, { at }) {
  const stamped = { ...state, last_safe_checkpoint: at };
  const hash = stateHash(stamped);
  const breadcrumb = {
    schema_version: "rdlc.recovery/v0.2",
    engagement: stamped.engagement,
    state_hash: hash,
    next_action: stamped.next_action,
    checkpointed_at: at
  };
  const breadcrumbTemporary = join(directory, ".recovery.yaml.tmp");
  await writeFile(breadcrumbTemporary, YAML.stringify(breadcrumb), "utf8");
  await rename(breadcrumbTemporary, join(directory, "recovery.yaml"));
  const temporary = join(directory, ".rdlc-state.yaml.tmp");
  await writeFile(temporary, YAML.stringify(stamped), "utf8");
  await rename(temporary, join(directory, "rdlc-state.yaml"));
  return { state: stamped, breadcrumb };
}

/** Load state and verify it against the recovery breadcrumb (§34.3). */
export async function loadEngagement(directory) {
  let state;
  let breadcrumb;
  try {
    state = YAML.parse(await readFile(join(directory, "rdlc-state.yaml"), "utf8"));
  } catch (error) {
    throw new EngagementError(`engagement state cannot be read: ${error.message}`);
  }
  try {
    breadcrumb = YAML.parse(await readFile(join(directory, "recovery.yaml"), "utf8"));
  } catch {
    return { state, breadcrumb: null, verified: false, warning: "recovery breadcrumb missing; treat state as unverified (§34.3)" };
  }
  const verified = stateHash(state) === breadcrumb.state_hash && state.engagement === breadcrumb.engagement;
  if (!verified) {
    const interrupted = state.engagement === breadcrumb.engagement
      && String(breadcrumb.checkpointed_at) > String(state.last_safe_checkpoint ?? "");
    throw new EngagementError(
      interrupted
        ? `an interrupted checkpoint is suspected; the recovery breadcrumb points to next action "${breadcrumb.next_action}" (§34.3)`
        : "engagement state does not match its recovery breadcrumb; corruption or an interrupted update is suspected (§34.3)"
    );
  }
  return { state, breadcrumb, verified: true };
}

/** §34.4 — resume options when an engagement exists. */
export function resumeOptions(state) {
  const jumpable = Object.entries(state.stages)
    .filter(([, entry]) => ["completed", "needs-changes"].includes(entry.state))
    .map(([stage]) => stage);
  return [
    { option: "resume-last-checkpoint", detail: state.next_action, checkpoint: state.last_safe_checkpoint },
    { option: "redo-current-stage", stage: state.active_stage },
    { option: "jump-to-stage", stages: jumpable },
    { option: "new-engagement", detail: "start a new engagement alongside the existing one" }
  ];
}

/** §34.4 — status summary derived from durable files alone. */
export function statusSummary(state, { findings = [] } = {}) {
  return {
    engagement: state.engagement,
    scope: state.scope,
    phase: state.phase,
    completed_stages: Object.entries(state.stages).filter(([, entry]) => entry.state === "completed").map(([stage]) => stage),
    current_gate: state.open_gates[0] ?? null,
    pending_user_input: state.pending_decision,
    open_findings: findings.filter((finding) => finding.status === "open").length,
    unverified_external_writes: state.uncertain_writes.length,
    next_action: state.next_action
  };
}

/**
 * §34.3/§29.5 — merge connector apply results into durable state so a resumed
 * session never duplicates verified operations.
 */
export function recordApplyResults(state, changesetId, results, { actor, at }) {
  const uncertain = Object.entries(results)
    .filter(([, entry]) => entry.status === "uncertain")
    .map(([operationId]) => ({ changeset: changesetId, operation_id: operationId }));
  const receipts = Object.values(results)
    .filter((entry) => entry.status === "verified")
    .map((entry) => entry.receipt.id);
  return {
    ...state,
    receipts: [...new Set([...state.receipts, ...receipts])],
    uncertain_writes: [
      ...state.uncertain_writes.filter((entry) => entry.changeset !== changesetId),
      ...uncertain
    ],
    verified_operations: {
      ...(state.verified_operations ?? {}),
      [changesetId]: Object.fromEntries(Object.entries(results).filter(([, entry]) => entry.status === "verified"))
    },
    updated_by: actor,
    updated_at: at
  };
}
