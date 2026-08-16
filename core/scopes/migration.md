---
name: migration
description: Import, normalize, deduplicate, and establish authority over existing tracker content.
---

<!-- Consumed by scope-selection (§15.1); stage inclusion resolved against core/stages/stages.json. -->

# migration scope

Runs ingestion, the §2.4 migration path (identity minting, status splitting without invented evidence), dedupe adjudication, promotion review over the imported graph, and synchronization planning to converge the tracker on the migrated truth. Estimation and test design are out.

## Stages included

- workspace-detection
- scope-selection
- intent-framing
- stakeholder-governance-mapping
- source-discovery
- backlog-comment-ingestion
- requirement-drafting
- hierarchy-and-slicing
- promotion-collision-review
- dependencies-sequencing
- schema-template-validation
- semantic-review
- trace-coverage-review
- comment-resolution
- readiness-approval
- changeset-planning
- apply-and-verify

Omitting any listed conditional stage requires a recorded reason when the
omission affects evidence, approval, security, or verification (§15).
