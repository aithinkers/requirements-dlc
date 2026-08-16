/**
 * Identity registry, approvals, baselines, and redaction (spec §27, §41.1).
 *
 * Approval decisions bind a canonical principal through a VERIFIED provider
 * binding to the exact rdlc-jcs-v1 approval-package hash. Unverified
 * identities, shared/automation accounts in human roles, stale hashes, and
 * unknown accounts never satisfy policy. Baselines are immutable; redaction
 * preserves tombstones and original hashes without rewriting history.
 */

import {
  approvalPackageHash,
  baselineRootHash,
  canonicalBytes,
  redactionAddendumHash,
  sourceHash
} from "./canonical.mjs";
import { isCanonicalIdentity, mintIdentity } from "./identity.mjs";

export class ApprovalError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApprovalError";
  }
}

const VERIFICATION_METHODS = Object.freeze([
  "authenticated-self-binding", "directory-synchronization", "administrator-attestation"
]);

/* -------------------------------------------------------- identity registry */

/** §27.2 — canonical principals with verified provider bindings. */
export class IdentityRegistry {
  #principals = new Map();

  registerPrincipal({ id = mintIdentity(), displayName, kind, roles = [] }) {
    if (!isCanonicalIdentity(id)) throw new ApprovalError("a principal requires a canonical identity");
    if (!displayName) throw new ApprovalError("a principal requires a display name");
    if (!["human", "automation"].includes(kind)) throw new ApprovalError(`unknown principal kind: ${kind}`);
    const principal = { schema_version: "rdlc.principal/v0.2", id, display_name: displayName, kind, status: "active", roles: [...roles], bindings: [] };
    this.#principals.set(id, principal);
    return principal;
  }

  get(id) {
    const principal = this.#principals.get(id);
    if (!principal) throw new ApprovalError(`unknown principal: ${id}`);
    return principal;
  }

  /**
   * §27.2 — a binding is verified only through an accepted method; a manually
   * entered email or display-name match is unverified and never satisfies a
   * required human approval.
   */
  addBinding(principalId, { provider, connection, tenantId, accountId, verifiedVia, verifiedBy, verifiedAt }) {
    const principal = this.get(principalId);
    if (!provider || !connection || !accountId) throw new ApprovalError("a binding requires provider, connection, and immutable account id");
    if (!VERIFICATION_METHODS.includes(verifiedVia)) {
      throw new ApprovalError(`unaccepted verification method: ${verifiedVia} (manual matches are unverified, §27.2)`);
    }
    if (!isCanonicalIdentity(verifiedBy)) throw new ApprovalError("a binding requires a canonical verifier");
    if (!verifiedAt) throw new ApprovalError("a binding requires a verification time");
    const binding = {
      provider, connection, tenant_id: tenantId ?? null, account_id: accountId,
      verified_via: verifiedVia, verified_by: verifiedBy, verified_at: verifiedAt, status: "verified"
    };
    principal.bindings.push(binding);
    return binding;
  }

  /** Revocation prevents future decisions but never erases history (§27.2). */
  revokeBinding(principalId, accountId, { at }) {
    const principal = this.get(principalId);
    const binding = principal.bindings.find((entry) => entry.account_id === accountId && entry.status === "verified");
    if (!binding) throw new ApprovalError(`no verified binding for account: ${accountId}`);
    binding.status = "revoked";
    binding.revoked_at = at;
    return binding;
  }

  /** Resolve an authenticated provider account to its bound principal. */
  resolveAccount({ provider, connection, accountId }) {
    for (const principal of this.#principals.values()) {
      const binding = principal.bindings.find(
        (entry) => entry.provider === provider && entry.connection === connection
          && entry.account_id === accountId && entry.status === "verified"
      );
      if (binding) return { principal, binding };
    }
    throw new ApprovalError(`no verified binding resolves ${provider}/${connection}/${accountId} (§27.2)`);
  }
}

/* -------------------------------------------------------- approval packages */

