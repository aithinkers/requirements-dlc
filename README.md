# R-DLC — turn scattered inputs into governed, traceable requirements

**R-DLC (Requirements Development Lifecycle)** turns the inputs your team
already has — meeting notes, scope documents, PDFs, Office files, emails, and
items living in **Jira, GitHub, or Azure DevOps** — into durable,
evidence-bearing requirements that agents can help develop and humans can
actually trust: captured verbatim, promoted through explicit review gates,
approved with identity-bound evidence, baselined immutably, and synchronized
to your tracker as previewed, receipted transactions. Think of it as a
governed requirements workbench for the agent era: every requirement traces
to source snapshots and hashes, and approvals, duplicates, coverage, and
drift are first-class instead of afterthoughts.

```bash
# get started (zero install)
npx github:aithinkers/requirements-dlc --target ~/my-project
# or pick a harness explicitly: --tool claude-code|codex|kiro|kiro-ide
# then, inside your AI tool: /rdlc-start
```

One harness-neutral core, rendered natively for **Claude Code, Codex CLI,
Kiro CLI, and Kiro IDE** — the same stage requirements, security policy, and
artifact contracts everywhere; every distribution tree is generated from the
authored core and CI fails on drift.

```text
Idea / scope doc / tracker / documents -> Captures -> Requirements -> Approvals -> Baselines
                                  \          |             |              \
                                   \---- source snapshots + hashes         \-> Jira / GitHub / ADO
```

> [!NOTE]
> This repository is in pre-release development against specification version
> 0.2.0 (see [the specification](docs/requirements-development-lifecycle-specification.md)
> and [baseline record](docs/specification-baseline.md)). Conformance is
> declared module-by-module; no capability is considered implemented until its
> linked issue, tests, and independent review evidence are complete.

> [!IMPORTANT]
> Generative AI can make mistakes. R-DLC never treats an AI-generated
> requirement, estimate, dependency, or approval as truth — agents propose;
> deterministic controls and authorized humans govern.

## Why R-DLC

Requirements work fragments across meeting notes, documents, trackers, chat
threads, and individual memory. Requirements lose their evidence, approvals go
stale silently, duplicates accumulate, and Jira/GitHub/Azure DevOps drift into
inconsistent copies. R-DLC puts structure around requirements the way CI puts
structure around code: every requirement traces to source snapshots and
hashes, approvals bind verified identities to exact package hashes, external
writes are previewed transactions with receipts, and agent work resumes from
durable checkpoints.

## Key features

- **Capture → promote → approve → baseline** — governed lifecycle with
  explicit human gates and immutable approval evidence (spec §14, §27)
- **Bounded document intake** — anchored evidence from PDF, Office, diagrams,
  images, and email without executing untrusted content, with coverage
  reported honestly — a bounded scan is never presented as a full read
  (spec §16)
- **Canonical identity and hashing** — UUIDv7 identities and the
  `rdlc-jcs-v1` RFC 8785 hash profile family (spec §12)
- **Two connected graphs** — a requirements trace graph and a configurable
  delivery hierarchy, linked by typed relationships (spec §9, §13)
- **Ten-role agent roster** — facilitator, business-analyst, product-owner,
  portfolio-analyst, requirements-reviewer, traceability-auditor,
  test-designer, integration-manager, compliance-reviewer, delivery-planner —
  with declared tool confinement on every harness (reviewer roles read-only)
- **Multi-BA collaboration** — advisory work claims, coverage and collision
  review, optimistic concurrency, and mutation leases (spec §35)
- **Safe connector writes** — capability discovery, changeset preview,
  idempotent apply, read-back verification, and receipts for Jira, GitHub,
  and Azure DevOps (spec §29–33)
