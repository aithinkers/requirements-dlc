/**
 * Release scoping and high-level scope documents (FEAT-021, §18.2, §20, §26).
 *
 * Deterministic and I/O-free: callers load artifacts and declared releases,
 * this module validates release assignments (fail closed on unknown
 * releases), assembles a scope document from recorded decisions only, and
 * renders it for sharing. Nothing here ever guesses an item into or out of
 * scope — unassigned planning items become open questions (§18.1: never
 * invent a value to complete a template).
 */

export class ScopeDocError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScopeDocError";
  }
}

/** Planning-level types that may carry a target_release element. */
export const RELEASE_ASSIGNABLE_TYPES = Object.freeze([
  "story", "feature", "epic", "capability", "initiative", "portfolio-epic"
]);

// Labels feed rendered markdown: strip newlines so a title can never forge
// document structure.
const label = (artifact) => String(artifact.title ?? artifact.display_id ?? artifact.id ?? "(untitled)").replace(/[\r\n]+/g, " ");

function releaseIndex(releases) {
  const byName = new Map();
  for (const release of releases) {
    if (release?.type !== "release") throw new ScopeDocError(`not a release artifact: ${label(release ?? {})}`);
    if (typeof release.name !== "string" || release.name.length === 0) {
      throw new ScopeDocError(`release ${label(release)} has no name`);
    }
    if (byName.has(release.name)) throw new ScopeDocError(`duplicate release name: ${release.name}`);
    byName.set(release.name, release);
  }
  return byName;
}

/**
 * Validate every target_release against the declared releases. Returns
 * explainable findings (RDLC-REL-001 unknown release, RDLC-REL-002 assignment
 * on a non-planning type, RDLC-REL-003 assignment to a cancelled release);
 * an empty array means all assignments are usable.
 */
export function validateReleaseAssignments(artifacts, releases) {
  const declared = releaseIndex(releases);
  const findings = [];
  for (const artifact of artifacts) {
    const assigned = artifact?.target_release;
    if (assigned === undefined || assigned === null || assigned === "") continue;
    if (typeof assigned !== "string" && typeof assigned !== "number") {
      findings.push({
        rule: "RDLC-REL-004", item: label(artifact),
        message: `"${label(artifact)}" has a malformed target_release (${Array.isArray(assigned) ? "array" : typeof assigned}) — it must be a single release name`
      });
      continue;
    }
    if (!RELEASE_ASSIGNABLE_TYPES.includes(artifact.type)) {
      findings.push({
        rule: "RDLC-REL-002", item: label(artifact),
        message: `"${label(artifact)}" is a ${artifact.type} — releases are assigned at planning level (${RELEASE_ASSIGNABLE_TYPES.join(", ")})`
      });
      continue;
    }
    const release = declared.get(String(assigned));
    if (!release) {
      findings.push({
        rule: "RDLC-REL-001", item: label(artifact),
        message: `"${label(artifact)}" targets release "${assigned}", which is not declared — declare the release first or fix the assignment`
      });
    } else if (release.status === "cancelled") {
      findings.push({
        rule: "RDLC-REL-003", item: label(artifact),
        message: `"${label(artifact)}" targets release "${assigned}", which is cancelled — reassign or defer it explicitly`
      });
    }
  }
  return findings;
}

/**
 * Assemble a scope document, optionally scoped to one release.
 *
 * In-scope comes only from explicit assignment (`target_release` equals the
 * selected release; with no release selected, every assigned-or-unassigned
 * planning item is in scope). Out-of-scope comes only from recorded deferral
 * decisions: `{ item, decision: "deferred", reason, decided_by? }` entries in
 * `deferrals`, or artifacts assigned to a *different* release when a release
 * is selected (their reason names that release). Unassigned planning items
 * under a selected release become open questions, never silent exclusions.
 */
