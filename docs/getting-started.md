# Getting started with R-DLC

R-DLC turns ideas, scope documents, and tracker backlogs into governed,
traceable requirements — with portable files as the durable contract.

## Install

From the project you want to govern (any directory works):

```bash
npx github:aithinkers/requirements-dlc
```

or, from a clone:

```bash
node scripts/setup.mjs --target /path/to/your-project
```

Setup is idempotent and never overwrites files you have modified (rerun with
`--force` to replace them; `--check` reports drift without writing). Exit
codes: `0` success or up-to-date, `1` drift found or setup error, `2`
completed but user-modified files were protected. It
installs:

- `.claude/plugins/rdlc/` — the Claude Code plugin: 26 `/rdlc-*` commands and
  the ten §38 role agents, generated from the authored core and byte-exact
  drift-protected
- `requirements-project.yaml` — a §47-defaults project manifest
  (files-authoritative, propose-only connectors, untrusted external content)
- `rdlc/` — the §11 space/engagement layout

## First engagement

Open the project in Claude Code:

1. `/rdlc-start` — begin (or resume) an engagement; state lives in
   `rdlc/…/rdlc-state.yaml` with atomic checkpoints, so any session can
   resume from the last safe checkpoint.
2. `/rdlc-capture` — drop in an idea, meeting note, or scope document.
   Bounded intake handles PDF, DOCX, Markdown, HTML, XLSX, CSV, PPTX,
   draw.io, VSDX, images, and EML — encrypted, macro-enabled, and oversized
   inputs fail closed.
3. `/rdlc-triage` then `/rdlc-promote` — captures become typed working
   artifacts; the thirteen-step promotion gate checks freshness, coverage,
   duplicates, collisions, and dependency cycles before anything enters the
   shared draft graph.
4. `/rdlc-review` — deterministic checks plus the clearly labeled initial
   semantic review (suggestions, never silent truth).
5. `/rdlc-readiness` and `/rdlc-approve` — approvals bind verified provider
   identities to the exact `rdlc-jcs-v1` package hash; wrong accounts and
   stale hashes are rejected in code.
6. `/rdlc-sync` — connector writes are previewed changesets with idempotent
   apply, read-back verification, and receipts. The default write mode is
   `propose`; nothing touches your tracker without the configured approval.

`/rdlc-status` answers "where was I?" from durable files alone, and
`/rdlc-doctor` validates installation, policy, and state.

## Working as a team

Declare advisory scope with `/rdlc-claim` (overlaps notify, never block),
work in per-BA branches, and let the promotion gate + mutation leases
serialize the moments that must be exclusive (alias allocation, baselines).
Stale writes stop with a base/current/proposed comparison — deletions
included.

## Using the libraries directly

Every governed capability is an importable module:

```js
import { intake } from "requirements-dlc/intake";
import { contentHash } from "requirements-dlc/canonical";
import { JiraConnector } from "requirements-dlc/connectors/jira";
```

## Conformance

This distribution claims Core, Governed-Basic, and Planning (declared partial
depth) with the Jira Cloud company-managed connector subset and the Claude
Code harness — see
[`distribution/release/conformance-statement.json`](../distribution/release/conformance-statement.json)
for the exact claim, exceptions, and evidence. It never claims `Full`.
