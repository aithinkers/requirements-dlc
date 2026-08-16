---
name: quick
description: One capture, requirement, story, or task with lightweight review.
---

<!-- Consumed by scope-selection (§15.1); stage inclusion resolved against core/stages/stages.json. -->

# quick scope

Runs only the ALWAYS stages plus nothing conditional. Discovery is the capture itself; planning is skipped because a single item needs no hierarchy; validation still runs in full — a quick item is small, not ungoverned. Approval uses the default policy over one artifact.

## Stages included

- workspace-detection
- scope-selection
- intent-framing
- stakeholder-governance-mapping
- source-discovery
- requirement-drafting
- schema-template-validation
- semantic-review
- trace-coverage-review
- comment-resolution
- readiness-approval

Omitting any listed conditional stage requires a recorded reason when the
omission affects evidence, approval, security, or verification (§15).
