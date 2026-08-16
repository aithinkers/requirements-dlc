#!/usr/bin/env node
/**
 * §7.10 reference scale benchmark: full deterministic validation of the
 * 5,000-artifact / 50,000-relationship fixture, plus incremental
 * single-artifact validation. Prints a machine-readable report including the
 * measurement environment (ADR-001 item 11).
 */

import { cpus, platform, release, totalmem } from "node:os";
import process from "node:process";

import { createValidator, validateRecord } from "../core/schemas/v0.2/index.mjs";
import { detectCycles } from "../core/lib/promotion.mjs";
import { generateScaleFixture } from "./scale-fixture.mjs";

const fixture = generateScaleFixture();
const ajv = await createValidator();

async function fullValidation() {
  const started = process.hrtime.bigint();
  const known = new Set(fixture.map((artifact) => artifact.id));
  let failures = 0;
  const dependencyEdges = [];
  for (const artifact of fixture) {
    const { valid } = await validateRecord(artifact, ajv);
    if (!valid) failures += 1;
    for (const relationship of artifact.relationships) {
      if (!known.has(relationship.target)) failures += 1;
      if (relationship.type === "depends-on") {
        dependencyEdges.push({ source: artifact.id, target: relationship.target });
      }
    }
  }
  const cycles = detectCycles(dependencyEdges);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { elapsedMs, failures, dependencyEdges: dependencyEdges.length, cyclesFound: cycles.length };
}

async function incrementalValidation(samples = 100) {
  const timings = [];
  for (let index = 0; index < samples; index += 1) {
    const artifact = fixture[(index * 47) % fixture.length];
    const started = process.hrtime.bigint();
    await validateRecord(artifact, ajv);
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  timings.sort((a, b) => a - b);
  return { p95Ms: timings[Math.floor(samples * 0.95) - 1], samples };
}

const full = await fullValidation();
const incremental = await incrementalValidation();

const report = {
  schema_version: "rdlc.scale-benchmark/v0.2",
  fixture: { artifacts: fixture.length, relationships: fixture.reduce((sum, artifact) => sum + artifact.relationships.length, 0), generator: "scripts/scale-fixture.mjs (seeded LCG, deterministic)" },
  environment: {
    platform: `${platform()} ${release()}`,
    node: process.version,
    cpus: cpus().length,
    cpu_model: cpus()[0]?.model ?? "unknown",
    total_memory_bytes: totalmem(),
    reference_class: "GitHub-hosted ubuntu-latest runner class or equivalent (ADR-001 item 11)"
  },
  method: "full: schema validation + relationship target resolution + hard-dependency cycle detection (cycles are expected in the synthetic graph and reported, not failed) over the complete fixture; incremental: p95 of 100 single-artifact validations",
  results: {
    full_validation_ms: Math.round(full.elapsedMs),
    full_validation_target_ms: 30000,
    full_validation_within_target: full.elapsedMs <= 30000,
    incremental_p95_ms: Number(incremental.p95Ms.toFixed(3)),
    incremental_target_ms: 2000,
    incremental_within_target: incremental.p95Ms <= 2000,
    validation_failures: full.failures,
    hard_dependency_edges: full.dependencyEdges,
    cycles_found: full.cyclesFound
  }
};

console.log(JSON.stringify(report, null, 2));
if (full.failures > 0 || !report.results.full_validation_within_target || !report.results.incremental_within_target) {
  process.exit(1);
}
