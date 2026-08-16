/**
 * Capture, triage, promotion review, and coverage (spec §14.4, §35.3, §35.4).
 *
 * Captures preserve raw material and provenance; promotion into the shared
 * draft graph runs the thirteen-step gate against the latest shared state and
 * produces an auditable promotion review. Coverage is computed at both
 * requirement and acceptance-criterion level.
 */

import { canonicalBytes, sourceHash } from "./canonical.mjs";
import { mintIdentity } from "./identity.mjs";
import { transitionGovernance } from "./lifecycle.mjs";

export class PromotionError extends Error {
  constructor(message) {
    super(message);
    this.name = "PromotionError";
  }
}

/** §14.4 — captures may be free text plus provenance; template fields are advisory. */
export function createCapture({ text, provenance, actor, at = new Date().toISOString() }) {
  if (!text?.trim()) throw new PromotionError("a capture requires raw text");
  if (!provenance) throw new PromotionError("a capture requires provenance (§7.4)");
  if (!actor) throw new PromotionError("a capture requires a capturing actor");
  return {
    schema_version: "rdlc.artifact/v0.2",
    id: mintIdentity(),
    project: provenance.project ?? "unknown",
    type: "capture",
    title: text.trim().split("\n")[0].slice(0, 120),
    governance_state: "captured",
    version: 1,
    origin: { kind: "user-capture", actor, captured_at: at },
    statement: text,
    sources: provenance.sources ?? [],
    created_at: at,
    updated_at: at
  };
}

/** Assign type, relevance, and disposition (§14.1.1 triaged). */
export function triage(capture, { type, disposition = "working" }, context) {
  if (capture.governance_state !== "captured") {
    throw new PromotionError(`only captured material can be triaged: ${capture.governance_state}`);
  }
  if (!type) throw new PromotionError("triage requires an assigned type");
  const { artifact, audit } = transitionGovernance(capture, "triaged", context);
  return { artifact: { ...artifact, type, triage_disposition: disposition }, audit };
}

/** Detect hard-dependency cycles (§21, §35.3 step 10). */
export function detectCycles(dependencies) {
  const graph = new Map();
  for (const { source, target, hard = true } of dependencies) {
    if (!hard) continue;
    if (!graph.has(source)) graph.set(source, []);
    graph.get(source).push(target);
  }
  const cycles = [];
  const visiting = new Set();
  const done = new Set();
  const stack = [];
  function visit(node) {
    if (done.has(node)) return;
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    visiting.delete(node);
    done.add(node);
  }
  for (const node of graph.keys()) visit(node);
  return cycles;
}

