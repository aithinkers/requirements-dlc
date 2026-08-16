# Specification baseline

The repository baseline is
[`requirements-development-lifecycle-specification.md`](requirements-development-lifecycle-specification.md),
imported byte-for-byte from the implementation draft supplied on 2026-08-15
and since amended only through the recorded change process below.

- Framework: R-DLC
- Specification version: 0.2.0
- Status: Draft for implementation
- SHA-256: `0bd5e4ca8af2fff226131c9b16fb0135a2edc556914b640cf7094dc609e4c999`

## Change record

| Date | Issue | Change | Prior SHA-256 |
|---|---|---|---|
| 2026-08-16 | #36 (ADR-002) | Amended the §36 recommended layout to name `distribution/` (knowledge-dlc parity) instead of `dist/`; decision in `decisions/0002-distribution-layout-parity.md`. | `36aaecc588f1079e342ca7fd50007967ea46bc742e286f3310c28ead6eaaab17` |
| 2026-08-15 | #28 (REL-002) | Amended §44.3 to anchor the standing self-review fixture at the earliest available frozen baseline (0.2 here, no pre-0.2 draft survives), per the ADR-001 item 14 adjudication. | `173c3ad8fc4a81ad7e5883aa20a3874a451ccc22ec4c93244860d1fcbd68f0ba` |
| 2026-08-15 | #2 (ADR-001) | Replaced the §2.2 relative K-DLC link with the canonical cross-repository URL; marked the §2.4 migration procedure informative until claimed; noted in §16.2.3 that the named extraction tools are exemplary and the reference distribution uses a Node.js stack. Dispositions in `decisions/0001-open-specification-decisions.md`. | `8caa9d3039e5ff98c2e0b283261639617913a3a3d577f622a69c61dbe539a8a5` |

Changing this file requires a requirement issue, compatibility analysis,
migration decision, updated traceability, and review. Known editorial and
decision candidates against the imported draft are tracked in
[`decisions/0001-open-specification-decisions.md`](decisions/0001-open-specification-decisions.md)
and must land through that recorded change process, never as silent edits.
