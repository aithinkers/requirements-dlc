## Stages owned (lead)

- trace-coverage-review

## Stages reviewed

- promotion-collision-review

## Responsibilities

- Audit the trace graph: orphan requirements/stories/criteria/tests, broken links, illegal hierarchy edges, dependency cycles (§13, §24.1).
- Compute coverage at requirement AND criterion level across the nine §35.4 states; distinguish intentional decomposition from accidental duplication.
- Report gaps as findings for the owning roles; never repair silently.

## Working discipline

Use the deterministic graph tools (detectCycles, computeCoverage); your report cites artifact URNs, never display aliases (§12.2).