/** §27.4 — immutable, reproducible approval package with rdlc-jcs-v1 hash. */
export function buildApprovalPackage({
  artifactHashes, sourceLocks = [], kbLock = null, policyVersions, requiredApprovers,
  blockingFindings = [], waivers = [], materialDiff = null
}) {
  const projection = {
    artifact_hashes: artifactHashes,
    source_locks: sourceLocks,
    kb_lock: kbLock,
    policy_versions: policyVersions,
    required_approvers: requiredApprovers,
    blocking_findings: blockingFindings,
    waivers,
    material_diff: materialDiff
  };
  const hashed = approvalPackageHash({
    artifact_hashes: artifactHashes, source_locks: sourceLocks, kb_lock: kbLock,
    policy_versions: policyVersions, required_approvers: requiredApprovers,
    blocking_findings: blockingFindings, waivers, material_diff: materialDiff
  });
  return Object.freeze({
    schema_version: "rdlc.approval-package/v0.2",
    id: mintIdentity(),
    ...projection,
    package_hash: hashed.hash,
    hash_profile: hashed.hash_profile
  });
}

/* ------------------------------------------------------- approval decisions */

/**
 * §27.4 — a decision binds the canonical principal, its verified binding (or
 * authenticated local identity), the decision, and the exact package hash.
 */
export function recordDecision(registry, {
  provider, connection, accountId, decision, packageHash, expectedPackageHash, role, comment = null,
  authenticationContext, at
}) {
  if (!["approve", "reject", "abstain"].includes(decision)) throw new ApprovalError(`unknown decision: ${decision}`);
  if (!authenticationContext) throw new ApprovalError("a decision requires its authentication context (§27.4)");
  if (!at) throw new ApprovalError("a decision requires a timestamp (informative metadata, §27.4)");
  // §27.6/§46 step 8 — a decision against a stale or mismatched hash is rejected.
  if (!packageHash || packageHash !== expectedPackageHash) {
    throw new ApprovalError(`decision hash does not match the open approval package: ${packageHash} != ${expectedPackageHash}`);
  }
  const { principal, binding } = registry.resolveAccount({ provider, connection, accountId });
  if (principal.status !== "active") throw new ApprovalError(`principal is not active: ${principal.id}`);
  const record = {
    schema_version: "rdlc.approval-decision/v0.2",
    id: mintIdentity(),
    principal: principal.id,
    principal_kind: principal.kind,
    binding: { provider, connection, account_id: accountId },
    decision,
    package_hash: packageHash,
    role,
    comment,
    authentication_context: authenticationContext,
    at
  };
  record.decision_hash = sourceHash(canonicalBytes({ ...record, decision_hash: undefined })).hash;
  return Object.freeze(record);
}

/* --------------------------------------------------------- approval policies */

/**
 * §27.3 — evaluate a policy against recorded decisions for one package hash.
 * Supported: all-required, n-of-m, one-per-role. Human roles are satisfied
 * only by human principals (§27.2: no shared or service accounts).
 */
export function evaluatePolicy(policy, decisions, { packageHash, registry }) {
  const relevant = decisions.filter((entry) => entry.package_hash === packageHash);
  for (const entry of relevant) {
    const principal = registry.get(entry.principal);
    if (principal.kind !== "human" && !policy.automationRoles?.includes(entry.role)) {
      throw new ApprovalError(`a non-human principal cannot satisfy human role ${entry.role} (§27.2)`);
    }
  }
  const approvals = relevant.filter((entry) => entry.decision === "approve");
  const declines = relevant.filter((entry) => entry.decision === "reject");
  if (policy.declineBehavior !== "tolerate" && declines.length > 0) {
    return { satisfied: false, reason: `declined by ${declines[0].principal}` };
  }
  if (policy.kind === "all-required") {
    const approvedBy = new Set(approvals.map((entry) => entry.principal));
    const missing = policy.required.filter((principal) => !approvedBy.has(principal));
    return { satisfied: missing.length === 0, missing };
  }
  if (policy.kind === "n-of-m") {
    const eligible = new Set(policy.eligible);
    const count = new Set(approvals.filter((entry) => eligible.has(entry.principal)).map((entry) => entry.principal)).size;
    return { satisfied: count >= policy.quorum, count, quorum: policy.quorum };
  }
  if (policy.kind === "one-per-role") {
    const rolesSatisfied = new Set(approvals.map((entry) => entry.role));
    const missing = policy.roles.filter((role) => !rolesSatisfied.has(role));
    return { satisfied: missing.length === 0, missing };
  }
  throw new ApprovalError(`unknown approval policy kind: ${policy.kind}`);
}

/* ---------------------------------------------------------------- readiness */

