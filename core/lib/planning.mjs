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
  const prerequisites = new Map(items.map((item) => [item, new Set()]));
  for (const { source, target } of hard) {
    if (prerequisites.has(source)) prerequisites.get(source).add(target);
  }
  const waves = [];
  const placed = new Set();
  while (placed.size < items.length) {
    const wave = items.filter((item) => !placed.has(item) && [...prerequisites.get(item)].every((need) => placed.has(need) || !prerequisites.has(need)));
    if (wave.length === 0) throw new PlanningError("planning waves cannot make progress; unresolved external prerequisites");
    for (const item of wave) placed.add(item);
    waves.push(wave);
  }
  return waves;
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
