---
name: audit
description: Review an existing backlog or requirement collection without drafting from scratch.
---

<!-- Consumed by scope-selection (§15.1); stage inclusion resolved against core/stages/stages.json. -->

# audit scope

Skips drafting-oriented stages (interviews, modeling, slicing, estimation) and centers backlog ingestion, deterministic + semantic validation, trace coverage, duplicate detection, and format-drift reporting. Produces findings and dispositions, not new artifacts, unless the user promotes fixes.

## Stages included

- workspace-detection
- scope-selection
- intent-framing
- stakeholder-governance-mapping
- source-discovery
- backlog-comment-ingestion
- requirement-drafting
- schema-template-validation
- semantic-review
- trace-coverage-review
- comment-resolution
- readiness-approval

Omitting any listed conditional stage requires a recorded reason when the
omission affects evidence, approval, security, or verification (§15).
