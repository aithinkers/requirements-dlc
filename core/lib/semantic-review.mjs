/**
 * Clearly labeled initial semantic review (spec §24.2, §45.1).
 *
 * Deterministic lexical heuristics that surface SEMANTIC SUGGESTIONS — every
 * finding is labeled `semantic: true` and `status: "suggestion"`; none blocks
 * on its own and none is represented as deterministic conformance (§44.2).
 */

export const SEMANTIC_REVIEW_VERSION = "rdlc-semantic-initial/0.1.0";

const VAGUE_TERMS = ["fast", "easy", "user-friendly", "appropriate", "etc", "reasonable", "efficient", "flexible", "robust", "as needed", "quickly", "simple"];
const UNBOUNDED_NFR = ["high performance", "scalable", "always available", "minimal latency", "secure enough"];
const NEGATIVE_PATH_HINTS = ["fail", "error", "invalid", "timeout", "retry", "recover", "denied", "reject"];

function finding(rule, message, location) {
  return { rule, semantic: true, status: "suggestion", severity: "advisory", message, location, review_version: SEMANTIC_REVIEW_VERSION };
}

/** Run the initial semantic review over one artifact; returns labeled suggestions. */
export function semanticReview(artifact) {
  const findings = [];
  const statement = (artifact.statement ?? "").toLowerCase();
  for (const term of VAGUE_TERMS) {
    if (new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`).test(statement)) {
      findings.push(finding("RDLC-SEM-001", `ambiguous or vague term: "${term}" (§24.2)`, "statement"));
    }
  }
  const conjunctions = (statement.match(/\b(and|or)\b/g) ?? []).length;
  if (conjunctions >= 3) {
    findings.push(finding("RDLC-SEM-002", "possible compound requirement: consider splitting (§24.2)", "statement"));
  }
  for (const term of UNBOUNDED_NFR) {
    if (statement.includes(term)) {
      findings.push(finding("RDLC-SEM-003", `unbounded non-functional expectation: "${term}" (§24.2)`, "statement"));
    }
  }
  const criteria = (artifact.acceptance_criteria ?? []).map((criterion) => String(criterion).toLowerCase());
  if (criteria.length > 0 && !criteria.some((criterion) => NEGATIVE_PATH_HINTS.some((hint) => criterion.includes(hint)))) {
    findings.push(finding("RDLC-SEM-004", "no negative, error, or recovery path in the acceptance criteria (§24.2)", "acceptance_criteria"));
  }
  for (const [index, criterion] of criteria.entries()) {
    if (statement && criterion === statement) {
      findings.push(finding("RDLC-SEM-005", "acceptance criterion repeats the requirement instead of testing it (§24.2)", `acceptance_criteria[${index}]`));
    }
  }
  return { review_version: SEMANTIC_REVIEW_VERSION, semantic: true, findings };
}
