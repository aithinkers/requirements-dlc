# Standing self-review regression fixture (§44.3, as amended)

Per ADR-001 item 14 (adjudicated on issue #2) the fixture is anchored at the
0.2 baseline: no frozen 0.1 specification survives in this repository's
history, so the specification's §44.3 anchor was amended through the recorded
baseline change process to start here.

Contents:

- `findings.json` — the adjudicated ADR-001 findings against the imported 0.2
  draft (editorial defects, implementation-blocking ambiguities, and process
  deferrals) with their dispositions, from
  `docs/decisions/0001-open-specification-decisions.md`.

An evaluation of a reviewer against this fixture asks whether the known
defect classes (broken cross-references, unimplementable informative stacks,
undeclared migration presuppositions, lease-authority atomicity gaps,
identity-verification vagueness, benchmark-environment omissions) are
detected without requiring identical prose. New accepted specification
defects are added here as regression cases with leakage controls.