- **Knowledge-grounded requirements** — optional
  [K-DLC](https://github.com/aithinkers/knowledge-dlc) integration: cite
  `kb://` concepts as evidence, pin the grounding in a tamper-evident
  knowledge lock whose digest rides in approval packages and baselines, and
  turn knowledge drift into impact-review findings instead of silent staleness
  (spec §10, §17); greenfield engagements need only an idea or a scope document

## Step 1 — add R-DLC to your AI tool

R-DLC is designed to be used *inside* your AI tool: the agents drive the
lifecycle (capture → triage → draft → review → approve → baseline → sync) and
stop at the gates for your decisions. One installer places any harness surface
into your project:

```bash
npx github:aithinkers/requirements-dlc --target <project-directory> [--tool <harness>]
```

| Harness | Setup | Invoke |
| --- | --- | --- |
| **Claude Code** | default `--tool claude-code` installs the 28 commands + 10 role agents into `.claude/`; or install as a plugin: `claude plugin marketplace add <checkout> && claude plugin install rdlc@rdlc` | `/rdlc-<verb>`, `rdlc-<role>` agents |
| **Codex CLI** | `--tool codex` writes `.codex/` (skill + agents) | `$rdlc` skill, `.codex/agents/rdlc-<role>` |
| **Kiro CLI** | `--tool kiro` writes `.kiro/` (skills + agents) | `/rdlc-<verb>`, `.kiro/agents/rdlc-<role>` |
| **Kiro IDE** | `--tool kiro-ide` writes `.kiro/` with session hooks: orientation on your first prompt and a guard that blocks direct edits to approvals, baselines, and the installed reference playbook | `rdlc` front-door agent, `/rdlc-<verb>` |

Every install also scaffolds a §47-defaults `requirements-project.yaml`, the
`rdlc/` engagement layout, and the shared reference playbook (stage protocol,
stage graph, scope profiles) — idempotently, without clobbering your edits.

## Step 2 — talk to it

Inside the harness, work conversationally; the agents follow the governed
procedures and surface decisions:

```text
you>  /rdlc-start — new engagement for the checkout modernization RFP, here's the scope doc
rdlc> Captured verbatim with provenance. Scope understanding: 3 objectives,
      14 candidate requirements, 2 contradictions, 5 open questions — correct
      me before I draft anything.
you>  objective 2 is out of scope; answer the rest from the attached FAQ
rdlc> 11 requirements drafted, each tracing to its source snapshot. The
      reviewer flags REQ-104's retention window as unbounded. Approve the
      other ten?
you>  approved
rdlc> Approval package sealed (hash b9d2…). /rdlc-baseline when you want the
      immutable cut; /rdlc-sync previews the Jira changeset before anything
      is written.
```

## The day-to-day verbs

Day to day you mostly need these — everything else is inspection or
automation:

```text
/rdlc-start      start or resume: where the engagement stands + the next step
/rdlc-capture    feed it anything — pasted text, documents, tracker items
/rdlc-draft      turn captures into requirements with evidence
/rdlc-review     governed review with findings you resolve, accept, or waive
/rdlc-approve    your gate: identity-bound approval evidence, package hashes
/rdlc-baseline   the immutable cut approvals and audits point back to
/rdlc-sync       previewed, receipted writes to Jira / GitHub / ADO
```

Inspection anytime: `/rdlc-status`, `/rdlc-coverage`, `/rdlc-collisions`,
`/rdlc-trace`, `/rdlc-doctor`.

## Repository layout

Schemas, commands, roles, stages, scopes, and templates live under `core/`;
the engine library under `core/lib/`; generated harness output under
`distribution/<harness>/` (layout parity with K-DLC per
[ADR-002](docs/decisions/0002-distribution-layout-parity.md)). The installer
is [scripts/setup.mjs](scripts/setup.mjs). Full walkthrough:
[docs/getting-started.md](docs/getting-started.md).

## Development status and governance

- [Specification baseline](docs/specification-baseline.md) ([full spec](docs/requirements-development-lifecycle-specification.md))
- [Issue backlog](https://github.com/aithinkers/requirements-dlc/issues)
- [Traceability index](docs/traceability.json)
- [Agent development contract](AGENTS.md) — issue → plan → implementation → tests → independent review → release evidence
- [Machine-readable conformance](distribution/release/conformance-statement.json)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## Local governance checks

```bash
node scripts/verify-governance.mjs
npm test
```

## License

[MIT](LICENSE)
