/**
 * R-DLC lifecycle state machines (spec §14).
 *
 * Four independent dimensions — governance, synchronization, verification
 * progress, verification outcome — with exact transition tables, transition
 * audit records, the default materiality policy (§14.5), approval
 * invalidation (§27.7), and the human approval floor (§14.6).
 */

export class LifecycleError extends Error {
  constructor(message) {
    super(message);
    this.name = "LifecycleError";
  }
}

/** §14.2 — only transitions in this table are valid. */
export const GOVERNANCE_TRANSITIONS = Object.freeze({
  "captured": ["triaged", "withdrawn"],
  "triaged": ["working", "draft", "needs-clarification", "deferred", "rejected"],
  "working": ["draft", "collision-review", "needs-clarification", "withdrawn"],
  "collision-review": ["working", "draft", "withdrawn"],
  "needs-clarification": ["deferred", "withdrawn"], // plus the recorded return_state, resolved at runtime
  "draft": ["working", "reviewed", "needs-clarification", "deferred", "withdrawn"],
  "reviewed": ["draft", "ready-for-approval", "needs-clarification", "deferred"],
  "ready-for-approval": ["draft", "awaiting-approval"],
  "awaiting-approval": ["approved", "draft", "rejected", "deferred"],
  "approved": ["baselined", "superseded", "retired"],
  "baselined": ["superseded", "retired"],
  "deferred": ["working", "draft", "withdrawn"],
  "rejected": ["working", "withdrawn"],
  "superseded": [],
  "retired": [],
  "withdrawn": []
});

/** §14.3 — synchronization transitions. */
export const SYNCHRONIZATION_TRANSITIONS = Object.freeze({
  "not-synchronized": ["planned"],
  "planned": ["applying", "not-synchronized"],
  "applying": ["synchronized", "failed", "uncertain"],
  "synchronized": ["drifted", "planned"],
  "drifted": ["planned"],
  "failed": ["planned"],
  "uncertain": ["synchronized", "planned", "failed"]
});

/** §14.1 — verification progress is strictly forward. */
export const VERIFICATION_PROGRESS_ORDER = Object.freeze([
  "not-designed", "designed", "reviewed", "implemented", "executed"
]);

export const VERIFICATION_OUTCOMES = Object.freeze([
  "none", "passed", "failed", "blocked", "inconclusive", "waived"
]);

const AI_FORBIDDEN_GOVERNANCE = Object.freeze(["approved", "baselined"]);

function requireContext(context) {
  for (const field of ["actor", "actorKind", "reason", "policyVersion", "contentHash"]) {
    if (!context?.[field]) throw new LifecycleError(`transition context requires ${field}`);
  }
  if (!["human", "ai", "deterministic-automation"].includes(context.actorKind)) {
    throw new LifecycleError(`unknown actor kind: ${context.actorKind}`);
  }
}

function auditRecord(dimension, from, to, artifact, context) {
  return Object.freeze({
    dimension,
    from,
    to,
    artifact: artifact.id,
    prior_version: artifact.version,
    resulting_version: artifact.version,
    content_hash: context.contentHash,
    policy_version: context.policyVersion,
    actor: context.actor,
    actor_kind: context.actorKind,
    reason: context.reason,
    at: context.at ?? new Date().toISOString()
  });
}

/**
 * Perform a governance transition (§14.2). Returns { artifact, audit }.
 * The input artifact is never mutated; approved/baselined revisions stay
 * immutable — material changes go through createRevision() instead.
 */
export function transitionGovernance(artifact, to, context) {
  requireContext(context);
  const from = artifact.governance_state;
  const allowed = GOVERNANCE_TRANSITIONS[from];
  if (!allowed) throw new LifecycleError(`unknown governance state: ${from}`);

  let permitted = allowed.includes(to);
  if (from === "needs-clarification" && to === artifact.return_state) permitted = true;
  if (!permitted) throw new LifecycleError(`invalid governance transition: ${from} -> ${to}`);

  if (AI_FORBIDDEN_GOVERNANCE.includes(to) && context.actorKind === "ai") {
    throw new LifecycleError(`an AI actor must not set governance state ${to} (§14.6)`);
  }
  if (to === "approved" && context.actorKind === "deterministic-automation" && !context.automationPolicy) {
    throw new LifecycleError("automated approval requires a visible automation policy (§14.6)");
  }

  const next = { ...artifact, governance_state: to };
  if (to === "needs-clarification") next.return_state = from;
  else delete next.return_state;
  return { artifact: next, audit: auditRecord("governance", from, to, artifact, context) };
}

/** Perform a synchronization transition (§14.3). */
export function transitionSynchronization(artifact, to, context) {
  requireContext(context);
  const from = artifact.synchronization_state ?? "not-synchronized";
  const allowed = SYNCHRONIZATION_TRANSITIONS[from];
  if (!allowed) throw new LifecycleError(`unknown synchronization state: ${from}`);
  if (!allowed.includes(to)) throw new LifecycleError(`invalid synchronization transition: ${from} -> ${to}`);
  if (["synchronized"].includes(to) && from === "applying" && !context.readbackHash) {
    throw new LifecycleError("synchronized requires verified read-back evidence (§29.1)");
  }
  return {
    artifact: { ...artifact, synchronization_state: to },
    audit: auditRecord("synchronization", from, to, artifact, context)
  };
}

