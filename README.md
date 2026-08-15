# R-DLC — governed, agent-assisted requirements development

**R-DLC (Requirements Development Lifecycle)** is a harness-neutral,
agent-assisted lifecycle for capturing, discovering, defining, reviewing,
approving, tracing, planning, testing, synchronizing, and maintaining
requirements — with portable files as the durable contract and deterministic
controls governing what agents propose.

```text
Idea / scope document / tracker / Confluence sources
              |
              v
      R-DLC requirement records
       /        |          \
      v         v           v
 delivery plan  tests    approval evidence
              |
              v
     Jira / GitHub / Azure DevOps
```

One authored core, rendered natively for **Claude Code, Codex, Kiro CLI, and
Kiro IDE**, with capability-mapped read/write connectors for Jira, GitHub, and
Azure DevOps. Optional [K-DLC](https://github.com/aithinkers/knowledge-dlc)
integration grounds requirements in governed knowledge; greenfield engagements
need only an idea or a scope document.

> [!NOTE]
> This repository is in pre-release development against specification version
> 0.2.0 (see [the specification](docs/requirements-development-lifecycle-specification.md)
> and [baseline record](docs/specification-baseline.md)). No capability is
> considered implemented until its linked issue, tests, and independent review
> evidence are complete. Reference release 0.1 targets `Core`, `Planning`,
> `Governed-Basic`, `Connected:Jira-Cloud-Company-Managed`, and
> `Harness:Claude-Code`.

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

## Key capabilities (specification targets)

- **Capture → promote → approve → baseline** — governed lifecycle with
  explicit human gates and immutable approval evidence (spec §14, §27)
- **Canonical identity and hashing** — UUIDv7 identities and the
  `rdlc-jcs-v1` RFC 8785 hash profile family (spec §12)
- **Two connected graphs** — a requirements trace graph and a configurable
  delivery hierarchy, linked by typed relationships (spec §9, §13)
- **Multi-BA collaboration** — advisory work claims, coverage and collision
  review, optimistic concurrency, and mutation leases (spec §35)
- **Safe connector writes** — capability discovery, changeset preview,
  idempotent apply, read-back verification, and receipts (spec §29–33)
- **Bounded document intake** — anchored evidence from PDF, Office, diagrams,
  images, and email without executing untrusted content (spec §16)

## Development process

This repository uses issue-first, review-gated development enforced by CI.
Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before
contributing. Every change maps to a GitHub issue, a traceability entry in
[docs/traceability.json](docs/traceability.json), and a pull request whose
branch, commits, and body are validated by the governance workflows.

## License

[MIT](LICENSE)
