## Procedure

1. Refresh shared state first — the gate runs on the LATEST state, never the drafting-time snapshot (§35.3 step 1).
2. Run promotionReview with the catalog template validator. Present findings grouped: blocking (stale bases, missing/superseded sources, duplicates, cycles, external-ID collisions, template gaps) vs warnings (over-coverage, competing edits).
3. For each blocking finding, offer the §35.6 dispositions (revise, partition, link related, declare intentional-multiple with rationale, reuse existing, escalate, withdraw). Collision decisions are recorded with participants and rationale (recordCollisionDecision).
4. Only a passing review promotes (promote binds the review to the exact content and shared state — a stale review will refuse). Show the promotion diff.
5. Checkpoint; report new coverage states for affected requirements.
