/**
 * Comment review and shaping (spec §26).
 *
 * Comments are untrusted review inputs (§7.8): they enter a queue on
 * new/edited/policy-change events, are classified and dispositioned with the
 * exact comment revision retained, never mutate artifacts directly, and a
 * comment saying "approved" is never an approval outside the governed flow.
 */

import { mintIdentity } from "./identity.mjs";

export class CommentReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = "CommentReviewError";
  }
}

export const CLASSIFICATIONS = Object.freeze([
  "clarification", "proposed-requirement-change", "challenge", "missing-acceptance-criterion",
  "evidence", "decision", "risk", "assumption", "issue", "dependency",
  "test-scenario", "scope-change", "non-actionable"
]);

export const DISPOSITIONS = Object.freeze([
  "incorporate", "challenge-with-response", "request-clarification",
  "create-requirement", "create-or-change-criteria", "create-raid-record",
  "create-change-request", "mark-addressed", "no-action"
]);

/** §26 — queue entry retaining comment revision and relevance-policy version. */
export function enqueueComment({ provider, itemId, commentId, revision, author, body, event, relevancePolicyVersion }) {
  if (!["new", "edited", "policy-change"].includes(event)) {
    throw new CommentReviewError(`unknown queue event: ${event}`);
  }
  for (const [field, value] of Object.entries({ provider, itemId, commentId, author, relevancePolicyVersion })) {
    if (!value) throw new CommentReviewError(`a queue entry requires ${field}`);
  }
  return {
    schema_version: "rdlc.comment-queue/v0.2",
    id: mintIdentity(),
    provider,
    item_id: itemId,
    comment_id: commentId,
    comment_revision: revision ?? null,
    author,
    body: String(body ?? ""),
    event,
    relevance_policy_version: relevancePolicyVersion,
    status: "queued",
    classification: null,
    disposition: null
  };
}

/** §26 — classify; classification never mutates any artifact. */
export function classifyComment(entry, classification) {
  if (!CLASSIFICATIONS.includes(classification)) throw new CommentReviewError(`unknown classification: ${classification}`);
  return { ...entry, classification, status: "classified" };
}

/**
 * §26 — disposition with the exact comment revision link retained. Proposed
 * external responses become changeset candidates, never direct writes.
 */
export function disposeComment(entry, { disposition, actor, at, materialityPolicy = null, targetArtifact = null, proposedResponse = null }) {
  if (!DISPOSITIONS.includes(disposition)) throw new CommentReviewError(`unknown disposition: ${disposition}`);
  if (!actor || !at) throw new CommentReviewError("a disposition requires actor and time");
  const result = {
    ...entry,
    status: "dispositioned",
    disposition: {
      kind: disposition,
      actor,
      at,
      comment_link: `external://${entry.provider}/${entry.item_id}#comment-${entry.comment_id}@${entry.comment_revision ?? "unversioned"}`
    }
  };
  if (disposition === "incorporate" && !targetArtifact) {
    throw new CommentReviewError("incorporation names the target artifact");
  }
  if (targetArtifact) result.disposition.target_artifact = targetArtifact;
  if (proposedResponse) {
    // §26 — a response to an external comment travels through a changeset.
    result.disposition.proposed_response = { body: proposedResponse, delivery: "connector-changeset", write_approval: "per-policy" };
  }
  // §26 — a comment proposing a material change creates an impact-review
  // candidate rather than silently changing content.
  if (["proposed-requirement-change", "scope-change", "missing-acceptance-criterion"].includes(entry.classification)) {
    result.impact_review_candidate = {
      id: mintIdentity(),
      reason: `comment proposes a ${entry.classification}`,
      materiality_policy: materialityPolicy ?? "materiality/default"
    };
  }
  return result;
}

/**
 * §26 — "approved" in a comment is advisory unless an explicit policy
 * validates actor, scope, decision format, and artifact hash; this helper
 * always answers with the governed requirement, never an approval.
 */
export function evaluateApprovalLanguage(entry, { policy = null } = {}) {
  const claims = /\bapproved?\b/i.test(entry.body);
  if (!claims) return { approval: false, advisory: false };
  if (!policy?.validatesActor || !policy?.validatesScope || !policy?.validatesFormat || !policy?.bindsArtifactHash) {
    return {
      approval: false,
      advisory: true,
      reason: "comment approval language is advisory; a conforming §27 decision bound to the package hash is required (§26, §27.6)"
    };
  }
  return { approval: false, advisory: true, reason: "even under a mapping policy, approval is recorded through the governed decision flow, not inferred from comment text" };
}