/** Advance verification progress; `executed` requires execution evidence (§14.3). */
export function transitionVerificationProgress(artifact, to, context) {
  requireContext(context);
  const from = artifact.verification_progress ?? "not-designed";
  const fromIndex = VERIFICATION_PROGRESS_ORDER.indexOf(from);
  const toIndex = VERIFICATION_PROGRESS_ORDER.indexOf(to);
  if (toIndex === -1) throw new LifecycleError(`unknown verification progress: ${to}`);
  if (toIndex !== fromIndex + 1) {
    throw new LifecycleError(`invalid verification progress transition: ${from} -> ${to}`);
  }
  if (to === "executed" && !context.executionEvidence) {
    throw new LifecycleError("executed requires execution evidence (§14.3, §14.6)");
  }
  return {
    artifact: { ...artifact, verification_progress: to },
    audit: auditRecord("verification-progress", from, to, artifact, context)
  };
}

/**
 * Derive a verification outcome from execution evidence under a versioned
 * result mapping, or record an authorized human waiver (§14.3, §14.6).
 */
export function setVerificationOutcome(artifact, outcome, context) {
  requireContext(context);
  if (!VERIFICATION_OUTCOMES.includes(outcome)) throw new LifecycleError(`unknown outcome: ${outcome}`);
  if (outcome === "waived") {
    if (context.actorKind !== "human" || !context.waiver) {
      throw new LifecycleError("waived requires an authorized human waiver (§14.6)");
    }
  } else if (outcome !== "none") {
    if (!context.executionEvidence || !context.resultMappingVersion) {
      throw new LifecycleError(`${outcome} requires execution evidence under a versioned result mapping`);
    }
    if (artifact.verification_progress !== "executed") {
      throw new LifecycleError("an outcome requires executed verification progress");
    }
  }
  return {
    artifact: { ...artifact, verification_outcome: outcome },
    audit: auditRecord("verification-outcome", artifact.verification_outcome ?? "none", outcome, artifact, context)
  };
}

/** §14.5 default materiality policy. */
const MATERIAL_FIELDS = Object.freeze([
  "type", "statement", "scope", "actor", "outcome", "rationale",
  "business_rule", "constraint", "assumption", "acceptance_criteria", "nfr",
  "applicability", "priority", "completion_condition", "sources",
  "required_approvers", "approval_policy", "waiver", "security_classification",
  "privacy_handling", "retention", "release_boundary", "estimate", "owner"
]);
const NON_MATERIAL_FIELDS = Object.freeze([
  "whitespace", "rendering", "spelling", "file_path", "display_id",
  "generated_timestamps", "sync_receipts", "derived_reports",
  "created_at", "updated_at"
]);
const MATERIAL_RELATIONSHIPS = Object.freeze([
  "decomposes", "satisfies", "implements", "tested-by", "depends-on", "blocks",
  "conflicts-with", "supersedes", "mitigates", "resolves", "approves",
  "affects", "owned-by"
]);

/**
 * Classify a change (§14.5). Unclassified changes are material by default.
 * A narrowing policy must name the field and provide a reviewable rationale.
 */
export function isMaterialChange({ changedFields = [], changedRelationships = [] }, policy) {
  for (const relationship of changedRelationships) {
    if (MATERIAL_RELATIONSHIPS.includes(relationship)) return { material: true, cause: `relationship:${relationship}` };
  }
  for (const field of changedFields) {
    const narrowed = policy?.nonMaterial?.find((entry) => entry.field === field);
    if (narrowed) {
      if (!narrowed.rationale || !policy.authority || !policy.version) {
        throw new LifecycleError(`narrowing policy for ${field} requires authority, version, and rationale (§27.7)`);
      }
      continue;
    }
    if (MATERIAL_FIELDS.includes(field)) return { material: true, cause: `field:${field}` };
    if (!NON_MATERIAL_FIELDS.includes(field)) return { material: true, cause: `unclassified:${field}` };
  }
  return { material: false, cause: null };
}

/**
 * Apply a material change: a new working revision is created, the prior
 * approved/baselined revision stays immutable, and affected current
 * approvals are invalidated without erasing historical evidence (§14.5, §27.7).
 */
export function createRevision(artifact, { changedFields = [], changedRelationships = [], approvals = [] }, context) {
  requireContext(context);
  const classification = isMaterialChange({ changedFields, changedRelationships }, context.materialityPolicy);
  if (!classification.material) {
    throw new LifecycleError("non-material changes amend in place; a new revision requires a material change (§14.5)");
  }
  const frozen = Object.freeze({ ...artifact });
  const revision = {
    ...artifact,
    version: artifact.version + 1,
    governance_state: "working",
    verification_outcome: "none"
  };
  delete revision.return_state;
  const invalidatedApprovals = approvals.map((approval) =>
    approval.artifact === artifact.id && approval.status === "current"
      ? { ...approval, status: "invalidated", invalidated_by: classification.cause, invalidated_at: context.at ?? new Date().toISOString() }
      : approval
  );
  return {
    priorRevision: frozen,
    revision,
    approvals: invalidatedApprovals,
    impact: { cause: classification.cause, requires: ["impact-analysis", "new-content-hash", "new-review-package"] },
    audit: auditRecord("governance", artifact.governance_state, "working", artifact, context)
  };
}