/** §27.5 — readiness conditions for entering ready-for-approval. */
export function readinessCheck({
  templatesPass, blockingFindings = [], waivers = [], evidenceLinks = [], materialCommentsOpen = 0,
  dependencyCycles = [], approverSet = [], registry, reproduciblePackage
}) {
  const failures = [];
  if (!templatesPass) failures.push("required templates do not pass");
  const unwaived = blockingFindings.filter((finding) => !waivers.some((waiver) => waiver.finding === finding.id && waiver.valid));
  if (unwaived.length > 0) failures.push(`blocking findings unresolved: ${unwaived.length}`);
  if (evidenceLinks.length === 0) failures.push("required evidence and trace links are missing");
  if (materialCommentsOpen > 0) failures.push(`material comments not dispositioned: ${materialCommentsOpen}`);
  if (dependencyCycles.length > 0) failures.push("hard dependency cycles unresolved");
  for (const approver of approverSet) {
    try {
      const principal = registry.get(approver);
      if (principal.status !== "active" || !principal.bindings.some((binding) => binding.status === "verified")) {
        failures.push(`approver lacks a verified identity: ${approver}`);
      }
    } catch {
      failures.push(`approver cannot be resolved: ${approver}`);
    }
  }
  if (!reproduciblePackage) failures.push("approval package is not reproducible");
  return { ready: failures.length === 0, failures };
}

/* ---------------------------------------------------------------- baselines */

/** §14.1/§27.5 — an immutable baseline over approved packages. */
export function createBaseline({ packages, artifactHashes, sourceLocks = [], tombstones = [], metadata = {} }) {
  if (!Array.isArray(packages) || packages.length === 0) throw new ApprovalError("a baseline requires approved packages");
  const root = baselineRootHash({
    approval_package_hashes: packages.map((entry) => entry.package_hash),
    artifact_hashes: artifactHashes,
    source_locks: sourceLocks,
    adopted_redaction_tombstones: tombstones,
    metadata
  });
  return Object.freeze({
    schema_version: "rdlc.baseline/v0.2",
    id: mintIdentity(),
    approval_package_hashes: Object.freeze(packages.map((entry) => entry.package_hash)),
    artifact_hashes: Object.freeze([...artifactHashes]),
    source_locks: Object.freeze([...sourceLocks]),
    adopted_redaction_tombstones: Object.freeze([...tombstones]),
    metadata: Object.freeze({ ...metadata }),
    baseline_root_hash: root.hash,
    availability_state: "reconstructable"
  });
}

/* ---------------------------------------------------------------- redaction */

/** §41.1 — a tombstone excludes the removed content while keeping its hash. */
export function createTombstone({
  artifact, originalContentHash, affectedPackage, affectedBaseline, actor, authority, scope, reasonCode, decisionAt, replacementHash = null, content
}) {
  if (content !== undefined) throw new ApprovalError("a tombstone must exclude the content being removed (§41.1)");
  for (const [field, value] of Object.entries({ artifact, originalContentHash, affectedPackage, affectedBaseline, actor, authority, scope, reasonCode, decisionAt })) {
    if (!value) throw new ApprovalError(`a tombstone requires ${field}`);
  }
  return Object.freeze({
    schema_version: "rdlc.redaction-tombstone/v0.2",
    id: mintIdentity(),
    artifact,
    original_content_hash: originalContentHash,
    affected_package: affectedPackage,
    affected_baseline: affectedBaseline,
    actor,
    authority,
    scope,
    reason_code: reasonCode,
    decision_at: decisionAt,
    replacement_hash: replacementHash
  });
}

/**
 * §41.1 — an append-only addendum projects the original baseline as redacted
 * (and optionally non-reconstructable) WITHOUT modifying its hashed manifest.
 */
export function applyRedaction(baseline, { tombstones, authority, storageBoundary, nonReconstructable = false, exceptions = [] }) {
  if (!Array.isArray(tombstones) || tombstones.length === 0) throw new ApprovalError("redaction requires tombstones");
  const addendumBody = {
    original_baseline_root: baseline.baseline_root_hash,
    tombstones: tombstones.map((entry) => ({ id: entry.id, artifact: entry.artifact, original_content_hash: entry.original_content_hash })),
    authority,
    storage_boundary: storageBoundary,
    availability_state: nonReconstructable ? "non-reconstructable" : "redacted"
  };
  const hashed = redactionAddendumHash(addendumBody);
  return {
    baseline,
    addendum: Object.freeze({
      schema_version: "rdlc.redaction-addendum/v0.2",
      id: mintIdentity(),
      ...addendumBody,
      deletion_exceptions: Object.freeze([...exceptions]),
      addendum_hash: hashed.hash
    }),
    projected_state: addendumBody.availability_state
  };
}
