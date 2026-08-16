/**
 * RAID+D registers (spec §23).
 *
 * Risks, assumptions, issues, dependencies, and decisions are first-class
 * linked records with type-specific required fields, configurable risk
 * scoring, aging/overdue detection, and escalation.
 */

import { mintIdentity } from "./identity.mjs";

export class RaidError extends Error {
  constructor(message) {
    super(message);
    this.name = "RaidError";
  }
}

export const RAID_TYPES = Object.freeze(["risk", "assumption", "issue", "dependency", "decision"]);

/** §23.2 type-specific required fields. */
const TYPE_FIELDS = Object.freeze({
  risk: ["probability", "impact", "exposure_method", "mitigation"],
  assumption: ["validation_method", "validation_owner", "due_at", "consequence_if_false"],
  issue: ["current_impact", "severity", "resolution_plan", "target_at"],
  dependency: ["provider", "consumer", "needed_by", "hard", "satisfaction_criteria"],
  decision: ["options", "decision_authority", "outcome", "rationale", "consequences"]
});

/** §23.1 — every RAID record carries the common fields. */
export function createRaidRecord({ type, statement, owner, sources = [], affected = [], at, ...specific }) {
  if (!RAID_TYPES.includes(type)) throw new RaidError(`unknown RAID type: ${type}`);
  if (!statement?.trim()) throw new RaidError("a RAID record requires a statement");
  if (!owner) throw new RaidError("a RAID record requires an owner");
  if (!at) throw new RaidError("a RAID record requires a creation time");
  for (const field of TYPE_FIELDS[type]) {
    if (specific[field] === undefined || specific[field] === null || specific[field] === "") {
      throw new RaidError(`a ${type} requires ${field} (§23.2)`);
    }
  }
  return {
    schema_version: "rdlc.raid/v0.2",
    id: mintIdentity(),
    type,
    statement,
    owner,
    sources: [...sources],
    affected_artifacts: [...affected],
    status: "open",
    escalation_state: "none",
    created_at: at,
    history: [],
    ...Object.fromEntries(TYPE_FIELDS[type].map((field) => [field, specific[field]]))
  };
}

/**
 * §23.2 — risk scoring matrices are configurable; no built-in formula is
 * presented as universally correct. A matrix maps probability x impact
 * labels to a score/level.
 */
export function scoreRisk(risk, matrix) {
  if (risk.type !== "risk") throw new RaidError("only risks are scored");
  if (!matrix?.name || !matrix.cells) throw new RaidError("risk scoring requires a named configured matrix (§23.2)");
  const cell = matrix.cells?.[risk.probability]?.[risk.impact];
  if (cell === undefined) throw new RaidError(`matrix ${matrix.name} has no cell for ${risk.probability}/${risk.impact}`);
  return { score: cell, matrix: matrix.name };
}

/** §23.3 — aging, overdue detection, and validation reminders. */
export function agingReport(records, { now }) {
  if (!now) throw new RaidError("an aging report requires the current time");
  const overdue = [];
  const validationDue = [];
  for (const record of records) {
    if (record.status !== "open") continue;
    const due = record.due_at ?? record.target_at ?? record.needed_by ?? null;
    if (due && due < now) overdue.push({ id: record.id, type: record.type, due });
    if (record.type === "assumption" && record.due_at <= now && !record.validated) {
      validationDue.push({ id: record.id, owner: record.validation_owner });
    }
  }
  return { overdue, validation_due: validationDue, generated_at: now };
}

/** §23.3 — escalation is explicit and audited on the record. */
export function escalate(record, { to, reason, actor, at }) {
  if (!to || !reason) throw new RaidError("escalation requires a target and reason");
  return {
    ...record,
    escalation_state: "escalated",
    history: [...record.history, { event: "escalated", to, reason, actor, at }]
  };
}

/** Assumption validation outcome (§23.2): confirmed or refuted, never silent. */
export function validateAssumption(assumption, { outcome, evidence, actor, at }) {
  if (assumption.type !== "assumption") throw new RaidError("only assumptions are validated");
  if (!["confirmed", "refuted"].includes(outcome)) throw new RaidError(`unknown validation outcome: ${outcome}`);
  if (!evidence) throw new RaidError("assumption validation requires evidence");
  return {
    ...assumption,
    validated: outcome,
    status: outcome === "refuted" ? "open" : "closed",
    history: [...assumption.history, { event: `validated-${outcome}`, evidence, actor, at }]
  };
}
