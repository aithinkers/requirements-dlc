/**
 * Deterministic §7.10 reference scale fixture: 5,000 governed artifacts and
 * 50,000 relationships, generated from a fixed seed so every run reproduces
 * the same graph (no wall-clock or entropy inputs).
 */

const SEED = 0x5eed;

/** Small deterministic LCG — fixture generation must be reproducible. */
export function* lcg(seed = SEED) {
  let state = seed >>> 0;
  for (;;) {
    state = (state * 1664525 + 1013904223) >>> 0;
    yield state / 2 ** 32;
  }
}

const RELATIONSHIP_TYPES = ["derives-from", "decomposes", "satisfies", "implements", "depends-on", "affects"];
const TYPES = ["functional-requirement", "non-functional-requirement", "story", "task", "component", "risk"];

function syntheticUuid(index) {
  // Deterministic, RFC 9562-shaped UUIDv7 values for fixture identities.
  const hex = index.toString(16).padStart(12, "0");
  return `urn:uuid:01989999-0000-7${hex.slice(0, 3)}-8${hex.slice(3, 6)}-${hex.padStart(12, "0")}`;
}

export function generateScaleFixture({ artifacts = 5000, relationships = 50000 } = {}) {
  const random = lcg();
  const next = () => random.next().value;
  const records = [];
  for (let index = 0; index < artifacts; index += 1) {
    records.push({
      schema_version: "rdlc.artifact/v0.2",
      id: syntheticUuid(index),
      display_id: `REQ-${index + 1}`,
      project: "scale-fixture",
      type: TYPES[index % TYPES.length],
      title: `Synthetic artifact ${index + 1}`,
      governance_state: "draft",
      version: 1,
      origin: { kind: "deterministic-derivation" },
      statement: `Synthetic requirement statement number ${index + 1} for the scale envelope.`,
      relationships: [],
      created_at: "2026-08-15T00:00:00.000Z",
      updated_at: "2026-08-15T00:00:00.000Z"
    });
  }
  let edges = 0;
  while (edges < relationships) {
    const source = Math.floor(next() * artifacts);
    // Targets are uniform random, so the depends-on subset CONTAINS cycles by
    // construction — the benchmark measures cycle-detection over a realistic
    // adversarial graph and reports the count rather than assuming acyclicity.
    const target = Math.floor(next() * artifacts);
    if (source === target) continue;
    records[source].relationships.push({
      type: RELATIONSHIP_TYPES[edges % RELATIONSHIP_TYPES.length],
      target: syntheticUuid(target)
    });
    edges += 1;
  }
  return records;
}
