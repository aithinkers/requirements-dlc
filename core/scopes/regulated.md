---
name: regulated
description: Comprehensive provenance, separation of duties, approvals, baselines, and audit.
---

<!-- Consumed by scope-selection (§15.1); stage inclusion resolved against core/stages/stages.json. -->

# regulated scope

Nothing is trimmed. Every conditional stage runs unless a recorded, authorized omission exists; approvals use separation-of-duties policies; every source is snapshot-locked; redaction and retention policies are resolved before baseline (§41).

## Stages included

- workspace-detection
- scope-selection
- intent-framing
- stakeholder-governance-mapping
- source-discovery
- interviews-workshops
- backlog-comment-ingestion
- process-modeling
- domain-rules-glossary
- component-discovery
- requirement-drafting
- criteria-and-nfrs
- hierarchy-and-slicing
- promotion-collision-review
- components-ownership
- dependencies-sequencing
- schema-template-validation
- semantic-review
- trace-coverage-review
- comment-resolution
- readiness-approval
- baseline
- changeset-planning
- apply-and-verify
- test-design
- result-ingestion
- change-impact
- re-review-re-baseline

Omitting any listed conditional stage requires a recorded reason when the
omission affects evidence, approval, security, or verification (§15).