function normalizeStatement(text) {
  return (text ?? "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * Coverage at requirement and criterion level (§35.4).
 * `covers` entries: { requirement, criteria: [urn], item, itemState, partition? }.
 */
export function computeCoverage({ requirements, claims = [], covers = [] }) {
  const results = new Map();
  for (const requirement of requirements) {
    const relevant = covers.filter((cover) => cover.requirement === requirement.id);
    const claimants = claims.filter(
      (claim) => claim.status === "active" && claim.scope?.requirements?.includes(requirement.id)
    );
    const criteria = requirement.acceptance_criteria ?? [];
    const criterionStates = {};
    for (const criterion of criteria) {
      const criterionCovers = relevant.filter((cover) => cover.criteria?.includes(criterion));
      criterionStates[criterion] = coverageState(criterionCovers, claimants);
    }
    const requirementState = coverageState(relevant, claimants);
    const coveredCriteria = criteria.filter((criterion) => !["uncovered", "claimed"].includes(criterionStates[criterion]));
    const partial = criteria.length > 0 && coveredCriteria.length > 0 && coveredCriteria.length < criteria.length;
    // Precedence (§35.4/§35.5): conflicts and undeclared duplication are never
    // masked by partial coverage — they carry the blocking/warning signal.
    const criterionConflict = Object.values(criterionStates).includes("conflicting-coverage");
    let state = requirementState;
    if (requirementState === "conflicting-coverage" || criterionConflict) state = "conflicting-coverage";
    else if (requirementState !== "over-covered" && partial) state = "partially-covered";
    results.set(requirement.id, { state, criteria: criterionStates });
  }
  return results;
}

function coverageState(coverEntries, claimants) {
  if (coverEntries.length === 0) return claimants.length > 0 ? "claimed" : "uncovered";
  const conflicting = coverEntries.some((cover) => cover.conflicting);
  if (conflicting) return "conflicting-coverage";
  const strongest = coverEntries.some((cover) => cover.itemState === "approved")
    ? "approved-covered"
    : coverEntries.some((cover) => cover.itemState === "draft")
      ? "draft-covered"
      : "working-covered";
  if (coverEntries.length > 1) {
    const partitions = new Set(coverEntries.map((cover) => cover.partition ?? null));
    const declared = coverEntries.every((cover) => cover.partition);
    if (declared && partitions.size === coverEntries.length) return "intentionally-multiple";
    // Disjoint-criteria covers are intentional decomposition, not duplication
    // (§35.4: over-covered means "substantially the same scope").
    const overlapping = coverEntries.some((a, i) =>
      coverEntries.some((b, j) => i < j && (a.criteria ?? []).some((criterion) => (b.criteria ?? []).includes(criterion)))
    );
    if (!overlapping) return strongest;
    return "over-covered";
  }
  return strongest;
}

const BLOCKING = "blocking";
const WARNING = "warning";

function finding(rule, severity, message, subject) {
  return { rule, severity, message, subject: subject ?? null };
}

/**
 * The §35.3 working-to-draft promotion review. Runs against the LATEST shared
 * state supplied by the caller, never the drafting-time snapshot.
 */
export function promotionReview({ working, shared, validators = {} }) {
  if (!working?.id) throw new PromotionError("a working artifact is required");
  if (!shared) throw new PromotionError("current shared state is required (§35.3 step 1)");
  const findings = [];

  // 2. Base version freshness.
  for (const [id, base] of Object.entries(working.base_versions ?? {})) {
    const current = shared.artifacts?.find((artifact) => artifact.id === id);
    if (!current) findings.push(finding("RDLC-PRM-001", BLOCKING, `base artifact no longer exists: ${id}`, id));
    else if (current.version !== base.version || current.content_hash !== base.content_hash) {
      findings.push(finding("RDLC-PRM-002", BLOCKING, `stale base version for ${id}: ${base.version} != ${current.version}`, id));
    }
  }

  // 3. Template and issue-type mapping validation (delegated).
  if (validators.template) {
    for (const failure of validators.template(working)) {
      findings.push(finding("RDLC-PRM-003", BLOCKING, `template: ${failure}`, working.id));
    }
  }
  if (validators.mapping) {
    for (const failure of validators.mapping(working)) {
      findings.push(finding("RDLC-PRM-004", BLOCKING, `issue-type mapping: ${failure}`, working.id));
    }
  }

  // 4. Source requirements and criteria still exist and are not superseded.
  for (const sourceId of working.source_requirements ?? []) {
    const source = shared.artifacts?.find((artifact) => artifact.id === sourceId);
    if (!source) findings.push(finding("RDLC-PRM-005", BLOCKING, `source requirement missing: ${sourceId}`, sourceId));
    else if (["superseded", "retired", "withdrawn"].includes(source.governance_state)) {
      findings.push(finding("RDLC-PRM-006", BLOCKING, `source requirement ${source.governance_state}: ${sourceId}`, sourceId));
    }
  }

  for (const criterionId of working.source_criteria ?? []) {
    const criterion = (shared.criteria ?? []).find((entry) => entry.id === criterionId);
    if (!criterion) findings.push(finding("RDLC-PRM-015", BLOCKING, `source acceptance criterion missing: ${criterionId}`, criterionId));
    else if (["superseded", "retired", "withdrawn"].includes(criterion.governance_state)) {
      findings.push(finding("RDLC-PRM-016", BLOCKING, `source acceptance criterion ${criterion.governance_state}: ${criterionId}`, criterionId));
    }
  }

  // 5. Coverage against approved, shared-draft, and claimed work.
  const coverage = computeCoverage({
    requirements: shared.artifacts?.filter((artifact) => (working.source_requirements ?? []).includes(artifact.id)) ?? [],
    claims: shared.claims ?? [],
    covers: [...(shared.covers ?? []), ...(working.intended_coverage ?? [])]
  });
  for (const [requirement, entry] of coverage) {
    if (entry.state === "conflicting-coverage") {
      findings.push(finding("RDLC-PRM-007", BLOCKING, `conflicting coverage for ${requirement}`, requirement));
    } else if (entry.state === "over-covered") {
      findings.push(finding("RDLC-PRM-008", WARNING, `over-coverage without declared partition for ${requirement}`, requirement));
    }
  }

  // 6–7. Duplicate and overlap candidates (deterministic normalization).
  const normalized = normalizeStatement(working.statement);
  for (const artifact of shared.artifacts ?? []) {
    if (artifact.id === working.id || !artifact.statement) continue;
    if (normalizeStatement(artifact.statement) === normalized) {
      findings.push(finding("RDLC-PRM-009", BLOCKING, `semantic duplicate candidate: ${artifact.id}`, artifact.id));
    }
  }

  // 7. Actor/outcome/rule/scope/data/component/dependency/criteria comparison
  // (delegated semantic comparison in addition to step 6's exact matching).
  if (validators.semanticComparison) {
    for (const entry of validators.semanticComparison(working, shared)) {
      findings.push(finding("RDLC-PRM-017", entry.severity === "blocking" ? BLOCKING : WARNING, `comparison: ${entry.message}`, entry.subject ?? working.id));
    }
  }

  // 8. Competing edits to the same artifact.
  for (const edit of shared.inFlightEdits ?? []) {
    if (edit.artifact === working.id && edit.workstream !== working.workstream) {
      findings.push(finding("RDLC-PRM-010", WARNING, `competing edit in workstream ${edit.workstream}`, working.id));
    }
  }

  // 9. Hierarchy and parent validation (delegated).
  if (validators.hierarchy) {
    for (const failure of validators.hierarchy(working, shared)) {
      findings.push(finding("RDLC-PRM-011", BLOCKING, `hierarchy: ${failure}`, working.id));
    }
  }

  // 10. Dependency cycles including the working item's proposed edges.
  const cycles = detectCycles([...(shared.dependencies ?? []), ...(working.dependencies ?? [])]);
  for (const cycle of cycles) {
    findings.push(finding("RDLC-PRM-012", BLOCKING, `hard dependency cycle: ${cycle.join(" -> ")}`, cycle[0]));
  }

  // 11. External ID collisions.
  for (const ref of working.external_refs ?? []) {
    const collision = (shared.externalRefs ?? []).find(
      (existing) => existing.provider === ref.provider && existing.item_id === ref.item_id && existing.artifact !== working.id
    );
    if (collision) {
      findings.push(finding("RDLC-PRM-013", BLOCKING, `external item already bound: ${ref.provider}/${ref.item_id}`, collision.artifact));
    }
  }

  // 12. Baseline or approval staleness.
  if (working.base_baseline && shared.currentBaseline && working.base_baseline !== shared.currentBaseline) {
    findings.push(finding("RDLC-PRM-014", BLOCKING, `baseline changed since drafting began: ${working.base_baseline} -> ${shared.currentBaseline}`, working.id));
  }

  // 12b. Approval staleness: drafting began against a package that was invalidated.
  if (working.base_approval_package && (shared.invalidatedApprovalPackages ?? []).includes(working.base_approval_package)) {
    findings.push(finding("RDLC-PRM-018", BLOCKING, `base approval package was invalidated: ${working.base_approval_package}`, working.id));
  }

  // 13. The review record.
  const sharedHash = sourceHash(canonicalBytes({
    baseline: shared.currentBaseline ?? null,
    artifacts: (shared.artifacts ?? []).map((artifact) => ({ id: artifact.id, version: artifact.version ?? null, content_hash: artifact.content_hash ?? null }))
  }, { artifacts: ["id"] })).hash;
  return {
    schema_version: "rdlc.promotion-review/v0.2",
    id: mintIdentity(),
    working: working.id,
    working_version: working.version,
    working_statement_hash: sourceHash(canonicalBytes({ statement: working.statement ?? null })).hash,
    reviewed_against: { baseline: shared.currentBaseline ?? null, artifact_count: shared.artifacts?.length ?? 0, shared_hash: sharedHash },
    findings,
    blocking: findings.filter((entry) => entry.severity === BLOCKING),
    coverage: Object.fromEntries(coverage),
    passed: !findings.some((entry) => entry.severity === BLOCKING)
  };
}

/**
 * Promote a working artifact into the shared draft graph (§14.4).
 * The original capture is preserved unrewritten; the promotion diff and
 * review travel in the result.
 */
export function promote({ working, capture, review, shared }, context) {
  if (!review?.passed) {
    throw new PromotionError("promotion requires a passing promotion review (§35.3)");
  }
  if (review.working !== working.id) {
    throw new PromotionError("promotion review does not cover this working artifact");
  }
  if (review.working_version !== working.version) {
    throw new PromotionError(`promotion review covers version ${review.working_version}, not ${working.version} (§35.7)`);
  }
  const statementHash = sourceHash(canonicalBytes({ statement: working.statement ?? null })).hash;
  if (review.working_statement_hash !== statementHash) {
    throw new PromotionError("working content changed after its promotion review (§35.3, §35.7)");
  }
  if (shared) {
    const sharedHash = sourceHash(canonicalBytes({
      baseline: shared.currentBaseline ?? null,
      artifacts: (shared.artifacts ?? []).map((artifact) => ({ id: artifact.id, version: artifact.version ?? null, content_hash: artifact.content_hash ?? null }))
    }, { artifacts: ["id"] })).hash;
    if (sharedHash !== review.reviewed_against.shared_hash) {
      throw new PromotionError("shared state changed since the promotion review; rerun the review (§35.3 step 1)");
    }
  }
  const { artifact, audit } = transitionGovernance(working, "draft", {
    ...context,
    promotionReview: review.id
  });
  const diff = {
    from_state: working.governance_state,
    to_state: "draft",
    statement_changed: capture ? capture.statement !== working.statement : null,
    fields: Object.keys(working).filter((key) => capture && working[key] !== capture[key])
  };
  return {
    artifact,
    capture: capture ? Object.freeze({ ...capture }) : null,
    promotion: {
      review: review.id,
      actor: context.actor,
      diff,
      at: context.at ?? new Date().toISOString()
    },
    audit
  };
}
