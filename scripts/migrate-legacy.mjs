/**
 * §2.4 0.1→0.2 migration (conformance fixture requirement, §44.1 item 16).
 *
 * Idempotent: rename initiative containers to engagements, mint canonical
 * UUIDv7 identities retaining old typed identifiers as display aliases,
 * rewrite relationships to UUID URNs, and split any single lifecycle status
 * into the four dimensions without inventing evidence. Produces a report
 * mapping every old identity and status to its new representation.
 */

import { isCanonicalIdentity, mintIdentity } from "../core/lib/identity.mjs";

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Legacy combined statuses split WITHOUT inferring evidence (§2.4 step 3). */
const STATUS_SPLIT = Object.freeze({
  "draft": { governance_state: "draft", synchronization_state: "not-synchronized", verification_progress: "not-designed", verification_outcome: "none" },
  "approved": { governance_state: "approved", synchronization_state: "not-synchronized", verification_progress: "not-designed", verification_outcome: "none" },
  "approved-and-synced": { governance_state: "approved", synchronization_state: "not-synchronized", verification_progress: "not-designed", verification_outcome: "none", migration_note: "legacy sync claim dropped: no read-back evidence existed (§2.4)" },
  "tested": { governance_state: "approved", synchronization_state: "not-synchronized", verification_progress: "not-designed", verification_outcome: "none", migration_note: "legacy tested claim dropped: no execution evidence existed (§2.4)" }
});

export function migrateLegacyProject(legacy) {
  if (legacy.schema_version === "rdlc.project/v0.2") {
    // Idempotence: an already-migrated project passes through unchanged.
    return { project: legacy, report: { already_migrated: true, mappings: [] } };
  }
  if (legacy.schema_version !== "rdlc.project/v0.1") {
    throw new MigrationError(`unknown legacy schema: ${legacy.schema_version}`);
  }
  const mappings = [];
  const idMap = new Map();

  // Step 2: mint canonical UUIDs; old typed ids become display aliases.
  const artifacts = legacy.artifacts.map((artifact) => {
    const id = isCanonicalIdentity(artifact.id) ? artifact.id : mintIdentity();
    idMap.set(artifact.id, id);
    return { legacy: artifact, id };
  });

  const migratedArtifacts = artifacts.map(({ legacy: artifact, id }) => {
    const split = STATUS_SPLIT[artifact.status];
    if (!split) throw new MigrationError(`unmapped legacy status: ${artifact.status}`);
    const migrated = {
      schema_version: "rdlc.artifact/v0.2",
      id,
      display_id: artifact.id,
      project: legacy.project,
      type: artifact.type,
      title: artifact.title,
      version: 1,
      origin: { kind: "migration" },
      statement: artifact.statement,
      relationships: (artifact.relationships ?? []).map((relationship) => {
        const target = idMap.get(relationship.target);
        if (!target) throw new MigrationError(`relationship target has no migrated identity: ${relationship.target}`);
        return { type: relationship.type, target };
      }),
      created_at: artifact.created_at,
      updated_at: artifact.updated_at,
      ...split
    };
    mappings.push({
      old_identity: artifact.id,
      new_identity: id,
      old_status: artifact.status,
      new_states: {
        governance_state: split.governance_state,
        synchronization_state: split.synchronization_state,
        verification_progress: split.verification_progress,
        verification_outcome: split.verification_outcome
      },
      note: split.migration_note ?? null
    });
    return migrated;
  });

  // Step 1: initiative containers become engagements; the planning-item type survives.
  const engagements = (legacy.initiatives ?? []).map((initiative) => ({
    engagement: idMap.get(initiative.id) ?? mintIdentity(),
    display_id: initiative.id,
    title: initiative.title,
    migrated_from: "initiative"
  }));

  // Step 4: legacy approvals are historical evidence only, never 0.2 approvals.
  const historicalApprovals = (legacy.approvals ?? []).map((approval) => ({
    ...approval,
    status: "historical-evidence",
    migration_note: "retained as historical evidence; not a 0.2 approval without a new conforming decision (§2.4)"
  }));

  return {
    project: {
      schema_version: "rdlc.project/v0.2",
      project: legacy.project,
      artifacts: migratedArtifacts,
      engagements,
      historical_approvals: historicalApprovals
    },
    report: {
      already_migrated: false,
      renamed_containers: engagements.length,
      mappings,
      historical_approvals: historicalApprovals.length
    }
  };
}
