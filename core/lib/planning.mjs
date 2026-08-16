/**
 * Dependency planning outputs (spec §21): topological order, parallel
 * planning waves, and critical blockers over the hard-dependency graph.
 * Cycles are detected by promotion.detectCycles and block readiness (§21).
 */

import { detectCycles } from "./promotion.mjs";

export class PlanningError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlanningError";
  }
}

/** §21 — every generated dependency carries its full record. */
export const DEPENDENCY_TYPES = Object.freeze([
  "hard-prerequisite", "blocking", "data", "api-contract", "shared-component",
  "environment", "decision", "vendor-external", "compliance-approval",
  "test-verification", "schedule", "informational"
]);

export function createDependency({ source, target, type, rationale, origin, confidence, hard }) {
  if (!DEPENDENCY_TYPES.includes(type)) throw new PlanningError(`unknown dependency type: ${type}`);
  for (const [field, value] of Object.entries({ source, target, rationale, origin })) {
    if (!value) throw new PlanningError(`a dependency requires ${field} (§21)`);
  }
  if (!["low", "medium", "high"].includes(confidence)) throw new PlanningError("a dependency requires a confidence (§21)");
  if (typeof hard !== "boolean") throw new PlanningError("a dependency declares hard or soft (§21)");
  return Object.freeze({ source, target, type, rationale, origin, confidence, hard, status: origin === "ai" ? "candidate" : "accepted" });
}

/** §20.4 — non-development work is first-class, never a fake user story. */
export const NON_DEVELOPMENT_CATEGORIES = Object.freeze([
  "research", "design", "procurement", "legal", "compliance", "training",
  "documentation", "data-migration", "change-management", "marketing",
  "operations", "governance", "vendor-coordination", "stakeholder-communication"
]);

export function createNonDevelopmentTask({ category, title, completionPolicy, owner }) {
  if (!NON_DEVELOPMENT_CATEGORIES.includes(category)) throw new PlanningError(`unknown non-development category: ${category} (§20.4)`);
  if (!title || !completionPolicy || !owner) throw new PlanningError("a task requires title, completion policy, and owner (§20.4)");
  // §20.3 — no fake user story: the record is a task with a completion policy,
  // not an actor/outcome story template.
  return Object.freeze({ schema_version: "rdlc.artifact/v0.2-task", type: "task", category, title, completion_policy: completionPolicy, owner });
}

/**
 * §21 — planning waves: items proceed in parallel once their hard
 * prerequisites are satisfied. `depends-on` means source requires target, so
 * targets belong to earlier waves.
 */
export function computeWaves(items, dependencies) {
  const hard = dependencies.filter((dependency) => dependency.hard !== false);
  const cycles = detectCycles(hard);
  if (cycles.length > 0) {
    throw new PlanningError(`hard dependency cycles block planning waves: ${cycles.map((cycle) => cycle.join(" -> ")).join("; ")} (§21)`);
  }
  const itemSet = new Set(items);
  // §21 outputs 6 and 10 — hard prerequisites outside the plan are never
  // silently satisfied: they enter the external dependency register and
  // block their dependents until explicitly acknowledged.
  const externalRegister = [...new Set(hard.filter((dependency) => !itemSet.has(dependency.target)).map((dependency) => dependency.target))]
    .map((target) => ({
      external: target,
      dependents: hard.filter((dependency) => dependency.target === target).map((dependency) => dependency.source),
      status: "unresolved"
    }));
  const externallyBlocked = new Set(externalRegister.flatMap((entry) => entry.dependents));
  const prerequisites = new Map(items.map((item) => [item, new Set()]));
  for (const { source, target } of hard) {
    if (prerequisites.has(source) && itemSet.has(target)) prerequisites.get(source).add(target);
  }
  const waves = [];
  const placed = new Set();
  const plannable = items.filter((item) => !externallyBlocked.has(item));
  while (placed.size < plannable.length) {
    const wave = plannable.filter((item) => !placed.has(item) && [...prerequisites.get(item)].every((need) => placed.has(need)));
    if (wave.length === 0) throw new PlanningError("planning waves cannot make progress");
    for (const item of wave) placed.add(item);
    waves.push(wave);
  }
  return {
    waves,
    external_register: externalRegister,
    blocked_by_external: [...externallyBlocked],
    // §21 output 8 — the earliest wave is the walking-skeleton candidate.
    walking_skeleton_candidate: waves[0] ?? [],
    unresolved_questions: externalRegister.map((entry) => `when is ${entry.external} available for ${entry.dependents.join(", ")}?`)
  };
}

/** §21 — critical blockers: items the most downstream work waits on. */
export function criticalBlockers(items, dependencies, { top = 5 } = {}) {
  const hard = dependencies.filter((dependency) => dependency.hard !== false);
  const dependents = new Map(items.map((item) => [item, 0]));
  const graph = new Map(items.map((item) => [item, []]));
  for (const { source, target } of hard) {
    if (graph.has(target)) graph.get(target).push(source);
  }
  const countDownstream = (item, seen = new Set()) => {
    let count = 0;
    for (const dependent of graph.get(item) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      count += 1 + countDownstream(dependent, seen);
    }
    return count;
  };
  for (const item of items) dependents.set(item, countDownstream(item));
  return [...dependents.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([item, blocked]) => ({ item, blocks: blocked }));
}
