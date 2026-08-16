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

- `.claude/commands/` and `.claude/agents/` — the 27 `/rdlc-*` commands and
  ten §38 role agents, placed where Claude Code auto-discovers them
  (generated from the authored core and byte-exact drift-protected)
- `requirements-project.yaml` — a §47-defaults project manifest
  (files-authoritative, propose-only connectors, untrusted external content)
- `rdlc/` — the §11 space/engagement layout

Prefer the plugin manager instead? From Claude Code:

```
/plugin marketplace add aithinkers/requirements-dlc
/plugin install rdlc@rdlc
```

(both surfaces ship the same generated files; pick one per project).

## Other harnesses (experimental)

The same authored core renders for Codex CLI and Kiro (per §36, Kiro CLI and
Kiro IDE are separate adapters with identical semantics):

```bash
npx github:aithinkers/requirements-dlc --tool codex      # → .codex/prompts + .codex/agents
npx github:aithinkers/requirements-dlc --tool kiro       # → .kiro/skills + .kiro/agents
npx github:aithinkers/requirements-dlc --tool kiro-ide
```

These surfaces are experimental and outside the 0.1 conformance claim
(§45.1); harness conformance follows the §45.2/§45.3 roadmap. Engagement
state is host-neutral (§34.5), so a project started in Claude Code resumes in
any of them.

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

## Content templates and tracker format enforcement

Every artifact type ships with an authored content template
(`core/templates/framework.json`): requirements declare statement, actor,
rationale, acceptance criteria and quality fields; portfolio epics declare
outcome, business objective, benefits and success measures; stories declare
actor, outcome, criteria and covered requirements — through tasks. Overlay
packs at organization/portfolio/space/project level tighten these; locked
framework controls cannot be weakened (§18.3).

The same templates enforce tracker content:

```js
import { loadCatalog } from "requirements-dlc/template-catalog";
const catalog = await loadCatalog();
catalog.validateArtifact(story);                       // promotion-time
catalog.validateProviderItem(jiraSnapshot, mapping);   // does the Jira issue carry the details?
catalog.detectFormatDrift(polledUpdates, mapping);     // who broke the story format in Jira?
```

Missing details produce explainable findings naming both the template field
and the provider field; unmapped required fields surface as mapping gaps;
externally edited items that no longer follow the format become RDLC-FMT-003
review findings with dispositions — never silent repair.

## Configuring a connector (fields, components, story points)

The easiest path: run **`/rdlc-setup-connector`** in Claude Code (or its
Codex/Kiro render) — a guided §18.1 walkthrough that discovers fields (Jira
createmeta / ADO field API or well-known defaults), asks the estimation,
components, and binding questions in small batches, writes the mapping file,
declares it in the manifest, and validates the result. Both **Jira Cloud**
and **Azure DevOps** are supported (ADO: configuration, template validation,
and format-drift today; runtime synchronization is §45.3 roadmap).

Manually instead: setup scaffolds `config/connectors/jira-example.yaml` and
`config/connectors/azure-devops-example.yaml`. Copy one, fill in your
project key, fields, and bindings, and declare it in
`requirements-project.yaml`:

```yaml
connectors:
  - id: delivery-jira
    provider: jira
    mapping: config/connectors/jira-com.yaml
    write_mode: propose        # upgrade to approve-each-batch when ready to write
```

The mapping file binds everything in one place:

- **fields** — the provider fields R-DLC reads, diffs, and read-back-verifies
- **estimation** — which Jira field holds story points, the scheme and scale,
  and who may confirm (AI values stay `suggested`; no auto conversion)
- **components** — the provider field matched against the component registry
- **artifact_types** — template ↔ issue-type ↔ field bindings per level
  (story, epic, …) powering `validateProviderItem` and format-drift detection

Load it in one call:

```js
import { loadConnectorConfig } from "requirements-dlc/connector-config";
const [jira] = await loadConnectorConfig(projectRoot, { catalogTypes: catalog.types() });
new JiraConnector({ transport, mapping: jira.connectorMapping, writeMode: jira.write_mode });
catalog.detectFormatDrift(polledUpdates, jira.templateMappings.story);
```

Invalid configs fail closed with named reasons (unknown scheme, estimation
field missing from `fields`, template field unmapped, duplicate issue types).

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
