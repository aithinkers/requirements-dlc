# ADR-002: Consolidate generated output under distribution/ (issue #36)

Status: Accepted 2026-08-16.

## Context

R-DLC spec §36 named `dist/` for generated host output, while knowledge-dlc
keeps generated adapters and authored release evidence together under one
`distribution/` tree (`distribution/claude-code`, `distribution/release`).
Running both repos side by side, the owner chose cross-repo layout parity
over the spec's original directory name.

## Decision

Relocate `dist/claude-code/` to `distribution/claude-code/` and amend the
§36 recommended layout accordingly through the baseline change record. The
generated tree keeps its byte-exact drift check; `distribution/release/`
remains authored evidence. No generated file content changes — only paths.

## Consequences

- Installer, marketplace manifest, package files, drift check, and tests
  reference `distribution/claude-code/`.
- Consumers of v0.1.2 tarballs are unaffected (installers resolve paths
  relative to their own package root); v0.1.3 ships the new layout.
- Future harnesses (codex, kiro) land as sibling `distribution/<host>/`
  trees, matching knowledge-dlc exactly.