export function buildScopeDocument({ intent, stakeholders, successMeasures, artifacts = [], releases = [], release = null, deferrals = [], assumptions = [] }) {
  for (const [field, value] of [["intent", intent], ["stakeholders", stakeholders], ["successMeasures", successMeasures]]) {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === "") {
      throw new ScopeDocError(`scope document requires ${field} — it comes from the 1-frame stages, not from invention`);
    }
  }
  const declared = releaseIndex(releases);
  let selected = null;
  if (release !== null) {
    selected = declared.get(String(release));
    if (!selected) throw new ScopeDocError(`release "${release}" is not declared`);
    if (selected.status === "cancelled") {
      throw new ScopeDocError(`release "${selected.name}" is cancelled — a scope document for it would be misleading`);
    }
  }
  const invalid = validateReleaseAssignments(artifacts, releases);
  if (invalid.length > 0) {
    throw new ScopeDocError(`release assignments must be repaired first:\n  - ${invalid.map((finding) => finding.message).join("\n  - ")}`);
  }

  const planning = artifacts.filter((artifact) => RELEASE_ASSIGNABLE_TYPES.includes(artifact?.type));

  // Resolve each deferral to at most one artifact: exact id match first, then
  // exact title. An ambiguous title is an error (§18.1: a decision must name
  // what it decides), and a deferral that matches nothing is carried as an
  // external deferral rather than silently swallowing an artifact.
  const deferredArtifacts = new Set();
  let externalDeferrals = 0;
  for (const entry of deferrals) {
    if (entry?.decision !== "deferred" || !entry.item || !entry.reason) {
      throw new ScopeDocError(`a deferral needs item, decision: "deferred", and reason — got ${JSON.stringify(entry)}`);
    }
    const key = String(entry.item);
    const byId = planning.filter((artifact) => String(artifact.id ?? "") === key && artifact.id != null);
    const matches = byId.length > 0 ? byId : planning.filter((artifact) => label(artifact) === key);
    if (matches.length > 1) {
      throw new ScopeDocError(`deferral "${key}" matches ${matches.length} planning items — defer by unique id so the decision is unambiguous`);
    }
    if (matches.length === 1) deferredArtifacts.add(matches[0]);
    else externalDeferrals += 1;
  }

  const inScope = [], outOfScope = [], openQuestions = [];
  for (const artifact of planning) {
    const name = label(artifact);
    if (deferredArtifacts.has(artifact)) continue; // rendered from deferrals below
    const assigned = artifact.target_release == null || artifact.target_release === "" ? null : String(artifact.target_release);
    if (selected === null) {
      inScope.push({ item: name, type: artifact.type, release: assigned });
    } else if (assigned === selected.name) {
      inScope.push({ item: name, type: artifact.type, release: assigned });
    } else if (assigned !== null) {
      outOfScope.push({ item: name, reason: `assigned to release "${assigned}"` });
    } else {
      openQuestions.push(`Is "${name}" (${artifact.type}) in release "${selected.name}"? It has no release assignment yet.`);
    }
  }
  for (const entry of deferrals) {
    outOfScope.push({ item: String(entry.item), reason: entry.reason, ...(entry.decided_by ? { decided_by: entry.decided_by } : {}) });
  }

  return {
    type: "scope-document",
    intent,
    in_scope: inScope,
    out_of_scope: outOfScope,
    assumptions: [...assumptions],
    stakeholders,
    success_measures: successMeasures,
    ...(selected ? { release: selected.name } : {}),
    open_questions: openQuestions,
    // Arithmetic reconciles: in_scope + out_of_scope + unassigned equals
    // planning_items; deferrals naming items outside the artifact set are
    // counted separately, never against the planning total.
    coverage: {
      planning_items: planning.length,
      in_scope: inScope.length,
      out_of_scope: outOfScope.length - externalDeferrals,
      unassigned: openQuestions.length,
      external_deferrals: externalDeferrals
    }
  };
}

/** Render a scope document as shareable markdown, in the order people read it. */
export function renderScopeDocumentMarkdown(document) {
  if (document?.type !== "scope-document") throw new ScopeDocError("not a scope document");
  const lines = [`# Scope${document.release ? `: release ${document.release}` : ""}`, "", "## Intent", "", String(document.intent), ""];
  const list = (title, entries, render) => {
    lines.push(`## ${title}`, "");
    if (entries.length === 0) lines.push("_None._", "");
    else { for (const entry of entries) lines.push(`- ${render(entry)}`); lines.push(""); }
  };
  list("In scope", document.in_scope, (entry) => `**${entry.item}** (${entry.type}${entry.release ? `, release ${entry.release}` : ""})`);
  list("Out of scope", document.out_of_scope, (entry) => `**${entry.item}** — ${entry.reason}${entry.decided_by ? ` (decided by ${entry.decided_by})` : ""}`);
  list("Assumptions", document.assumptions, String);
  list("Stakeholders", Array.isArray(document.stakeholders) ? document.stakeholders : [document.stakeholders], String);
  list("Success measures", Array.isArray(document.success_measures) ? document.success_measures : [document.success_measures], String);
  list("Open questions", document.open_questions, String);
  const coverage = document.coverage;
  const external = coverage.external_deferrals > 0
    ? ` ${coverage.external_deferrals} deferral${coverage.external_deferrals === 1 ? "" : "s"} reference${coverage.external_deferrals === 1 ? "s" : ""} items outside this document's planning set.`
    : "";
  lines.push("## Coverage", "", `${coverage.in_scope} in scope, ${coverage.out_of_scope} out of scope, ${coverage.unassigned} awaiting a decision (of ${coverage.planning_items} planning items).${external}`, "");
  return lines.join("\n");
}
