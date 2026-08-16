---
name: change
description: Analyze and govern a change to an existing baseline.
---

<!-- Consumed by scope-selection (§15.1); stage inclusion resolved against core/stages/stages.json. -->

# change scope

Starts from the impacted baseline: change-impact analysis, materiality classification, affected-approval invalidation, re-review, and re-baseline. Discovery/modeling run only where the change introduces new scope. The §14.5 materiality policy is the gatekeeper throughout.

## Stages included

- workspace-detection
- scope-selection
- intent-framing
- stakeholder-governance-mapping
- source-discovery
- requirement-drafting
- criteria-and-nfrs
- schema-template-validation
- semantic-review
- trace-coverage-review
- comment-resolution
- readiness-approval
- baseline
- change-impact
- re-review-re-baseline

Omitting any listed conditional stage requires a recorded reason when the
omission affects evidence, approval, security, or verification (§15).
