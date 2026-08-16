# Requirements Development Lifecycle Specification

Status: Draft for implementation  
Framework name: Requirements-DLC (R-DLC)  
Repository: `requirements-dlc`  
Machine namespace: `rdlc`  
Specification version: 0.2.0  
Specification date: 2026-08-15

## 1. Executive Summary

Requirements-DLC (R-DLC) is a harness-neutral, agent-assisted lifecycle for
capturing, discovering, defining, reviewing, approving, tracing, planning,
testing, synchronizing, and maintaining requirements.

R-DLC connects governed knowledge to delivery execution:

```text
Idea / scope document / tracker / Confluence sources
              /                         \
             v                           v
  direct engagement evidence     optional K-DLC knowledge
              \                         /
               v                       v
                 R-DLC requirement records
                  /        |          \
                 v         v           v
           delivery plan  tests     approval evidence
                 |
                 v
         Jira / GitHub / Azure DevOps
                 |
                 v
         AI-DLC and other delivery workflows
```

R-DLC is intended for business analysts, product owners, product managers,
project and program managers, PMO teams, architects, quality engineers,
compliance teams, operations teams, and delivery teams. It supports software
and non-software work.

The framework is not a replacement for Jira, GitHub, Azure DevOps, a product
portfolio management suite, a knowledge base, or a test management suite. It
provides a portable semantic and governance layer over those systems. R-DLC
artifacts remain inspectable without a proprietary service, while external
tools serve as collaboration, approval, planning, and execution surfaces.
K-DLC integration is optional; a user can start greenfield with only an idea or
a high-level scope document.

The complete product target supports Claude Code, Codex, Kiro CLI, and Kiro IDE
from one harness-neutral core and provides read/write connectors for Jira,
GitHub, and Azure DevOps. Reference implementation releases deliver these
capabilities incrementally; full product capability is a 1.0 target rather
than a 0.1 release requirement.

Suggested repository description:

> Agent-native, knowledge-grounded lifecycle for creating, validating,
> tracing, testing, and synchronizing requirements across delivery tools.

## 2. Normative Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, NOT RECOMMENDED, MAY, and OPTIONAL in this document are to be
interpreted as described by RFC 2119 and RFC 8174 when, and only when, they
appear in all capitals.

Unless a clause names another subject, a normative statement binds an
implementation claiming the applicable R-DLC conformance module. Statements
that explicitly name the `reference distribution` are delivery commitments for
that product and do not bind third-party implementations. Statements addressed
to a project, connector, policy, or user define observable behavior exposed by
a conforming implementation.

Examples use Markdown and YAML for readability. Reference distribution release
0.1 SHALL use portable files as its durable and runtime interoperability
contract. An implementation
MAY use in-memory indexes or temporary caches, but a persistent SQLite runtime,
search index, or transaction cache is deferred to a future release. Adding it
MUST NOT make the database authoritative over the portable artifacts.

### 2.1 Normative references

- [RFC 2119: Key words for use in RFCs to Indicate Requirement Levels](https://www.rfc-editor.org/rfc/rfc2119.html)
- [RFC 8174: Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words](https://www.rfc-editor.org/rfc/rfc8174.html)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 9562: Universally Unique IDentifiers](https://www.rfc-editor.org/rfc/rfc9562.html)
- [RFC 3339: Date and Time on the Internet](https://www.rfc-editor.org/rfc/rfc3339.html)

### 2.2 Informative references

The following projects and documents influenced the design but are not runtime
dependencies of R-DLC:

- [AWS AI-DLC Workflows](https://github.com/awslabs/aidlc-workflows/tree/v2)
- [AWS AI-DLC phases and stages](https://awslabs.github.io/aidlc-workflows/guide/04-phases-and-stages/)
- [AWS AI-DLC state and audit](https://awslabs.github.io/aidlc-workflows/guide/10-state-and-audit/)
- [AWS AI-DLC session management](https://awslabs.github.io/aidlc-workflows/guide/11-session-management/)
- [AWS AI-DLC Kiro IDE harness](https://awslabs.github.io/aidlc-workflows/guide/harnesses/kiro-ide/)
- [gstack](https://github.com/garrytan/gstack)
- [K-DLC specification](https://github.com/aithinkers/knowledge-dlc/blob/main/docs/knowledge-development-lifecycle-specification.md)

R-DLC adopts the useful concepts of adaptive stages, explicit artifacts,
human gates, persistent workflow state, recovery, role-based review, and small
composable commands. It defines its own requirement model and lifecycle rather
than copying a software construction lifecycle.

### 2.3 Specification governance and versioning

R-DLC specifications use semantic versioning:

- Before 1.0, a minor version MAY introduce an incompatible correction when it
  includes migration guidance and clearly marks the break. Patch versions are
  editorial or backward-compatible clarifications.
- At and after 1.0, a major version indicates incompatible artifact, protocol,
  lifecycle, or conformance changes; a minor version adds backward-compatible
  capability; a patch version contains backward-compatible fixes.

Specification versions and reference-distribution release versions are
independent. In this document, reference distribution 0.1 is the first
implementation milestone against specification 0.2; it does not imply
conformance to the earlier specification 0.1 draft.

A specification change SHALL include the problem, proposed normative change,
compatibility impact, migration impact, security and governance impact,
conformance-test changes, and reviewer decision. Accepted changes SHALL appear
in the version history. The canonical repository SHOULD protect specification
changes through review and signed release tags.

An implementation conformance claim SHALL identify:

```yaml
specification: rdlc
specification_version: 0.2.0
implementation: example-rdlc
implementation_version: 0.1.0
modules:
  - Core
  - Planning
  - Governed-Basic
connectors:
  - Connected:Jira-Cloud-Company-Managed
harnesses:
  - Harness:Claude-Code
exceptions: []
test_report: reports/conformance.json
```

Claims MUST NOT use `Full` when any required module, connector, harness, or
conformance test is missing.

### 2.4 Version history and migration

| Version | Date | Summary |
|---|---|---|
| 0.1.0 | 2026-08-15 | Initial design draft. |
| 0.2.0 | 2026-08-15 | Critical-review revision: phased conformance, engagement terminology, UUID identities, canonical hashing, lifecycle dimensions, verified approver identities, regulated integrity, distributed leases, synchronization cursors, retention and redaction, scale targets, separated deterministic and semantic evaluation, and version-anchored Confluence source profiles. |

Version 0.2.0 is an intentionally incompatible pre-1.0 clarification. A 0.1
project migrating to 0.2 SHALL:

1. Rename workflow-container records and paths from `initiative` or
   `initiatives/` to `engagement` and `engagements/`; the term `initiative`
   remains available as a planning-item type.
2. Mint a canonical UUIDv7 for every existing artifact, retain the old typed
   identifier as a display alias, and rewrite relationships to UUID URNs.
3. Split any single lifecycle status into governance, synchronization,
   verification-progress, and verification-outcome dimensions without
   inferring evidence that did not exist.
4. Rebuild approval packages with the `rdlc-jcs-v1` hash profile. Existing 0.1
   approvals MAY be retained as historical evidence but MUST NOT be represented
   as 0.2 or `Governed-Regulated` approvals without a new conforming decision.
5. Upgrade schema identifiers from `v0.1` to the applicable `v0.2` schema only
   after successful migration validation. Migration SHALL be idempotent and
   produce a report mapping every old identity, status, and approval record to
   its new representation.

No conforming 0.1 project is known to exist. This migration procedure is
retained as a conformance fixture requirement (§44.1) and is otherwise
informative until an implementation claims a 0.1-to-0.2 migration.

## 3. Problem Statement

Requirements work is commonly fragmented across meeting notes, documents,
knowledge bases, spreadsheets, issue trackers, chat threads, approval tasks,
and individual memory. This creates predictable failures:

1. Requirements cannot be traced to their evidence or business outcome.
2. Epics and stories are treated as a universal requirement model even though
   organizations use those terms differently.
3. Important comments remain buried in issue discussions.
4. Requirements are approved without all required reviewers participating.
5. Approved content changes without invalidating its approval evidence.
6. Duplicate, overlapping, conflicting, or untestable work accumulates.
7. Story dependencies and component impacts are discovered too late.
8. Test cases are disconnected from acceptance criteria.
9. Jira, GitHub, and Azure DevOps become inconsistent copies of one another.
10. Agent work cannot resume reliably after context compaction or a new
    session.
11. AI-generated plans appear authoritative even when they contain unresolved
    assumptions or unsupported facts.
12. Non-development work is forced into fake user stories.

R-DLC addresses these failures using portable records, typed relationships,
source provenance, deterministic validation, explicit promotion, stakeholder
readiness gates, safe connector write plans, and resumable state.

## 4. Goals

This section is informative. R-DLC is designed to:

1. Create requirements from an idea, problem, objective, source collection, or
   existing backlog.
2. Let users capture incomplete material before it is promoted into a formal
   requirement.
3. Start from an idea, a high-level scope document, an existing tracker, direct
   external sources, optional K-DLC knowledge bases, or any combination.
4. Preserve the revision, author, timestamp, and location of source evidence.
5. Support business, stakeholder, functional, non-functional, transition, and
   compliance requirements.
6. Organize delivery work using configurable portfolio epics, initiatives,
   epics, capabilities, features, stories, and tasks.
7. Support non-development work without pretending it is a user story.
8. Suggest and record business, product, process, data, integration, and
   technical components.
9. Generate typed story and work-item dependencies with rationale.
10. Detect dependency cycles and identify parallel planning waves.
11. Provide customizable templates, artifact types, terminology, workflows,
    quality rules, and approval policies.
12. Treat traceability as a graph rather than a fixed parent-child tree.
13. Detect duplicate, overlapping, conflicting, ambiguous, incomplete, and
    untestable content.
14. Review tracker comments and turn accepted feedback into traceable changes.
15. Generate draft test cases from approved requirements, acceptance criteria,
    business rules, and non-functional requirements.
16. Support RAID and optional RAID+D registers.
17. Configure story points, T-shirt sizing, time, three-point estimates,
    no-estimate flow, and custom estimation schemes.
18. Obtain readiness decisions from all required approvers before baseline or
    publication.
19. Read from and write to Jira, GitHub, and Azure DevOps safely.
20. Resume from durable checkpoints across sessions and supported harnesses.
21. Run from one authored core in Claude Code, Codex, Kiro CLI, and Kiro IDE.
22. Maintain an auditable history of capture, promotion, review, approval,
    synchronization, and change.
23. Discover or load the company's delivery setup and map accepted semantic
    artifacts to its standard and custom issue types.

## 5. Non-Goals

R-DLC does not initially:

1. Replace Jira, GitHub Projects, Azure Boards, or a full PPM platform.
2. Replace K-DLC as a governed knowledge publishing and maintenance system.
   R-DLC performs bounded document intake for the active requirements workflow
   but does not turn that intake into a reusable knowledge base automatically.
3. Guarantee that an AI-generated requirement, estimate, dependency, or test
   case is correct.
4. Allow an AI agent to grant final approval on behalf of a human stakeholder.
5. Treat every identified stakeholder as a mandatory approver.
6. Treat an issue comment as an approved requirement change automatically.
7. Treat an issue status transition as sufficient approval unless a configured
   mapping explicitly defines that behavior.
8. Convert story points to time or T-shirt sizes to points without an explicit
   organization policy.
9. Promise delivery dates from estimates alone.
10. Automatically merge suspected duplicates.
11. Automatically resolve material conflicts or dependency cycles.
12. Make an external tracker the only readable copy of a baseline.
13. Turn every task into a user story.
14. Make generated test cases count as verification evidence before execution
    and review.
15. Bypass source or tracker access controls.

## 6. Design Corrections Adopted by This Specification

The initial concept has been adjusted in the following ways:

1. **Requirements and planning are related but distinct.** Business needs and
   solution requirements form a requirements graph. Portfolio epics, epics,
   stories, and tasks form a delivery graph. Typed links connect them.
2. **All stakeholders are not all approvers.** The stakeholder registry records
   everyone affected or involved. Approval policies name the required
   approvers, roles, groups, quorum, order, and escalation rules.
3. **Trackers are both sources and projections.** Jira, GitHub, and Azure DevOps
   can provide inception evidence and can receive approved or draft work. Each
   direction preserves provenance and revision state.
4. **Comments are review inputs.** Comments can challenge or improve a
   requirement, but they do not mutate it until accepted through a review
   action.
5. **Component suggestions are candidates.** Suggested components remain
   unconfirmed until a user accepts, edits, or rejects them.
6. **Dependencies require rationale.** A generated dependency without evidence
   or reasoning is not planning truth.
7. **Approval and promotion are different.** Captured material is promoted into
   a draft; reviewed content becomes ready for approval; an authorized human
   grants approval.
8. **External writes are transactions with receipts.** Every write is planned,
   approved according to policy, applied idempotently, verified by read-back,
   and recorded.
9. **State lives outside chat.** Resume is based on durable project state and
   artifacts rather than conversation memory.
10. **Customization is governed.** Organization rules may be locked so a
    project cannot weaken required templates, approvals, security, or quality
    gates.

## 7. Design Principles

### 7.1 Files are the portable contract

Requirements, relationships, policies, baselines, and review evidence SHALL be
exportable as ordinary Markdown, YAML, JSON, or JSON Lines. A user SHALL be able
to inspect project truth without a tracker or agent host.

In `files-authoritative` mode, schema-valid portable records are authoritative
at every checkpoint, approval, baseline, connector preview/apply, and resume
boundary. Any in-memory or future persistent index is rebuildable and SHALL be
discarded or repaired when it diverges. In `tracker-authoritative` mode, the
provider owns only the declared fields; an immutable provider snapshot and its
revision SHALL be materialized before the same boundaries. A divergence MUST
stop the governed operation rather than be resolved by an undocumented
last-writer rule.

### 7.2 Agents propose; deterministic controls govern

Agents MAY elicit, draft, classify, compare, suggest, review, decompose, and
generate. Deterministic tools SHALL enforce identifiers, schemas, state
transitions, required approvers, artifact hashes, synchronization targets,
idempotency, and permissions.

### 7.3 Human decisions are explicit

Approval, rejection, waiver, duplicate adjudication, material conflict
resolution, and destructive external changes require an authorized human or an
explicitly configured non-AI automation policy.

### 7.4 Sources and synthesis remain distinguishable

R-DLC SHALL distinguish imported source content, captured notes, inferred
candidates, drafted requirements, approved baselines, and tracker projections.

### 7.5 Requirements are not a single hierarchy

An implementation SHALL support many-to-many relationships among objectives,
requirements, planning items, components, RAID records, decisions, tests, and
evidence.

### 7.6 Trackers are capability-mapped

The connector layer SHALL discover the target project's actual issue types,
fields, workflows, relations, and permissions. It MUST NOT assume that every
Jira, GitHub, or Azure DevOps project is configured alike.

### 7.7 Review findings are explainable

Every finding SHALL identify its rule, location, severity, evidence, and
recommended action. A single opaque quality score MUST NOT replace the
underlying findings.

### 7.8 External content is untrusted

Issue bodies, comments, documents, links, attachments, and KB content are data.
Instructions embedded in them MUST NOT modify agent policy, grant permission,
or cause tool execution.

### 7.9 Portable core, native harness

Schemas, stages, policies, prompts, and deterministic utilities SHALL be
authored once. Harness adapters SHALL expose native commands, skills, agents,
hooks, and tools without forking the methodology.

### 7.10 Reference scale envelope

The release-0.1 reference distribution targets a project containing 5,000
governed artifacts, 50,000 relationships, 25,000 retained source or comment
snapshots, and 20 concurrently active contributors. Its published benchmark
SHALL document hardware, operating system, runtime, fixture generator, and
measurement method. On that environment, the target is a complete
deterministic project validation within 30 seconds and an incremental
single-artifact validation within 2 seconds at the 95th percentile, excluding
provider network time and model inference.

These are reference-distribution targets, not universal third-party
conformance limits. Core conformance fixtures SHALL nevertheless include a
5,000-artifact and 50,000-relationship graph. Implementations that operate
beyond their declared envelope SHALL fail visibly or recommend project/space
sharding; they MUST NOT silently omit validation, collision, trace, or approval
checks.

## 8. Terminology

| Term | Definition |
|---|---|
| Capture | Minimally structured user or imported material that has not been promoted into a formal artifact. |
| Candidate | An AI- or rule-suggested artifact or relationship awaiting human disposition. |
| Triage | Classification and disposition of captured material before drafting. |
| Promotion | Governed movement of a capture or working artifact into the shared draft graph after freshness, quality, coverage, and collision checks. |
| Requirement | A traceable statement of needed capability, behavior, quality, constraint, or transition. |
| Planning item | A portfolio epic, initiative, epic, capability, feature, story, or task used to organize delivery. |
| Non-development task | Work such as research, procurement, training, legal review, migration, documentation, or operations. |
| Acceptance criterion | A verifiable condition that contributes to acceptance of a requirement or planning item. |
| Component | A business, product, process, data, integration, application, service, UX, organizational, or external boundary affected by work. |
| Dependency | A typed relationship that constrains order, readiness, or completion. |
| RAID | Risks, assumptions, issues, and dependencies. |
| RAID+D | RAID with decisions represented as a first-class related artifact. |
| Review finding | A deterministic or semantic observation requiring resolution, waiver, or acknowledgement. |
| Readiness | The condition that required content, review, trace, and stakeholder gates have passed. |
| Approval package | Immutable review content and hashes presented to designated approvers. |
| Baseline | An approved, versioned snapshot of requirements, relationships, evidence locks, and decisions. |
| Material change | A change that can alter meaning, scope, acceptance, traceability, governance, security, delivery commitment, or an approval decision under the resolved materiality policy. |
| Waiver | Authorized, scoped, reasoned, and time-bounded acceptance of an unmet rule or finding; it is not evidence that the rule passed. |
| Source snapshot | Retained content and provenance from a particular external revision. |
| Source lock | Reproducible manifest of selected external source identities, revisions, hashes, selection policy, and unresolved dependencies used by a review or baseline. |
| Projection | A representation of R-DLC artifacts in Jira, GitHub, Azure DevOps, a report, or another rebuildable view. |
| Connector | Provider-specific implementation of the common external read/write contract. |
| Changeset | Planned external mutations and their preconditions, targets, and approval state. |
| Changeset preview | Human- and machine-readable rendering of exact proposed external operations before authorization. |
| Receipt | Verified record of a connector operation and the external revision it produced. |
| Synchronized | Connector state indicating that the read-back projection matches the approved changeset under its mapping version. |
| Planning wave | A set of work items that may proceed in parallel after their hard prerequisites are satisfied. |
| Canonical identity | Immutable UUID URN used for relationships, approvals, baselines, signatures, and idempotency. |
| Display alias | Human-readable, mutable identifier such as `REQ-104`; never the canonical identity. |
| Principal | Canonical human or non-human actor identity to which roles, authority, and verified provider accounts are bound. |
| Verified binding | Audited association between a canonical principal and an authenticated immutable provider or harness subject. |
| Working artifact | Author-scoped, incomplete work that has not passed the shared-draft promotion gate. |
| Work claim | Time-bounded advisory declaration that a user is working on specified requirements, components, or planning scope. |
| Lease | Short-lived exclusive authority for a bounded mutation such as alias allocation, baseline creation, or connector apply. |
| Promotion review | Coverage, collision, quality, freshness, and mapping checks performed before working content enters the shared graph. |
| Collision | Concurrent or semantic incompatibility involving identity, edits, coverage, behavior, hierarchy, dependencies, approvals, or external state. |
| Redaction tombstone | Minimal governed evidence that identified content was removed under stated authority while retaining its original hash. |
| Redaction addendum | Append-only record that binds tombstones and resulting availability state to an unchanged historical baseline root. |
| Semantic evaluation | Versioned, scored assessment of nondeterministic model behavior; distinct from exact conformance testing. |
| Space | Shared configuration, memory, policy, and knowledge context containing one or more engagements. |
| Engagement | A resumable R-DLC workflow and its complete capture, artifact, state, review, approval, and synchronization record. |
| Initiative | A configurable portfolio or delivery planning item between a portfolio epic and an epic. |
| Harness | An agent environment such as Claude Code, Codex, Kiro CLI, or Kiro IDE. |

## 9. Conceptual Architecture

```text
+-------------------------------------------------------------------+
| User and stakeholder interaction                                  |
| Capture | Workshops | Reviews | Approvals | Comments | Decisions  |
+-------------------------------------------------------------------+
                              |
+-------------------------------------------------------------------+
| R-DLC conductor and lifecycle engine                              |
| State | Stage routing | Gates | Recovery | Audit | Role lenses    |
+-------------------------------------------------------------------+
          |                    |                    |
+------------------+ +-------------------+ +-------------------------+
| Semantic records | | Deterministic     | | Agent-assisted work     |
| Requirements     | | controls          | | Elicitation             |
| Planning         | | Schemas           | | Drafting                |
| Components       | | Trace checks      | | Semantic review         |
| RAID+D            | | Connector plans   | | Dedupe candidates       |
| Tests            | | Hashes/receipts   | | Tests/dependencies      |
+------------------+ +-------------------+ +-------------------------+
          |                    |                    |
+-------------------------------------------------------------------+
| Integrations                                                      |
| Documents | Confluence | optional K-DLC | Jira | GitHub | ADO      |
+-------------------------------------------------------------------+
```

### 9.1 Authority modes

Each connected project SHALL declare one of these modes:

| Mode | Behavior |
|---|---|
| `files-authoritative` | R-DLC portable artifacts are canonical; trackers are sources and projections. This is the default. |
| `tracker-authoritative` | A configured tracker is canonical for selected fields; R-DLC retains snapshots, analysis, relationships, and governance evidence. |
| `governed-bidirectional` | Both sides may change; a three-way merge and conflict gate precede writes. |

Authority MAY be defined per artifact type or field. For example, Jira MAY own
status and assignee while R-DLC owns rationale, evidence, traceability, and
approval packages.

### 9.2 Two connected graphs

The normative semantic backbone is:

```text
Objective -> Need -> Requirement -> Acceptance criterion
                                      |
                                      v
                                  Test case -> Result/evidence
```

The configurable delivery view is:

```text
Portfolio epic -> Initiative -> Epic -> Capability -> Feature -> Story -> Task
```

Relations such as `satisfies`, `implements`, and `tested-by` connect the two.
An organization MAY use a profile in which a story serves both requirement and
delivery roles, but its trace obligations remain explicit.

## 10. Conformance Modules

An implementation SHALL declare the modules and connector profiles it supports.

| Module | Required capability |
|---|---|
| `Core` | Capture, artifact records, templates, lifecycle state, trace graph, validation, audit, and resume. |
| `Knowledge-Grounded` | Optional K-DLC consumer contract, evidence references, locks, and knowledge change impact. |
| `Planning` | Planning hierarchy, components, dependencies, estimation, delivery waves, and non-development tasks. |
| `Governed-Basic` | Identity-bound readiness policies, stakeholder approvals, waivers, baselines, change control, protected history, and integrity checking. It does not claim non-repudiation. |
| `Governed-Regulated` | `Governed-Basic` plus separation of duties, signed approval decisions, trusted identity, trusted time, and an external tamper-evident baseline anchor. |
| `Verification` | Acceptance criteria, test generation, coverage, and verification evidence. |
| `Portfolio` | Portfolio objectives, benefits, cross-project dependencies, milestones, RAID roll-up, and status reporting. |
| `Connected:Jira-Cloud-Company-Managed` | Jira Cloud company-managed project import, comments, attachments, changesets, read/write, links, transitions, and receipts. |
| `Connected:Jira-Cloud-Team-Managed` | Jira Cloud team-managed project capability profile. |
| `Connected:Jira-Service-Management` | Jira Service Management request and native approval capability profile. |
| `Connected:Jira-Data-Center` | Jira Data Center capability profile for declared supported versions. |
| `Connected:GitHub-Issues` | GitHub issue, comment, label, sub-issue, dependency, and receipt capability. |
| `Connected:GitHub-Projects` | GitHub Projects membership and field capability in addition to `Connected:GitHub-Issues`. |
| `Connected:AzureDevOps-Boards` | Azure Boards capability for each declared process template. |
| `Source:Confluence-Cloud` | Read-only Confluence Cloud page, hierarchy, version, label, attachment, and comment snapshots with permission-aware provenance. |
| `Source:Confluence-Data-Center` | Read-only Confluence Data Center source profile for explicitly declared supported versions. |
| `Harness:Claude-Code` | Native Claude Code commands, skills, state, and recovery. |
| `Harness:Codex` | Native Codex skills, state, and recovery. |
| `Harness:Kiro-CLI` | Native Kiro CLI adapter. |
| `Harness:Kiro-IDE` | Native Kiro IDE adapter. |
| `Service:MCP` | Authenticated MCP resources and tools over the same core for compatible desktop or remote clients. |
| `Webhook-Receiver` | Optional persistent receiver or relay for webhook/service-hook delivery. |
| `Full` | All stable 1.0 modules, connector profiles, and harness profiles declared by the 1.0 conformance manifest. |

The reference distribution delivers profiles incrementally and MUST NOT claim
`Full` before the 1.0 conformance manifest and all of its required tests exist.
Its first release targets `Core`, `Planning`, `Governed-Basic`,
`Connected:Jira-Cloud-Company-Managed`, and `Harness:Claude-Code`. Individual
projects are not required to configure K-DLC or enable every capability the
implementation provides. Third-party implementations MAY support selected
profiles and MUST report that scope accurately.

## 11. Project Structure

A recommended project layout is:

```text
requirements-project.yaml
requirements.lock
[knowledge-project.yaml]  # optional when K-DLC is enabled
[knowledge.lock]          # optional when K-DLC is enabled
rdlc/
  active-space
  spaces/
    <space>/
      policy/
      templates/
      taxonomy/
      memory/
      components/
      stakeholders/
      identities/
      collaboration/
        claims/
        leases/
        promotion-reviews/
        collision-decisions/
      engagements/
        <engagement-id>/
          rdlc-state.yaml
          recovery.yaml
          capture/
          sources/
          artifacts/
            objectives/
            requirements/
            planning/
            components/
            raid/
            decisions/
            tests/
          trace/
          reviews/
          approvals/
          baselines/
          changesets/
          sync/
          reports/
          audit/
```

The active-space cursor SHOULD be local runtime state and SHOULD NOT be shared
when multiple clones operate independently. Connector synchronization cursors
are durable engagement state and SHALL be coordinated by their configured
lease authority. Engagement artifacts, state, baselines, approvals, and audit
shards SHOULD be committed when the project uses Git collaboration.

### 11.1 Project manifest

```yaml
schema_version: rdlc.project/v0.2

project:
  id: checkout-modernization
  title: Checkout Modernization
  default_space: commerce
  authority_mode: files-authoritative

inputs:
  scope_documents:
    - path: inputs/checkout-modernization-scope.docx
      role: primary-scope
  confluence:
    - connection: product-confluence
      space_ids:
        - "98421"
      root_page_ids:
        - "123456"
      include_descendants: true
      include:
        - pages
        - attachments
        - comments
      mode: read-only

knowledge:
  enabled: false

company_setup:
  profile: config/company/delivery-profile.yaml
  discovery: merge-profile-and-tracker
  unknown_issue_type_policy: ask

taxonomy:
  profile: product-delivery
  portfolio_enabled: true
  hierarchy:
    - portfolio-epic
    - initiative
    - epic
    - capability
    - feature
    - story
    - task

templates:
  packs:
    - core
    - organization
    - commerce

approval:
  default_policy: all-required-by-role
  material_change_policy: invalidate-affected

collaboration:
  lease_authority:
    kind: git-ref-compare-and-swap
    remote: origin
    ref_namespace: refs/rdlc/leases
  alias_authority: lease-protected-counter

estimation:
  default_profile: team-story-points
  allow_ai_suggestions: true
  confirmation_required: true

connectors:
  - id: product-confluence
    provider: confluence-cloud
    mapping: config/sources/confluence-product.yaml
    write_mode: read-only
  - id: delivery-jira
    provider: jira
    mapping: config/connectors/jira-commerce.yaml
    write_mode: approve-each-batch
  - id: engineering-github
    provider: github
    mapping: config/connectors/github-engineering.yaml
    write_mode: propose

security:
  external_content: untrusted
  secrets_provider: environment
```

When K-DLC is enabled, the `knowledge` section additionally declares the
`knowledge-project.yaml` manifest, `knowledge.lock`, and any required mounts.
When it is disabled, no knowledge manifest or lock file is required. Direct
scope-document snapshots and their hashes remain sufficient evidence for an
R-DLC baseline.

Secrets, access tokens, client secrets, and private keys MUST NOT appear in the
project manifest, artifacts, changesets, receipts, or audit logs.

## 12. Identity and Artifact Envelope

### 12.1 Stable identifiers

Every artifact SHALL receive a UUIDv7 conforming to RFC 9562 when it is first
created, including in an offline working branch. Its canonical identity is the
UUID URN:

```text
urn:uuid:<uuidv7>
```

The UUID URN SHALL remain stable when title, type, project, file path,
hierarchy, owner, or tracker changes. UUIDv7's timestamp component MUST NOT be
treated as trusted chronology or approval time.

External provider identifiers are references, not canonical identities. An
imported record without an R-DLC identity receives a UUIDv7; its provider ID is
retained in `external_refs`.

### 12.2 Display aliases and distributed allocation

Human-facing values such as `REQ-104`, `STORY-42`, and `RISK-17` are display
aliases. They MUST NOT be used as canonical relationship targets, approval
subjects, signature subjects, or idempotency identities.

Any offline clone may mint a UUIDv7 without coordination. Sequential display
aliases SHALL be assigned by a configured alias authority during promotion to
shared draft or during import. Alias allocation is a bounded mutation protected
by the lease protocol. A working artifact MAY use a temporary label such as
`TMP-ALEX-17` before promotion.

If two branches propose the same display alias, the alias authority SHALL
retain one and assign another to the second artifact. The canonical UUIDs do
not change. Alias history SHALL retain previous aliases and effective dates so
links and reports remain resolvable.

Qualified forms such as `req://checkout-modernization/REQ-104` MAY be exposed
as resolvable human aliases. A resolver SHALL return the canonical UUID URN and
SHALL detect ambiguous or recycled aliases. Display aliases MUST NOT be reused
within the retention period of their project namespace.

### 12.3 Common envelope

Every governed artifact SHALL contain or resolve these fields:

```yaml
schema_version: rdlc.artifact/v0.2
id: urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10
display_id: REQ-104
project: checkout-modernization
type: functional-requirement
title: Preserve an incomplete checkout
governance_state: draft
version: 3
origin:
  kind: user-capture
  actor: urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012
  captured_at: 2026-08-15T15:00:00Z
statement: >-
  The checkout service shall preserve an authenticated customer's incomplete
  checkout for the configured retention period.
rationale: Reduce abandonment after interruption.
owner: role:product-owner
sources:
  - kb://product/customer-research/interrupted-checkout
  - external://jira/commerce/DISC-42#comment-10017
relationships:
  - type: derives-from
    target: urn:uuid:0198b7d0-5b1e-7a30-9c2d-1e6b8f5a3c09
  - type: affects
    target: urn:uuid:0198b7d5-8c4a-7d22-a142-6b5e3c9f7011
external_refs: []
created_at: 2026-08-15T15:00:00Z
updated_at: 2026-08-15T16:12:00Z
```

Implementations MAY split large bodies from metadata, but hashing,
serialization, and review packets SHALL be deterministic.

### 12.4 Artifact families

R-DLC Core SHALL recognize these semantic families:

1. Intent, vision, problem, objective, outcome, and success measure.
2. Stakeholder need and stakeholder requirement.
3. Business, functional, non-functional, transition, compliance, and data
   requirement.
4. Constraint, business rule, policy applicability, and glossary term.
5. Portfolio epic, initiative, epic, capability, feature, story, and task.
6. Component and component relationship.
7. Risk, assumption, issue, dependency, and decision.
8. Acceptance criterion, test case, test suite, test result, and verification
   evidence.
9. Capture, source snapshot, review finding, waiver, approval, baseline, change
   request, changeset, and receipt.

Organizations MAY add types without replacing the common envelope and typed
relationship contract.

### 12.5 Canonical serialization and hashing

R-DLC defines the `rdlc-jcs-v1` canonicalization profile. Hashes and signatures
that participate in approval, baseline, idempotency, read-back verification,
or cross-host resume SHALL use this profile.

Canonicalization SHALL:

1. Parse the schema-valid logical artifact rather than hash Markdown or YAML
   presentation bytes.
2. Reject duplicate YAML or JSON object keys and values that cannot be
   represented in the schema's I-JSON projection.
3. Normalize all strings to Unicode NFC before canonicalization.
4. Normalize timestamps included by a hash profile to RFC 3339 UTC with a `Z`
   suffix and the precision declared by the schema.
5. Represent exact decimal values, integers outside the I-JSON safe range, and
   durations as schema-defined strings rather than lossy binary floats.
6. Sort set-like arrays by the stable keys declared in the schema. Preserve
   order for order-significant arrays such as process steps and acceptance
   criteria.
7. Serialize the resulting JSON using RFC 8785 JSON Canonicalization Scheme.
8. Hash the UTF-8 canonical bytes using SHA-256.
9. Encode hashes as lowercase `sha256:<64 hexadecimal characters>`.

The following hash profiles are distinct:

| Hash | Included | Excluded |
|---|---|---|
| `source_hash` | Original retained source bytes exactly as received. | Retrieval metadata and extracted text. |
| `content_hash` | Schema-declared semantic fields and governed relationships. | `content_hash`, display rendering, file path, aliases, audit, connector receipts, derived reports, and operational timestamps. |
| `approval_package_hash` | Ordered artifact content hashes, source and optional KB locks, policy versions, required approver set, blocking findings, waivers, and material diff. | Approval decisions, signatures over the package, notification state, and mutable tracker status. |
| `baseline_root_hash` | Canonical manifest of approval-package hashes, artifact hashes, source locks, previously adopted redaction tombstones, and baseline metadata declared material at creation. | Signatures over the root, later redaction addenda, and derived reports. |
| `redaction_addendum_hash` | Original baseline root, ordered redaction tombstones, authority, affected storage boundary, and resulting availability state. | Removed content and mutable deletion-progress logs. |
| `readback_hash` | Provider-normalized fields selected by the versioned connector mapping. | Provider rendering, volatile counters, and fields outside the mapping. |

Absence and explicit `null` are distinct unless a schema states otherwise.
Unknown extension fields SHALL be preserved but are included in a content hash
only when their schema marks them governed. The resolved schema version and
hash-profile version SHALL accompany every hash.

Approvals, signatures, baselines, and external writes SHALL fail closed when
canonicalization fails or a required hash cannot be reproduced. The
conformance suite SHALL include cross-language known-answer fixtures covering
Unicode, timestamps, numeric boundaries, set-like arrays, ordered arrays,
unknown fields, and excluded fields.

### 12.6 Time and causal ordering

All persisted instants SHALL use RFC 3339, normalized to UTC with a `Z` suffix
and the fractional-second precision declared by the schema. A time-bearing
record SHALL distinguish locally observed time, provider-reported time, and
trusted time when more than one is used. Implementations SHOULD record clock
source and uncertainty for security- or approval-relevant events.

Wall-clock timestamps, including the timestamp portion of a UUIDv7, MUST NOT be
used alone for last-writer-wins merging, lease ownership, event deduplication,
or approval order. Causal decisions SHALL prefer artifact versions and hashes,
provider revisions or ETags, changeset operation sequence, cursor tokens, and
atomic lease-authority state. Detected clock regression or excessive skew
SHALL produce a diagnostic and MUST NOT silently reorder governed events.

`Governed-Regulated` trusted-time evidence SHALL identify the trusted-time
profile and bind its token or receipt to the signed decision or baseline root.

## 13. Relationship Model

Core relationship types include:

| Relationship | Meaning |
|---|---|
| `derives-from` | The source artifact provides origin or rationale. |
| `decomposes` | The target is a more detailed expression of the source. |
| `satisfies` | The source fulfills all or part of the target. |
| `implements` | The source is delivery work realizing the target. |
| `validated-by` | The target provides validation of the source. |
| `tested-by` | The target is a test for the source. |
| `evidenced-by` | The target is source or result evidence. |
| `affects` | The source has impact on the target. |
| `owned-by` | The target is responsible for the source. |
| `depends-on` | The source requires the target. |
| `blocks` | The source prevents target progress. |
| `conflicts-with` | The two artifacts cannot both be satisfied as written. |
| `overlaps` | The two artifacts cover some common scope. |
| `duplicates` | The two artifacts express materially the same need or work. |
| `supersedes` | The source replaces the target. |
| `mitigates` | The source reduces the target risk or issue. |
| `resolves` | The source resolves the target. |
| `approves` | The source is an approval decision over the target hash or package. |

Relationship records SHALL include source, target, type, status, origin,
rationale, creator, timestamp, and optional confidence. AI-generated relations
start as candidates unless a deterministic import or configured mapping makes
them authoritative.

## 14. Artifact Lifecycle and Promotion

### 14.1 Main lifecycle

R-DLC separates governance, synchronization, and verification. No state in one
dimension implies a state in another.

```text
Governance:
captured -> triaged -> working -> draft -> reviewed
         -> ready-for-approval -> awaiting-approval -> approved -> baselined
                                                        |
                                                        v
                                              superseded / retired

Synchronization:
not-synchronized -> planned -> applying -> synchronized -> drifted
                                  |              |
                                  v              v
                           failed / uncertain   planned

Verification progress:
not-designed -> designed -> reviewed -> implemented -> executed

Verification outcome:
none | passed | failed | blocked | inconclusive | waived
```

Governance conditions and dispositions are `needs-clarification`,
`collision-review`, `deferred`, `rejected`, and `withdrawn`. They do not imply
synchronization or verification state.

`working` is author- or workstream-scoped content that may be incomplete and is
not yet part of the shared delivery graph. `draft` is shared team-visible
content that has passed the promotion review but is not approved. A project MAY
make working content visible to teammates, but it SHALL preserve its
unpromoted status and author ownership.

#### 14.1.1 State definitions

| Governance state or condition | Meaning |
|---|---|
| `captured` | Raw material exists with provenance but has not been classified. |
| `triaged` | Type, relevance, and next disposition have been assigned. |
| `working` | Author- or workstream-scoped proposed content. |
| `draft` | Shared content that passed promotion checks. |
| `reviewed` | The declared review set ran against the current content hash. |
| `ready-for-approval` | Readiness checks pass and an approval package can be reproduced. |
| `awaiting-approval` | The immutable package is open for its resolved approver set. |
| `approved` | The resolved policy accepted the exact package hash. |
| `baselined` | The approved package is included in an immutable baseline root. |
| `collision-review` | Promotion is paused for one or more blocking collisions. |
| `needs-clarification` | Progress is paused for an identified unanswered question. |
| `deferred` | An authorized decision postpones work without rejecting it. |
| `rejected` | The reviewed revision was declined and remains historical. |
| `superseded` | A later governed revision or baseline replaces this revision. |
| `retired` | The artifact is no longer applicable under an authorized decision. |
| `withdrawn` | Pre-baseline work was intentionally removed from consideration. |

| Synchronization state | Meaning |
|---|---|
| `not-synchronized` | No current provider projection is asserted. |
| `planned` | A changeset exists but has not begun application. |
| `applying` | One or more operations are in progress. |
| `synchronized` | Verified read-back matches the approved changeset and mapping. |
| `drifted` | Current provider state no longer matches the synchronized projection. |
| `failed` | Application stopped with a known non-success result. |
| `uncertain` | The provider outcome is unknown and requires reconciliation. |

Verification-progress states describe whether tests are not yet designed,
designed, reviewed, implemented, or executed. Verification outcome is `none`
until execution evidence or an authorized waiver establishes `passed`,
`failed`, `blocked`, `inconclusive`, or `waived`.

### 14.2 Governance transition table

Only transitions in this table are valid. Every transition SHALL record actor,
time, prior and resulting version, content hash, policy version, and reason.

| From | Allowed destination | Guard |
|---|---|---|
| `captured` | `triaged`, `withdrawn` | Capture and provenance exist. |
| `triaged` | `working`, `draft`, `needs-clarification`, `deferred`, `rejected` | Type and disposition are assigned. Direct draft is allowed only when promotion checks pass. |
| `working` | `draft`, `collision-review`, `needs-clarification`, `withdrawn` | Promotion review uses current shared state. |
| `collision-review` | `working`, `draft`, `withdrawn` | Every blocking collision has a recorded disposition. |
| `needs-clarification` | Recorded `return_state`, `deferred`, `withdrawn` | Required question is answered or explicitly deferred. |
| `draft` | `working`, `reviewed`, `needs-clarification`, `deferred`, `withdrawn` | Template and schema requirements for the destination pass. |
| `reviewed` | `draft`, `ready-for-approval`, `needs-clarification`, `deferred` | Blocking findings are resolved or validly waived. |
| `ready-for-approval` | `draft`, `awaiting-approval` | Approval package is reproducible and required approvers resolve. |
| `awaiting-approval` | `approved`, `draft`, `rejected`, `deferred` | Approval policy produces a final decision or requests revision. |
| `approved` | `baselined`, `superseded`, `retired` | Package hash matches; supersede or retire follows change policy. |
| `baselined` | `superseded`, `retired` | A replacement baseline or authorized retirement exists. |
| `deferred` | `working`, `draft`, `withdrawn` | Authorized reopen decision exists. |
| `rejected` | `working`, `withdrawn` | Reopen authority and a new revision exist. The rejected revision is preserved. |
| `superseded` | none | Terminal for that revision. |
| `retired` | none | Terminal for that revision. |
| `withdrawn` | none | Terminal; reuse requires a new artifact identity or explicit restoration policy before baseline. |

An approved or baselined revision is immutable. A material change creates a new
working or draft revision while preserving the earlier approval and baseline.
The new revision does not inherit approval automatically.

### 14.3 Synchronization and verification transitions

Synchronization transitions are:

| From | Allowed destination |
|---|---|
| `not-synchronized` | `planned` |
| `planned` | `applying`, `not-synchronized` |
| `applying` | `synchronized`, `failed`, `uncertain` |
| `synchronized` | `drifted`, `planned` |
| `drifted` | `planned` |
| `failed` | `planned` |
| `uncertain` | `synchronized`, `planned`, `failed` after reconciliation |

Verification progress advances only when its required evidence exists. An
`executed` progress state SHALL reference execution evidence. `passed`,
`failed`, `blocked`, or `inconclusive` SHALL be derived from that evidence under
a versioned result mapping. `waived` requires an authorized waiver and does not
mean passed.

### 14.4 Capture and promotion behavior

`captured` material MAY be incomplete and MAY contain only free text and
provenance. Missing template fields SHALL be advisory at capture time.

Promotion from `captured` or `working` to shared `draft` SHALL:

1. Assign a stable artifact identity and type.
2. Preserve the original capture without rewriting it.
3. Record the actor performing the promotion.
4. Apply the resolved template and policy.
5. Separate statements, assumptions, questions, and evidence.
6. Run duplicate and source coverage checks.
7. Produce a promotion diff.
8. Refresh the shared graph and verify that the working artifact's base
   versions are not stale.
9. Compare requirement and acceptance-criterion coverage with approved,
   shared-draft, and declared in-flight work.
10. Detect identity, edit, semantic, hierarchy, dependency, approval, and
    external-reference collisions.

### 14.5 Default materiality policy

A change is material by default when it changes any of these:

- artifact type, statement, scope, actor, outcome, rationale with decision
  impact, business rule, constraint, assumption, acceptance criterion, NFR,
  applicability, priority used by an approval, or completion condition;
- governed source applicability or evidence interpretation;
- `decomposes`, `satisfies`, `implements`, `tested-by`, `depends-on`, `blocks`,
  `conflicts-with`, `supersedes`, `mitigates`, `resolves`, approval, component,
  or ownership relationships;
- required approvers, approval policy, waiver, security classification,
  privacy handling, retention, or release boundary;
- planning content included in the approved package, including a confirmed
  estimate or dependency.

Whitespace, rendering, spelling corrections that do not change meaning, file
paths, display aliases, generated timestamps, synchronization receipts, and
derived reports are non-material by default. A change not classified by the
resolved policy is material. Policy MAY tighten this default and MAY narrow it
only when it names the field and provides a reviewable rationale.

A material change SHALL produce impact analysis, a new content hash, a new
review package, and invalidation of affected current approvals. Historical
approval evidence remains attached to the prior immutable revision.

### 14.6 Human approval floor

An AI actor MUST NOT set `approved`, `baselined`, or verification outcome
`waived`. Approval requires a permitted human decision or a separately
configured deterministic automation policy whose authority is visible in the
approval package. An AI actor MUST NOT assert `executed` or `passed` without
verifiable execution evidence.

## 15. Adaptive Lifecycle

R-DLC uses adaptive stages. `ALWAYS` stages run for every selected scope;
`CONDITIONAL` stages run when the execution plan and project profile require
them. Every stage declares inputs, outputs, permissions, sensors, user
interaction mode, completion conditions, and recovery behavior.

| Phase | Stage | Condition | Principal outputs |
|---|---|---|---|
| 0 Initialize | Workspace and connector detection | ALWAYS | Project context, capabilities, state |
| 0 Initialize | Scope and rigor selection | ALWAYS | Execution plan |
| 1 Frame | Intent and problem framing | ALWAYS | Intent, problem, outcomes |
| 1 Frame | Stakeholder and governance mapping | ALWAYS | Stakeholder registry, approval roles |
| 2 Discover | Source and optional KB discovery | ALWAYS | Source plan and snapshots |
| 2 Discover | Interviews, workshops, and document gathering | CONDITIONAL | Captures, evidence, questions |
| 2 Discover | Existing backlog and comment ingestion | CONDITIONAL | Imported work and comment queue |
| 3 Model | Current/future process modeling | CONDITIONAL | Process artifacts |
| 3 Model | Domain, data, glossary, and business rules | CONDITIONAL | Models and rules |
| 3 Model | Component discovery | CONDITIONAL | Component candidates |
| 4 Define | Requirement drafting | ALWAYS | Requirement set |
| 4 Define | Acceptance criteria and NFRs | CONDITIONAL | Criteria and quality requirements |
| 5 Plan | Delivery hierarchy and story slicing | CONDITIONAL | Epics, features, stories, tasks |
| 5 Plan | Working-item promotion and collision review | CONDITIONAL | Coverage map and promotion decisions |
| 5 Plan | Components and ownership | CONDITIONAL | Confirmed component registry |
| 5 Plan | Dependencies and sequencing | CONDITIONAL | DAG, waves, blockers |
| 5 Plan | Estimation | CONDITIONAL | Suggested and confirmed estimates |
| 6 Validate | Schema and template validation | ALWAYS | Deterministic findings |
| 6 Validate | Semantic, contradiction, and duplicate review | ALWAYS | Review findings |
| 6 Validate | Trace and coverage review | ALWAYS | Coverage report |
| 7 Govern | Stakeholder comment resolution | ALWAYS | Dispositions and changes |
| 7 Govern | Readiness approval | ALWAYS | Approval package and decisions |
| 7 Govern | Baseline | CONDITIONAL | Immutable baseline |
| 8 Synchronize | Changeset planning | CONDITIONAL | Previewable external operations |
| 8 Synchronize | Apply and verify | CONDITIONAL | Tracker items and receipts |
| 9 Verify | Test design | CONDITIONAL | Draft test cases and coverage |
| 9 Verify | Result ingestion | CONDITIONAL | Verification evidence |
| 10 Evolve | Change and impact analysis | CONDITIONAL | Change request and affected graph |
| 10 Evolve | Re-review and re-baseline | CONDITIONAL | New approval package and baseline |

### 15.1 Scope profiles

Core profiles are:

| Scope | Intended use |
|---|---|
| `quick` | One capture, requirement, story, or task with lightweight review. |
| `standard` | Feature or epic with evidence, requirements, planning, review, and tests. |
| `portfolio` | Portfolio objectives, benefits, cross-project planning, governance, and roll-up. |
| `regulated` | Comprehensive provenance, separation of duties, approvals, baselines, and audit. |
| `audit` | Review an existing backlog or requirement collection without drafting from scratch. |
| `migration` | Import, normalize, deduplicate, and establish authority over existing tracker content. |
| `change` | Analyze and govern a change to an existing baseline. |

An adaptive composer MAY add or omit conditional stages, but it MUST record the
reason for every omission that affects evidence, approval, security, or
verification.

## 16. Inception and Source Gathering

An engagement MAY begin from only an idea, one or more high-level scope
documents, Confluence pages or spaces, Jira, GitHub, Azure DevOps, optional
K-DLC mounts, or a mixture of these sources. A tracker is not reserved for
post-approval execution, and a knowledge base is not required for greenfield
work.

Inception work items MAY represent:

- discovery activities;
- interviews and workshops;
- document requests;
- research and spikes;
- customer or operational requests;
- questions and clarifications;
- prototypes;
- decisions;
- risks and assumptions;
- external dependencies;
- compliance and legal reviews;
- existing defects and change requests.

R-DLC SHALL import selected source bodies, fields, comments, attachments,
relations, hierarchy, history, authors, timestamps, labels, components, and
links according to connector permissions and policy.

### 16.1 Source snapshots

Every imported external source SHALL record:

```yaml
schema_version: rdlc.source-snapshot/v0.2
id: urn:uuid:0198ba10-64f2-70a1-9c35-2d4e6f8091a3
provider: jira
organization: example.atlassian.net
project: COM
item_id: COM-42
subresource: comment:10017
revision: "2026-08-15T14:31:22Z"
author: jira-account:abc123
created_at: 2026-08-15T14:20:00Z
retrieved_at: 2026-08-15T14:32:00Z
source_hash: sha256:...
source_url: https://example.atlassian.net/browse/COM-42
```

Approved artifacts SHALL cite a captured source revision and, when applicable,
a K-DLC concept revision. A mutable live description without a snapshot is
insufficient for a reproducible baseline.

#### 16.1.1 Confluence page snapshots

A claimed Confluence source profile SHALL capture an immutable snapshot of the
exact page version used as evidence. Page title or URL is not a stable identity;
the connection, site or instance, immutable page ID, and version number form
the provider revision identity.

```yaml
schema_version: rdlc.source-snapshot/v0.2
id: urn:uuid:0198ba20-53e1-7c92-a647-3b5d7f9012c4
provider: confluence-cloud
connection: product-confluence
site: example.atlassian.net/wiki
space_id: "98421"
space_key: PAY
page_id: "123456"
page_version: 19
status: current
title: Checkout Recovery Requirements
parent_page_id: "120000"
body_representation: storage
author: confluence-account:abc123
version_created_at: 2026-08-14T21:20:00Z
retrieved_at: 2026-08-15T14:32:00Z
source_hash: sha256:...
source_url: https://example.atlassian.net/wiki/spaces/PAY/pages/123456
```

The mapping profile SHALL declare the captured body representation, such as
Confluence storage format or Atlassian Document Format. The exact versioned
body is source evidence. A rendered `view` is a derived snapshot for reading
and visual review and SHALL carry its own hash and retrieval time because
macros and included content can change independently.

[`Attachments`](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/),
[`inline and footer comments`](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-comment/),
labels, content properties,
ancestors, child relationships, restrictions, and embedded or included pages
SHALL be captured as separately addressable revisions where selected by
policy. Attachments SHALL retain their provider attachment/version identity,
media type, byte hash, and parent-page version context, then pass through the
direct document-intake contract. Comments SHALL retain their own identifier,
revision when available, author, anchors, resolution state, and page-version
context before entering comment review.

Dynamic macros, page includes, excerpts, Smart Links, databases, whiteboards,
and app-provided content SHALL either resolve to separately permission-checked
source snapshots or be recorded as unsupported or unresolved dependencies. A
rendered macro result MUST NOT be attributed solely to the containing page when
its upstream source cannot be locked.

### 16.2 Direct scope-document intake

Core SHALL provide bounded document intake that does not require K-DLC. Its
purpose is to create engagement evidence and requirements, not to publish a
reusable knowledge base.

The reference distribution SHALL support this minimum intake matrix:

| Category | Required formats | Conditional or recommended formats |
|---|---|---|
| Documents | PDF, DOCX, Markdown, plain text, HTML | Legacy DOC; RTF |
| Spreadsheets | XLSX, CSV | XLS; TSV; ODS |
| Presentations | PPTX | Legacy PPT; ODP |
| Diagrams | draw.io XML, VSDX | Legacy VSD; embedded diagrams in office files |
| Images | PNG, JPEG, GIF, SVG | TIFF, BMP, WebP |
| Email evidence | EML | MSG; MBOX |

GIF intake SHALL identify whether the file is animated and retain or sample
frames according to policy rather than silently reading only the first frame.
Spreadsheet extraction SHALL identify sheets, used ranges, formulas, cached
values, tables, charts, named ranges, and hidden content. Diagram extraction
SHALL preserve pages, layers, shapes, connectors, labels, and available stable
shape identifiers. Presentation extraction SHALL preserve slide, speaker-note,
and object anchors.

Detection SHALL use file signatures and declared media types in addition to
extensions. Password-protected, encrypted, corrupted, macro-enabled,
unsupported, or partially parsed files SHALL fail closed or produce an explicit
bounded-extraction warning according to policy. Active content, macros,
external links, and embedded instructions MUST NOT be executed during intake.

A connector or harness MAY use native document-reading tools, deterministic
parsers, OCR, diagram rendering, or sandboxed conversion. It SHALL preserve:

- original file identity, name, media type, size, and hash;
- retrieval or upload timestamp and actor;
- page, slide, sheet, row, section, heading, shape, frame, or other available
  source anchors;
- extraction method and tool version;
- warnings, unsupported content, formulas not evaluated, OCR confidence, and
  truncation;
- a retained original or a durable reference permitted by policy.

For large files, the intake stage MAY inspect headers, metadata, outlines,
selected pages, representative rows, and partial content before requesting
deeper extraction. It MUST tell the user which portions were and were not
analyzed.

#### 16.2.1 Default bounded-scan profile

The reference distribution's preliminary scan SHALL stop at the first
applicable configured limit. Unless a project changes the profile, the limits
are 50 MiB and 60 seconds per file; 40 pages or slides; 10 worksheets with the
header and first 200 non-empty rows per sheet; 10 diagram pages or 2,000 shapes;
and 20 uniformly sampled animation frames including the first and last frame.
Metadata, structural indexes, and content counts SHOULD be read before sampling
when the format permits it.

The extraction record SHALL state the configured limits, actual units
processed, deterministic selection method, omitted ranges or object types, and
whether OCR or conversion was used. A user or policy MAY authorize a deeper
bounded pass. No preliminary scan MAY be described as full-file analysis when
any unit or embedded object was omitted.

#### 16.2.2 Extraction adapter contract

Format-specific implementations SHALL expose a common staged contract:

```text
detect -> probe -> list-structure -> extract-selection
       -> render-selection -> list-embedded -> report-coverage
```

`probe` SHALL read only enough data to determine file signature, media type,
encryption or macro flags, size, format version, and available structural
counts. `list-structure` SHALL return addressable units such as sections,
pages, slides, sheets, tables, diagram pages, layers, shapes, frames, and
attachments without requiring full semantic analysis. `extract-selection` and
`render-selection` SHALL accept explicit unit selectors and budgets.

Every extracted fragment SHALL include source identity and hash, adapter and
tool version, media type, structural path, native locator, fragment kind,
normalized text or metadata, optional bounding box and relationships,
extraction hash, confidence where applicable, and warnings. The adapter SHALL
return an explicit coverage record listing discovered, processed, partially
processed, unsupported, and omitted units.

The portable reference distribution MAY write rebuildable, hash-bound fragment
catalog shards under `sources/catalog/` as JSON Lines for header and partial
content lookup. Those shards are derived indexes, not canonical source or
requirement truth. They SHALL be invalidated when the source hash, adapter
version, extraction profile, or normalization schema changes. A persistent
SQLite index is out of scope for reference distribution release 0.1.

#### 16.2.3 Reference extraction stack (informative)

The tools named below are exemplary rather than required. The reference
distribution realizes the same staged adapter contract and coverage-reporting
obligations with a Node.js-based extraction stack; any stack satisfying
§16.2.1 and §16.2.2 is acceptable.

The recommended implementation uses narrow, structure-aware parsers first and
a sandboxed broad-format fallback:

| Input | Preferred approach |
|---|---|
| Detection and broad metadata/text fallback | [Apache Tika](https://tika.apache.org/) behind an isolated adapter. |
| PDF | [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/recipes-text.html) for page counts, blocks, words, coordinates, images, and selected-page rendering; Tesseract only for pages requiring OCR. |
| DOCX | Direct OOXML package inspection plus [`python-docx`](https://python-docx.readthedocs.io/en/latest/)-compatible structured extraction; render when layout, headers, footers, text boxes, or drawings are significant. |
| XLSX | [`openpyxl` read-only mode](https://openpyxl.readthedocs.io/en/stable/optimized.html) for bounded row iteration, plus direct OOXML metadata for formulas, dimensions, hidden units, charts, and relationships. Never calculate formulas during intake. |
| CSV and text | Streaming decoding with explicit delimiter, encoding, newline, and malformed-row reporting. |
| PPTX | [`python-pptx`](https://python-pptx.readthedocs.io/en/latest/user/understanding-shapes.html)-compatible slide and shape traversal plus direct OOXML inspection for notes, relationships, and unsupported objects; render selected slides for visual context. |
| draw.io | Securely parse and, when necessary, decompress its [XML format](https://www.drawio.com/docs/reference/diagram-generation/); retain page, layer, `mxCell`, vertex, edge, label, and geometry identities. |
| VSDX | Inspect the OPC/OOXML package with a version-pinned parser; use a sandboxed draw.io or LibreOffice conversion only as a visual fallback and report any loss of native shape semantics. |
| PNG, JPEG, GIF, SVG | Pillow-compatible metadata and frame access for raster images; secure XML parsing for SVG; [Tesseract](https://tesseract-ocr.github.io/tessdoc/) OCR only when enabled by language and confidence policy. |
| EML and MSG | Standards-based MIME parsing for EML; a sandboxed, version-pinned MSG adapter or conversion for MSG; preserve headers, body alternatives, attachment identities, and thread references. |

The adapter manifest SHALL pin each parser or converter version and its
supported format profile. A broad extractor's success does not waive the
required anchor, structure, unsupported-content, or coverage reporting.

### 16.3 High-level scope-document path

When a user supplies a scope document, R-DLC SHALL first produce a source-grounded
scope understanding containing:

1. Problem or opportunity.
2. Objectives, outcomes, and success measures.
3. Stakeholders, users, and accountable owners.
4. In-scope and out-of-scope boundaries.
5. Current and desired processes.
6. Candidate capabilities, requirements, components, and work types.
7. Constraints, business rules, assumptions, RAID+D candidates, and open
   questions.
8. Data, integrations, security, privacy, accessibility, and operational needs.
9. Contradictions, ambiguous language, and missing evidence.
10. A proposed elicitation and delivery-planning path.

The user SHALL review this understanding before the framework generates a full
requirement set. The agents then conduct adaptive elicitation, record answers,
draft and review requirements, suggest components, and map the accepted work to
the company's configured issue types.

### 16.4 Optional K-DLC routing

When K-DLC is enabled, attachments and linked documents SHOULD be routed
through its governed ingestion where that adds reusable knowledge, richer
provenance, or cross-project value. R-DLC SHALL reference resulting `kb://`
evidence and retain the original engagement or tracker source reference.

## 17. Optional K-DLC Integration

K-DLC is OPTIONAL. A greenfield engagement SHALL be able to use every module it
claims without K-DLC: `Governed-Basic` includes approval and baseline,
connected profiles include tracker synchronization, and `Verification`
includes test generation. When an R-DLC project enables K-DLC, it SHALL
implement the K-DLC consumer contract instead of defining a second
incompatible mount model.

An enabled project SHALL:

1. Reference `knowledge-project.yaml` and `knowledge.lock`.
2. Allow one or more read-only or writable knowledge-base mounts according to
   K-DLC policy.
3. Cite stable `kb://<kb-id>/<concept-id>` references.
4. Record the `knowledge.lock` digest in each approval package and baseline.
5. Query only knowledge the principal is allowed to access.
6. Distinguish source evidence, KB synthesis, user captures, and agent
   inference.
7. Detect when a changed KB revision may invalidate an assumption, rationale,
   constraint, requirement, or test.
8. Create impact-review candidates rather than silently rewriting approved
   artifacts.

Repository reverse engineering remains a K-DLC roadmap capability. When K-DLC
publishes code-derived components and behavior, R-DLC MAY consume those
concepts as brownfield evidence and component candidates.

## 18. Prompted Elicitation and Requirement Templates

### 18.1 Greenfield prompt flow

R-DLC SHALL be able to start from an incomplete idea or a high-level scope
document without requiring an existing backlog or knowledge base. The guided
flow SHOULD establish, in an adaptive order:

1. The problem or opportunity and why it matters now.
2. Affected users, stakeholders, and accountable business owner.
3. Current behavior, pain, workarounds, and measurable baseline where known.
4. Desired outcomes, success measures, and failure signals.
5. Scope, exclusions, boundaries, and rollout expectations.
6. Business rules, policies, constraints, assumptions, and dependencies.
7. Data, integrations, security, privacy, accessibility, and operational needs.
8. Exceptions, negative paths, recovery, and transition needs.
9. Governance, required approvers, readiness evidence, and change authority.
10. Available sources, optional knowledge bases, unknowns, and planned
    discovery work.

The agents SHALL walk the user from source understanding through elicitation,
modeling, requirement drafting, acceptance criteria, quality review,
components, RAID+D, planning decomposition, dependencies, estimates, readiness,
and tracker synchronization. They MUST present intermediate understanding and
material candidates for correction rather than generate a complete backlog in
one unreviewed step.

Prompts SHALL be adaptive. The system SHOULD answer questions from permitted
sources before asking the user, while showing the evidence and allowing the
user to correct it. It MUST NOT invent an answer merely to complete a template.
An unresolved answer becomes an explicit question, assumption, dependency, or
discovery task.

The framework SHALL support these interaction styles:

- `guided`: ask at most the configured `prompt_batch_size` decision-oriented
  questions at a time; the reference default is three;
- `batch-file`: write structured questions to a reviewable file and ingest the
  user's edits;
- `conversational`: allow free-form discussion while persisting decisions and
  open questions;
- `source-first`: analyze selected sources before asking only unresolved
  questions.

Each persisted question SHALL have a stable ID, reason for asking, affected
artifacts, answer status, answer actor, timestamp, and source references. This
question state is part of the resume contract.

Prompt packs MAY be customized by organization, portfolio, domain, artifact
type, and lifecycle scope. A prompt pack MAY add forcing questions, examples,
terminology, role lenses, and review checklists. It MUST NOT override locked
security, privacy, approval, or evidence rules.

Templates SHALL be schema-backed and MAY include Markdown guidance. A template
can define required fields, allowed values, conditional rules, relationship
requirements, examples, and provider mappings.

### 18.2 Requirement quality fields

A comprehensive requirement template SHOULD provide:

- statement;
- rationale and business value;
- actor or affected stakeholder;
- trigger and preconditions;
- main behavior or outcome;
- boundaries and exclusions;
- business rules;
- data and privacy considerations;
- failure and recovery behavior;
- non-functional expectations;
- acceptance criteria;
- sources and assumptions;
- owner and required approvers;
- priority and planning relationships;
- affected components;
- test and verification links.

Not every artifact type requires acceptance criteria. Discovery tasks,
decisions, risks, document requests, and some PMO tasks use type-appropriate
completion or disposition fields.

### 18.3 Template inheritance

Resolved templates follow this precedence:

```text
framework defaults
  < organization pack
  < portfolio pack
  < space/team pack
  < project pack
  < engagement override
```

A lower level MAY extend or tighten inherited rules. It MUST NOT weaken a
locked organization control.

## 19. Component Registry

R-DLC SHALL support these component classes:

- business capability;
- product area;
- business process;
- data domain;
- application or service;
- integration;
- user experience surface;
- organization or team;
- external or vendor system.

Component lifecycle is:

```text
suggested -> candidate -> confirmed -> active -> deprecated
```

A component suggestion SHALL include:

1. Proposed name and class.
2. Responsibility and boundary.
3. Evidence and rationale.
4. Requirements and stories that caused the suggestion.
5. Possible owner.
6. Similar or overlapping components.
7. Confidence and unresolved questions.

Users SHALL be able to accept, edit, merge, reject, or defer component
candidates. Component relationships include `owned-by`, `depends-on`,
`interfaces-with`, `contains`, and `realizes`.

When a proposed technical component has no cited evidence beyond a business
capability or product boundary, semantic review SHOULD emit a
`solution-decomposition-without-evidence` finding. A human may provide
rationale, reclassify the component, or reject it; the agent MUST NOT silently
promote it to `confirmed`.

## 20. Delivery Planning and Non-Development Work

### 20.1 Company setup and issue taxonomy

Before converting accepted requirements into tracker items, R-DLC SHALL resolve
the company's delivery configuration. It MAY obtain that configuration from:

1. A versioned organization or team profile.
2. Live tracker schema, field, workflow, hierarchy, and permission discovery.
3. Existing issue forms, templates, automation rules, and representative work
   items.
4. User answers for semantics that tools cannot expose reliably.

The resolved setup SHALL define:

- available standard and custom issue types;
- the meaning and intended use of every mapped issue type;
- hierarchy and permitted parent-child combinations;
- required fields, templates, and acceptance or completion criteria;
- workflow states, transitions, and readiness rules;
- components, labels, areas, teams, owners, and routing;
- dependency and other link types;
- estimation profiles and fields;
- prioritization and planning fields;
- Definition of Ready and Definition of Done policies;
- approval mechanisms and stakeholder mappings;
- naming, formatting, and identifier conventions.

R-DLC SHALL create its semantic requirements and planning model before
projecting it into provider-specific issue types. It MUST NOT assume that an
organization uses `Epic`, `Story`, and `Task`, or that those names mean the same
thing in every project. It SHALL support types such as capability, feature,
requirement, product backlog item, user story, enabler, spike, research,
defect, change, approval task, documentation task, and arbitrary custom types.

If more than one mapping is plausible, the framework SHALL present the options
and their consequences. If no suitable issue type exists, it SHALL ask whether
to use an existing generic type, retain the artifact only in R-DLC, or propose
a company configuration change. It MUST NOT create tracker configuration or
custom fields without a separately approved administrative changeset.

Locked organization policy takes precedence over project preferences. Live
tracker capability takes precedence over stale assumptions about what the
provider supports. The final resolved company setup and mapping version SHALL
be stored with the engagement so work can resume reproducibly.

### 20.2 Configurable hierarchy

The hierarchy is configurable because provider and organization semantics
differ. A project MAY use any ordered subset of:

```text
portfolio epic -> initiative -> epic -> capability -> feature -> story -> task
```

The hierarchy is a delivery view. It MUST NOT replace semantic trace links.

### 20.3 Story slicing

Generated stories SHOULD:

- deliver an observable outcome or learning increment;
- remain independently reviewable;
- trace to at least one requirement or objective;
- name dependencies and affected components;
- contain testable acceptance criteria when applicable;
- expose assumptions and open questions;
- be small enough for the configured estimation scheme.

The framework MUST NOT create fake user stories for implementation-only or
non-development tasks.

### 20.4 Non-development categories

The general task model SHALL support at least:

- research;
- design;
- procurement;
- legal;
- compliance;
- training;
- documentation;
- data migration;
- change management;
- marketing;
- operations;
- governance;
- vendor coordination;
- stakeholder communication.

Each category MAY resolve a distinct template, completion policy, approval
policy, estimation profile, and tracker mapping.

## 21. Dependency Planning

Dependency types include:

- hard prerequisite;
- blocking;
- data dependency;
- API or contract dependency;
- shared component;
- environment or infrastructure dependency;
- decision dependency;
- vendor or external dependency;
- compliance or approval dependency;
- test or verification dependency;
- schedule dependency;
- informational relationship.

Every generated dependency SHALL include a source, target, type, rationale,
origin, confidence, and hard/soft classification.

Planning SHALL produce:

1. A dependency graph.
2. Cycle detection.
3. Recommended topological order for hard dependencies.
4. Parallel execution waves.
5. Critical blockers.
6. External dependency register.
7. Release or milestone slices.
8. Walking-skeleton candidate when relevant.
9. Component and ownership view.
10. Unresolved dependency questions.

Hard-dependency cycles block readiness until resolved or explicitly waived by
authorized policy. AI-suggested dependencies remain candidates until accepted
or included in an approved planning package.

Native provider relations SHOULD be used when available. Otherwise the mapping
profile SHALL state how the relation is represented and what fidelity is lost.

## 22. Estimation

### 22.1 Estimation profiles

R-DLC SHALL support:

- story points;
- T-shirt sizes;
- ideal hours or days;
- calendar time;
- three-point estimates;
- bucket sizing;
- work-item count;
- no-estimate or flow-based planning;
- custom numeric scales;
- custom ordered labels.

Common story-point scales include Fibonacci, modified Fibonacci, powers of two,
linear scales, and organization-defined numeric values. The default T-shirt
labels are `XS`, `S`, `M`, `L`, `XL`, and `XXL`, but every label and ordering is
configurable.

### 22.2 Setup questions

During project, team, or connector setup, R-DLC SHALL ask or deterministically
discover:

1. Which artifact types are estimated.
2. Which scheme and allowed values are used.
3. Whether the value represents effort, complexity, uncertainty, risk, size,
   duration, or a declared combination.
4. Whether AI may suggest estimates.
5. Who confirms estimates.
6. What threshold requires story splitting.
7. Whether tasks are estimated separately.
8. Whether and how values roll up.
9. How spikes and non-development tasks are handled.
10. Whether the team uses planning poker, affinity estimation, bucket sizing,
    individual entry, or another method.
11. Which external fields store suggestions and confirmed values.

Estimation profiles MAY differ by team within one project or portfolio.

### 22.3 Estimation controls

AI-generated values SHALL be marked `suggested` and SHALL NOT overwrite a
team-confirmed estimate without an approved change. R-DLC MUST NOT:

- convert story points to time automatically;
- convert T-shirt sizes to points without configured mappings;
- promise dates from size alone;
- combine values across incompatible team scales;
- create a new custom tracker field when a compatible field already exists
  without presenting the reuse option.

Estimate changes SHALL retain history, author, method, and rationale.

## 23. RAID and RAID+D

RAID artifacts SHALL be first-class records linked to objectives,
requirements, planning items, components, tests, sources, and decisions.

### 23.1 Common fields

Every RAID record SHALL provide:

- stable identity and type;
- statement and description;
- owner;
- source and evidence;
- status;
- affected artifacts;
- created, review, due, and closed dates where applicable;
- escalation state;
- tracker references;
- comment and decision history.

### 23.2 Type-specific fields

| Type | Required or recommended fields |
|---|---|
| Risk | Probability, impact, exposure method, proximity, trigger, mitigation, contingency, residual risk. |
| Assumption | Validation method, validation owner, due/expiry date, confirmed/refuted status, consequence if false. |
| Issue | Current impact, severity, cause, resolution plan, target date, resolution evidence. |
| Dependency | Provider, consumer, needed-by date, hard/soft, internal/external, satisfaction criteria. |
| Decision | Options, decision authority, outcome, rationale, consequences, effective date. |

Risk scoring matrices SHALL be configurable. A single built-in formula MUST NOT
be presented as universally correct.

### 23.3 RAID behavior

R-DLC SHALL support candidate generation, aging, overdue detection, escalation,
assumption validation reminders, mitigation traceability, dependency planning,
review meetings, portfolio roll-up, tracker synchronization, and baseline
impact analysis.

## 24. Quality Review

Review combines deterministic checks with evidence-grounded semantic analysis.

### 24.1 Deterministic checks

Examples include:

- schema and required-field validation;
- template conformance;
- identifier uniqueness;
- invalid lifecycle transitions;
- missing owners or approvers;
- broken trace links;
- orphan requirements, stories, criteria, or tests;
- illegal hierarchy relationships;
- dependency cycles;
- invalid estimation values;
- missing source snapshots;
- stale KB locks when K-DLC is enabled;
- unresolved blocking findings;
- changes made after approval without impact review.

### 24.2 Semantic checks

Examples include:

- ambiguity and vague terms;
- compound requirements;
- conflicting requirements or business rules;
- unsupported factual claims;
- contradictions with mounted knowledge;
- missing negative, error, permission, or recovery paths;
- unbounded or unmeasurable non-functional expectations;
- solution bias without rationale;
- acceptance criteria that repeat rather than test the requirement;
- stories that are too large for the configured scale;
- missing component or dependency impacts;
- duplicated or overlapping scope;
- estimates inconsistent with reference items, when comparison is allowed.

### 24.3 Finding contract

```yaml
schema_version: rdlc.finding/v0.2
id: urn:uuid:0198b820-7f2a-72d6-a341-4c5e6f708192
display_id: F-017
rule: RDLC-AC-004
severity: blocking
artifact: urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10
artifact_display_id: REQ-104
location: acceptance_criteria[1]
message: Expected retention duration is not bounded.
evidence:
  - kb://payments-policy/retention/incomplete-checkout
confidence: high
suggested_action: Reference the configured retention policy and define expiry behavior.
status: open
```

Findings SHALL be individually resolved, accepted, challenged, or waived.
Waivers require actor, rationale, scope, expiry or review date, and policy
authority.

## 25. Duplicate and Conflict Detection

Candidate generation SHOULD combine:

1. Stable external identifiers and exact hashes.
2. Normalized title and statement matching.
3. Lexical and semantic similarity.
4. Shared actors, outcomes, entities, components, and business rules.
5. Acceptance-criteria overlap.
6. Scope, applicability, and timing.
7. Cross-tool matching.

Every candidate pair SHALL include a score or confidence, reasons, side-by-side
diff, source systems, related links, and recommended disposition.

Allowed human dispositions include `duplicate`, `overlap`, `related`,
`conflict`, `not-duplicate`, `merge-proposed`, and `needs-investigation`.
R-DLC MUST NOT automatically merge or close suspected duplicates.

## 26. Comment Review and Shaping

Comments on imported or synchronized items SHALL enter a review queue when they
are new, edited, or when a versioned relevance policy changes their result from
out-of-scope to in-scope for the active engagement. The queue record SHALL
retain the comment revision and relevance-policy version.

Comment classifications include:

- clarification;
- proposed requirement change;
- challenge or objection;
- missing acceptance criterion;
- evidence or source;
- decision;
- risk;
- assumption;
- issue;
- dependency;
- test scenario;
- scope change;
- non-actionable discussion.

Allowed dispositions are:

- incorporate into an artifact;
- challenge with a proposed response;
- request clarification;
- create a requirement or planning item;
- create or change acceptance criteria;
- create a RAID or decision record;
- create a change request;
- mark addressed;
- take no action.

Every incorporation SHALL retain a link to the exact comment revision. A
proposed response to an external comment SHALL be part of a connector changeset
and follow the configured write approval policy.

A comment containing words such as "approved" SHALL NOT count as approval
unless an explicit policy validates the actor, scope, decision format, and
artifact hash. A new comment proposing a change to a field or relationship that
the resolved materiality policy classifies as material SHALL create an impact
review candidate rather than silently changing or invalidating content.

## 27. Stakeholders, Readiness, and Approval

### 27.1 Stakeholder registry

Stakeholders SHALL have declared roles such as responsible, accountable,
consulted, informed, reviewer, required approver, or advisory approver.

The required approval set is resolved from policy and artifact scope. It is not
the complete stakeholder list.

### 27.2 Identity registry and verified bindings

Every stakeholder who can satisfy an approval policy SHALL have a canonical
principal identity independent of any provider username, email address, or
display name. The identity registry SHALL record the principal UUID, current
display name, stakeholder roles, status, and verified provider bindings.

A provider binding SHALL include:

- provider, connection, organization or tenant, and immutable provider account
  identifier;
- verification method, verifier, verification time, status, and optional
  expiry;
- the canonical principal to which the provider account is bound; and
- any explicit, package-scoped, time-bounded delegation.

```yaml
schema_version: rdlc.principal/v0.2
id: urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012
display_name: Alex Morgan
kind: human
status: active
roles:
  - product-owner
bindings:
  - provider: jira
    connection: delivery-jira
    tenant_id: 3f9c2a10
    account_id: abc123-immutable-provider-id
    verified_via: authenticated-self-binding
    verified_by: urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012
    verified_at: 2026-08-15T17:40:00Z
    status: verified
```

Accepted verification methods include authenticated self-binding, authorized
directory synchronization, and administrator attestation. A manually entered
email address or display-name match is unverified and MUST NOT satisfy a
required human approval. Shared accounts and service accounts MUST NOT satisfy
a human-approver role. A non-human automation principal MAY make only the
deterministic decisions explicitly authorized for it by policy.

Account rename SHALL preserve the immutable provider account identifier.
Revoking or disabling a binding prevents future decisions through that
binding, but SHALL NOT erase historical approval evidence. Identity-binding
and delegation changes are governed changes and SHALL be audited. An approval
task or native approval surface SHALL be resolved to the expected bound
provider account before its decision is accepted.

Harness-local approvals follow the same rule: the authenticated host or
identity-provider subject SHALL be verified and bound to the canonical
principal. A typed name, Git author string, local operating-system username, or
model assertion alone is insufficient.

### 27.3 Approval policies

Supported policies include:

- all required individuals;
- `n-of-m` individuals;
- one or more per role;
- one or more per group;
- sequential approval;
- parallel approval;
- advisory-only review;
- custom deterministic policy.

Policies SHALL define decline behavior, abstention, delegation, separation of
duties, timeout, reminder, escalation, and change invalidation.

### 27.4 Approval package

The immutable approval package SHALL contain:

1. Artifact identities, versions, and hashes.
2. Summary and full diff since the previous review or baseline.
3. Requirements and acceptance criteria.
4. Direct source hashes, cited evidence, and the KB lock digest when K-DLC is
   enabled.
5. Component impacts.
6. Dependency plan.
7. RAID+D summary.
8. Quality, duplicate, conflict, and trace findings.
9. Test coverage proposal.
10. Unresolved questions and waivers.
11. Required approvers and policy version.

Each approval decision SHALL record the canonical principal, verified provider
binding or authenticated local identity, decision, timestamp, package hash,
role, comment, authentication context, and decision record hash. The approval
surface SHALL expose the package hash or a verifiable package reference. The
connector SHALL read back the deciding provider account, decision, provider
revision, and bound hash before the decision can satisfy policy.

Ordinary approval timestamps are informative metadata. Causal ordering SHALL
use artifact versions, hashes, connector revisions, changeset operation
sequence, and receipts. A timestamp is trusted evidence only when produced by
a configured trusted-time profile.

#### 27.4.1 Basic integrity profile

`Governed-Basic` SHALL provide identity-bound approval decisions, canonical
package hashes, protected baseline records, approval invalidation, and
verification on read. Its documentation MUST state that repository history,
tracker history, and stored hashes detect many changes but do not by themselves
provide tamper-proof storage or cryptographic non-repudiation.

#### 27.4.2 Regulated integrity profile

`Governed-Regulated` SHALL additionally provide:

1. Detached digital signatures over the approval decision and approval-package
   hash using a versioned signing profile.
2. Verified signer-to-principal and key-to-principal binding at decision time.
3. Signature, certificate or key-status, and revocation validation records.
4. A trusted timestamp for the signed decision.
5. An externally anchored, tamper-evident baseline-root receipt, such as a
   transparency log, trusted notary, or policy-approved write-once store.
6. Separation-of-duties enforcement where the resolved policy requires it.
7. Offline verification instructions and test fixtures.

The versioned signing profile SHALL define the exact signed byte projection,
signature algorithm and parameters, signature encoding, key identifier and
credential chain, identity proof, trusted-time token format, revocation rules,
external-anchor receipt, validation time semantics, and algorithm-deprecation
procedure. A verifier SHALL reject an unknown or disallowed profile.

An implementation MUST NOT claim `Governed-Regulated` when signatures or the
external anchor are unavailable. A provider approval or completed tracker task
that cannot bind the actor and exact package hash is advisory evidence only; a
separate conforming approval decision is then required.

### 27.5 Readiness conditions

An artifact may enter `ready-for-approval` only when:

- required templates pass;
- blocking findings are resolved or validly waived;
- required evidence and trace links exist;
- material comments are dispositioned;
- hard dependency cycles are resolved;
- the required approver set resolves to eligible, verified identities;
- the approval package is reproducible and matches the content being
  promoted.

It may enter `approved` only when the required decisions satisfy policy against
that exact package hash and no later change has invalidated them. Baseline
readiness additionally requires all baseline contents and locks to reproduce.

### 27.6 Tracker approval projections

For Jira, supported mappings include:

1. Native approval workflow and approver fields where available.
2. A parent `Readiness Review` task and one child task per required approver.
3. One approval task per stakeholder group.
4. Custom approval fields and workflow transitions.
5. An organization-defined approval work type.

Equivalent task, field, sub-issue, relation, or workflow mappings MAY be used in
GitHub and Azure DevOps.

Completing a generic task counts as approval only when the mapping policy names
that issue, validates the actor, and binds completion to the approval package
hash. R-DLC remains able to export approval evidence even when a tracker is the
interaction surface.

The mapping SHALL place the approval-package hash and expected canonical
principal in a provider property, protected custom field, native approval
payload, or versioned machine-readable body marker. Read-back SHALL compare
that value and the immutable deciding provider account with the identity
registry. If the provider permits either value to be changed without adequate
history, task completion is advisory and R-DLC SHALL obtain a separate
conforming approval decision. A title, label, comment text, assignee, or status
alone is insufficient binding.

### 27.7 Approval invalidation

Material changes SHALL invalidate approvals for the affected package or
artifacts according to §14.5. A narrower organization policy SHALL identify its
authority and version; an unclassified change remains material. Every retained
approval after a change SHALL cite the rule and comparison proving why it
remains valid.

## 28. Test Generation and Verification

R-DLC MAY generate test candidates from requirements, acceptance criteria,
business rules, state transitions, data constraints, NFRs, and approved
examples.

Test design SHOULD consider:

- positive and negative behavior;
- boundary values and equivalence classes;
- roles and authorization;
- state transitions;
- failure, retry, and recovery;
- integration contracts;
- data quality and migration;
- accessibility;
- performance, reliability, and security;
- observability and operational acceptance;
- user acceptance and business process validation.

Every generated test SHALL link to the criteria, requirements, and rules it
tests. It SHALL remain `draft` until reviewed. When an expected result cannot be
derived from approved information, the generator SHALL create a source gap or
question instead of inventing the answer.

Coverage reports SHALL distinguish designed, reviewed, implemented, executed,
passed, failed, blocked, and waived verification.

## 29. Common Connector Contract

Every connector SHALL expose a capability document and implement applicable
operations from this contract:

```text
discover-schema
discover-permissions
pull
snapshot
normalize
diff
validate-changeset
create
update
link
unlink
comment
transition
set-fields
attach
poll
read-back
health
```

`poll` is the required synchronization baseline. An implementation claiming
the optional `Webhook-Receiver` module MAY additionally accept provider events,
but SHALL treat them as untrusted change hints and fetch authoritative provider
state before changing a canonical artifact or cursor.

### 29.1 Write sequence

Every external mutation SHALL follow:

```text
pull current state
  -> calculate diff
  -> validate target schema and permission
  -> create changeset
  -> present preview
  -> obtain required write approval
  -> apply idempotently
  -> read back
  -> verify
  -> persist receipt and external revision
```

### 29.2 Write modes

| Mode | Behavior |
|---|---|
| `read-only` | No mutation operations are permitted. |
| `propose` | Changesets are generated but not applied. This is the default. |
| `approve-each-batch` | A human approves every bounded changeset. |
| `approved-automation` | Pre-authorized operations may apply within declared policy and scope. |

Deletion, bulk closure, destructive hierarchy changes, and removal of external
relationships SHALL be disabled by default and SHALL require an explicit
policy and preview.

### 29.3 External references

```yaml
provider: jira
connection: delivery-jira
organization: example.atlassian.net
project: COM
item_id: COM-104
url: https://example.atlassian.net/browse/COM-104
revision: "27"
etag: optional-provider-token
mapping_version: jira-commerce/v3
last_pulled_at: 2026-08-15T18:00:00Z
last_pushed_at: 2026-08-15T18:05:00Z
```

### 29.4 Idempotency and conflict handling

Every create operation SHALL carry an R-DLC operation ID and canonical artifact
ID in a provider-supported field, property, label, marker, or body metadata.

Before retrying an uncertain create, the connector SHALL reconcile by that
identity. It MUST NOT assume that a missing local receipt means the external
write failed.

Updates SHALL use provider revisions, ETags, timestamps, or field-level
snapshots as preconditions. Conflicts SHALL produce a three-way comparison and
require policy-directed resolution.

### 29.5 Partial failure

A batch SHALL report every operation as `not-started`, `applied`, `verified`,
`failed`, `uncertain`, or `compensated`. R-DLC SHALL preserve enough state to
resume without duplicating verified operations.

### 29.6 Synchronization cursors and reconciliation

Each connection and synchronized resource scope SHALL maintain a durable
cursor record containing the provider cursor, watermark, or revision token;
last attempted and last successful incremental pull; last successful full
reconciliation; mapping version; filter and scope hash; and failure state.
Cursor advancement SHALL be atomic with persistence of all normalized changes
covered by that cursor.

A connector SHALL support bounded incremental polling and periodic full
reconciliation. It MUST NOT advance a cursor past an unpersisted or failed
page. Expired or invalid provider tokens SHALL trigger a safe rescan from a
declared recovery boundary. Deduplication SHALL use immutable provider event or
item identities plus revisions, not timestamps alone. Provider clock order MAY
inform a query window but SHALL NOT establish authoritative causal order.

Webhook delivery, when enabled, MUST be authenticated where the provider
supports it, deduplicated, rate-limited, and durably queued before
acknowledgement. Missed, delayed, duplicated, or reordered webhook events SHALL
be repaired by polling and full reconciliation.

### 29.7 Confluence source contract

Confluence is a source system, not a tracker projection, in the initial
profiles. `Source:Confluence-Cloud` SHALL use the [Confluence Cloud REST API
v2](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/)
for supported page operations. `Source:Confluence-Data-Center` SHALL declare
the exact supported Data Center versions and their [content API
profile](https://developer.atlassian.com/server/confluence/rest/v900/api-group-content-resource/).
Passing one profile does not imply the other.

A Confluence source mapping SHALL define:

- connection and site or instance identity;
- included space IDs and optional keys, root page IDs, descendant rules, page
  status, labels, content types, and any versioned CQL selection;
- captured body representations and derived renderings;
- inclusion of ancestors, descendants, labels, properties, restrictions,
  attachments, inline comments, footer comments, and supported custom content;
- macro, include-page, excerpt, Smart Link, database, whiteboard, and app-content
  handling;
- permission, classification, retention, and deletion policy; and
- polling window, pagination, cursor, full-reconciliation cadence, and
  unavailable-content behavior.

The resolved selection rules and every selected page/subresource revision and
hash SHALL form a Confluence source lock that an approval package can cite.
References SHOULD use a stable form such as
`external://confluence/<connection>/page/<page-id>@<version>` and MAY append a
fragment identifying a heading, macro, comment, or attachment.

Page body versions, labels, restrictions, hierarchy, comments, and attachments
may change independently. The connector SHALL poll and reconcile them according
to their own provider identities and available revisions. A page move or title
change SHALL preserve the page-ID lineage. Deleted, archived, trashed, or newly
inaccessible content SHALL be recorded as `unavailable` with the last permitted
snapshot retained or redacted according to policy; it MUST NOT be treated as
if it never existed.

All retrieval SHALL execute as the configured principal and preserve the
source access boundary. R-DLC MUST NOT copy restricted content into a less
restricted project, model context, report, tracker item, or approval package.
Permission or classification changes SHALL create an access-impact review even
when page body content is unchanged. Body, comment, attachment, or dependency
changes SHALL create materiality and downstream trace-impact candidates.

The initial Confluence profiles are read-only. Page creation, editing,
commenting, moving, labeling, restriction changes, archival, or deletion
require a separately declared future write profile and the common changeset,
preview, approval, idempotency, read-back, and receipt protocol.

## 30. Jira Connector

The Jira connector SHALL support, subject to target capability and permission:

- issue and subtask creation and update;
- project, work type, field, workflow, and edit metadata discovery;
- parent and hierarchy mapping;
- issue links and dependencies;
- comments and comment snapshots;
- labels, components, versions, sprint/iteration fields, and custom fields;
- status transitions;
- attachments and linked documents;
- native approvals where available;
- task-based readiness approval mapping;
- estimation field detection and update;
- issue history and revision capture;
- incremental polling and full reconciliation;
- optional authenticated webhook hints when `Webhook-Receiver` is claimed;
- read-back verification.

Jira Cloud, Jira Data Center, company-managed projects, team-managed projects,
and Jira Service Management expose different capabilities. Mapping profiles
SHALL declare the supported product and project type.

## 31. GitHub Connector

The GitHub connector SHALL support, subject to target capability and
permission:

- issue creation and update;
- comments, labels, assignees, milestones, and issue fields;
- issue types when available;
- Projects membership and custom fields;
- sub-issues and hierarchy;
- blocked-by and blocking dependencies;
- cross-repository references;
- issue forms and template mapping;
- readiness review issues or sub-issues;
- incremental polling and full reconciliation;
- optional authenticated webhook ingestion when `Webhook-Receiver` is claimed;
- read-back verification.

Repository issues and organization Projects have different scopes and APIs.
The mapping SHALL make their ownership and identifiers explicit.

## 32. Azure DevOps Connector

The Azure DevOps connector SHALL support, subject to target capability and
permission:

- work-item creation and JSON Patch updates;
- organization, project, team, process, and field discovery;
- work-item types and custom fields;
- parent/child and other work-item relations;
- comments, tags, area paths, and iteration paths;
- states and reason fields;
- story points, effort, size, and time mappings by process template;
- approval task projection;
- history and revision checks;
- incremental polling and full reconciliation;
- optional authenticated service-hook hints when `Webhook-Receiver` is claimed;
- read-back verification.

Agile, Scrum, CMMI, Basic, inherited, and custom process templates SHALL be
capability-discovered instead of assumed.

## 33. Changesets and Receipts

### 33.1 Changeset example

```yaml
schema_version: rdlc.changeset/v0.2
id: urn:uuid:0198b830-5a1e-7c42-9d63-2b4f6a8c0e12
display_id: CS-20260815-01
connection: delivery-jira
created_by: urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012
created_at: 2026-08-15T18:00:00Z
mode: approve-each-batch
operations:
  - operation_id: op-001
    action: create
    artifact: urn:uuid:0198b810-1a2b-7c3d-8e4f-1029384756aa
    target:
      project: COM
      work_type: Story
    idempotency_key: rdlc:0198b810-1a2b-7c3d-8e4f-1029384756aa
  - operation_id: op-002
    action: link
    source: urn:uuid:0198b810-1a2b-7c3d-8e4f-1029384756aa
    relation: blocked-by
    target: urn:uuid:0198b805-0f1e-7d2c-9b3a-a1b2c3d4e5f6
approval:
  required: true
  status: pending
```

### 33.2 Receipt requirements

A receipt SHALL record the changeset, operation ID, provider request identity
when available, external target, before and after revision, result, read-back
hash, actor, timestamps, warnings, and redacted failure details.

## 34. Persistent State, Checkpoints, and Resume

Workflow state SHALL live in the engagement record, not exclusively in a chat
or harness directory.

### 34.1 State contents

`rdlc-state.yaml` SHALL record:

- project, space, and engagement identity;
- selected scope and rigor;
- lifecycle phase and active stage;
- completed, skipped, pending, blocked, and awaiting-approval stages;
- current artifact and pending user decision;
- last safe checkpoint and next action;
- optional KB lock digest when K-DLC is enabled;
- artifact versions and hashes;
- open gates and approval packages;
- connector changesets, receipts, and uncertain writes;
- synchronization cursors, last successful reconciliation, and drift state;
- recovery state;
- host and session metadata;
- last update actor and timestamp.

### 34.2 Stage states

Core stage states are:

```text
not-started
in-progress
awaiting-user
awaiting-approval
needs-changes
completed
skipped
blocked
failed-recoverable
```

### 34.3 Checkpoint protocol

A checkpoint SHALL be written:

1. Before and after every stage.
2. Before opening and after resolving a gate.
3. Before applying an external changeset.
4. After every verified external operation or bounded batch.
5. Before and after compaction-aware context handoff where the harness supports
   it.

State updates SHALL be atomic. The recovery breadcrumb SHALL be independently
comparable with the main state so corruption or an interrupted update can be
detected.

### 34.4 Resume options

When an engagement exists, `/rdlc` or the host-native equivalent SHALL present:

1. Resume from the last safe checkpoint.
2. Redo the current stage.
3. Jump to a permitted stage.
4. Start a new engagement alongside the existing one.

The status summary SHALL show completed work, the current gate, pending user
input, open findings, unverified external writes, and the next action.

### 34.5 Cross-host resume

Claude Code, Codex, Kiro CLI, and Kiro IDE SHALL read the same R-DLC state and
artifacts. Harness-specific session events MAY differ, but they MUST NOT change
the lifecycle meaning.

Before one host resumes work last touched by another, it SHALL detect active or
stale leases, reconcile the engagement state, and warn about concurrent writers.

### 34.6 Audit sharding

Audit events SHOULD be written to per-host or per-clone append-only JSON Lines
shards to avoid Git merge conflicts. Events SHALL include actor, host, session,
engagement, event type, artifact or stage, timestamp, and redacted details.

## 35. Multi-BA Collaboration and Draft Promotion

R-DLC SHALL allow multiple business analysts and other contributors to work in
the same project without relying on a shared SQLite database. Reference
distribution release 0.1 uses portable files, Git-aware optimistic concurrency,
optional tracker
coordination, and short-lived file or provider leases for bounded mutations.

### 35.1 Work isolation

Each contributor SHOULD work in a named workstream using a Git branch,
worktree, provider draft, or author-scoped overlay. A working artifact SHALL
record:

- stable artifact ID;
- author and workstream;
- base artifact versions and hashes;
- base project or baseline revision;
- source requirements and acceptance criteria;
- intended coverage;
- affected components and planning parents;
- proposed company issue-type mapping;
- creation and last-update timestamps.

Working artifacts are not counted as approved coverage and are not synchronized
as committed delivery work by default. They MAY be shared for visibility or
early review.

### 35.2 Work claims

A contributor MAY publish a time-bounded work claim over requirements,
acceptance criteria, components, epics, or another declared scope. Claims are
advisory rather than exclusive locks. They exist to reveal likely overlap
before both contributors complete their drafts.

```yaml
schema_version: rdlc.work-claim/v0.2
id: urn:uuid:0198b840-4b2c-79e1-8f56-3d7a9c1e5b20
display_id: CL-17
actor: urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012
workstream: checkout-recovery-stories
scope:
  requirements:
    - urn:uuid:0198b7e0-6a2f-7b41-8d3e-2f7c9a6b4d10
  acceptance_criteria:
    - urn:uuid:0198b7e4-3c1d-7a20-b954-7e6d5c4b3a21
  components:
    - urn:uuid:0198b7d5-8c4a-7d22-a142-6b5e3c9f7011
intent: Create recovery and expiration stories.
created_at: 2026-08-15T19:00:00Z
expires_at: 2026-08-16T19:00:00Z
status: active
```

When a new claim overlaps an active claim, R-DLC SHALL notify both
contributors, show the shared scope, and offer coordination. It MUST NOT block
legitimate parallel work solely because components or requirements overlap.
Expired claims are ignored for blocking decisions but retained in audit.

### 35.3 Working-to-draft promotion gate

Before a story or other planning item moves from `working` to shared `draft`,
R-DLC SHALL:

1. Refresh the authoritative project files and connected tracker snapshots.
2. Compare every base version and hash with current shared state.
3. Validate the resolved company template and issue-type mapping.
4. Confirm that source requirements and acceptance criteria still exist and
   have not been superseded.
5. Compute requirement- and criterion-level coverage against approved work,
   shared drafts, and active work claims.
6. Search for duplicate, overlapping, related, or conflicting stories and
   non-development tasks.
7. Compare actors, outcomes, business rules, scope boundaries, data,
   components, dependencies, and acceptance criteria.
8. Detect competing edits to the same artifact or relationship.
9. Validate hierarchy, parent assignment, component ownership, and custom
   issue-type mapping.
10. Recalculate dependency cycles and planning-wave impact.
11. Check external IDs and tracker state for create or update collisions.
12. Check whether a changed baseline or approval package makes the draft stale.
13. Produce a promotion review with findings and possible resolutions.

The gate SHALL run on the latest available shared state, not only the state
that existed when the BA began drafting.

### 35.4 Coverage model

Coverage SHALL be measured at both requirement and acceptance-criterion level.
Core coverage states are:

| State | Meaning |
|---|---|
| `uncovered` | No accepted planning item implements the requirement or criterion. |
| `claimed` | An active contributor says they are working on coverage. |
| `working-covered` | A visible working artifact proposes coverage but has not been promoted. |
| `draft-covered` | A shared draft proposes coverage. |
| `approved-covered` | Approved delivery work provides accepted coverage. |
| `partially-covered` | Only part of the behavior or criteria is covered. |
| `over-covered` | Multiple items cover substantially the same scope without an accepted reason. |
| `conflicting-coverage` | Proposed items cover the same need incompatibly. |
| `intentionally-multiple` | Multiple items are justified by platform, persona, release, region, channel, or other declared partition. |

Multiple stories MAY validly implement one requirement. The promotion review
SHALL distinguish intentional decomposition from accidental duplication. It
SHALL show which acceptance criteria, scenarios, rules, and boundaries are
unique, shared, or missing.

### 35.5 Collision types

| Collision | Example | Default response |
|---|---|---|
| Identity | Two branches mint the same R-DLC or external ID. | Block and remint or reconcile identity. |
| Edit | Two users modify the same artifact from the same base version. | Three-way merge; human resolves overlapping fields. |
| Semantic duplicate | Two stories express materially the same outcome and criteria. | Block or warn according to policy; propose merge or reuse. |
| Partial overlap | Stories share some criteria but have distinct scope. | Show partition; link, split, or justify intentional overlap. |
| Behavioral conflict | Stories require incompatible rules or outcomes. | Block and escalate to requirement owner. |
| Coverage gap | A promoted story leaves required criteria uncovered. | Warn or block based on readiness policy. |
| Hierarchy | Competing parents or invalid company hierarchy. | Require mapping or ownership resolution. |
| Component ownership | Work is routed to incompatible owners or component definitions. | Request owner/component decision. |
| Dependency | New links introduce a hard cycle or reverse required order. | Block until dependency resolution or waiver. |
| Baseline staleness | Source requirement changed after drafting began. | Rebase and rerun impact review. |
| Approval staleness | Content no longer matches an approved package hash. | Invalidate affected approval and re-review. |
| External drift | Jira, GitHub, or Azure DevOps changed since pull. | Three-way diff before any write. |

### 35.6 Promotion outcomes

The contributor and authorized reviewers MAY choose:

- promote cleanly;
- promote with non-blocking warnings;
- revise and rerun promotion review;
- link as related work;
- declare intentional multiple coverage with rationale;
- partition scope between stories;
- split one story;
- propose a merge;
- reuse an existing story and abandon the new draft;
- supersede existing work through change control;
- escalate a business conflict to the requirement owner or product owner;
- defer or withdraw the working artifact.

R-DLC MUST NOT silently auto-merge stories, discard another contributor's
changes, close external issues, or mark overlap as intentional.

Every collision decision SHALL record the compared revisions, participants,
rationale, chosen outcome, affected coverage, and resulting relationships.

### 35.7 Optimistic concurrency and Git

Every shared artifact write SHALL include an expected base version or content
hash. If current state differs, the write SHALL stop and generate a three-way
comparison using base, current, and proposed content.

Implementations MAY automatically merge non-overlapping metadata or
relationship additions when deterministic rules prove they are compatible.
They MUST require human resolution for overlapping prose, acceptance criteria,
business rules, priorities, estimates, ownership, approval, or deletion.

Recommended Git practice is:

- one branch or worktree per workstream;
- frequent fetch and rebase or merge from the shared branch;
- promotion through a pull request or equivalent review;
- per-actor claim, audit, and review files to minimize append conflicts;
- no shared host-navigation cursor files; connector synchronization cursors
  remain coordinated engagement state;
- validation rerun against the target branch immediately before merge.

### 35.8 Tracker-coordinated work

When Jira, GitHub, or Azure DevOps is used during inception, a working item MAY
be represented by a configured draft status, label, issue type, field, or
private R-DLC artifact. The mapping SHALL state whether the item contributes to
shared coverage.

Before promotion or tracker synchronization, R-DLC SHALL pull the current
external revision and include other users' new issues, edits, comments,
relations, and status changes in collision analysis. Provider locking or
assignment MAY assist coordination but MUST NOT replace semantic collision and
coverage checks.

### 35.9 Mutation leases

Work claims are advisory. A short-lived mutation lease is REQUIRED for
operations that must be exclusive across writers, including display-alias
allocation, baseline publication, approval-package finalization, migration,
and connector cursor recovery. A lease SHALL have this logical form:

```yaml
schema_version: rdlc.lease/v0.2
id: urn:uuid:0198b9b0-103a-74c6-8912-1a2b3c4d5e6f
resource: alias-authority://commerce/requirement
purpose: allocate-display-aliases
holder:
  principal: urn:uuid:0198b7c0-2d5e-7f31-9a43-2c8e5b6a7012
  host: codex
  session: session-913
  workstream: checkout-recovery-stories
authority: provider-conditional-create
fencing_token: "00000042"
base_hash: sha256:...
acquired_at: 2026-08-15T19:02:00Z
heartbeat_at: 2026-08-15T19:02:30Z
expires_at: 2026-08-15T19:04:00Z
status: active
```

The lease authority SHALL provide atomic compare-and-create or
compare-and-swap behavior visible to all possible writers. A local file lock is
insufficient when multiple clones or machines can write. File-authoritative
projects MAY use a provider-backed lease, a protected-branch lease record with
atomic merge enforcement, or another configured distributed authority.

Each acquisition, renewal, release, expiry observation, and forced break SHALL
be materialized as an auditable portable record under
`collaboration/leases/`. Those files are evidence of the authority's state;
they are not themselves a distributed lock unless the protected-branch profile
provides the required atomicity. The project manifest SHALL name the lease
authority and its resource namespace.

Lease policy SHALL define maximum duration, heartbeat interval, allowed
purposes, eligible roles, and recovery behavior. Leases MUST expire, MUST NOT
be renewed after ownership is lost, and SHOULD be released immediately after
the bounded mutation. Expiry SHALL be decided by the lease authority's time or
monotonic fencing token, not solely by a claimant's local wall clock. Before
taking an expired lease, a writer SHALL refresh the protected resource and
rerun preconditions. Forced break requires an
authorized role, reason, current-holder notification when possible, and an
audit record. A broken or expired lease never proves that the prior writer
stopped; collision detection and optimistic version checks remain mandatory.
When the authority issues fencing tokens, every protected write SHALL carry the
current token and the mutation target SHALL reject an older token.

## 36. Harness Architecture

The repository SHOULD use:

```text
core/
  schemas/
  stages/
  policies/
  prompts/
  roles/
  tools/
harnesses/
  claude-code/
  codex/
  kiro-cli/
  kiro-ide/
connectors/
  jira/
  github/
  azure-devops/
profiles/
templates/
examples/
scripts/
distribution/
```

`core/` is authoritative. Generated host distributions MUST pass a drift check
against the authored core and adapter templates.

Kiro CLI and Kiro IDE SHALL be separate adapters because their agent, hook,
tool-grant, and session-start mechanics differ. Their state machine, schemas,
artifacts, policies, and commands remain semantically identical.

### 36.1 Logical command identifiers

Logical command identifiers use `rdlc.<verb>`. A harness renders the native
form it supports. Examples include `/rdlc:review`, `/rdlc-review`, or a named
R-DLC skill. Documentation SHALL show the form for the active host.

### 36.2 Desktop and remote clients through MCP

A compatible desktop or remote AI client MAY use R-DLC through an MCP service
instead of receiving a repository-native harness package. An implementation
claiming `Service:MCP` SHALL expose bounded resources for project status,
artifacts, trace, findings, approval packages, and connector results, plus
policy-gated tools corresponding to the logical commands.

The service SHALL authenticate the client subject, bind it to a canonical
principal, authorize each project and tool, preserve engagement checkpoints,
and return changeset previews before external mutations. Client chat identity
or a typed display name is not sufficient approval identity. Approval and
write tools SHALL apply the same package-hash, human-gate, idempotency,
read-back, and receipt rules as local harnesses. Resources SHALL enforce source
and tracker permissions and MUST NOT expose an entire project merely because a
client can connect to the service.

The client adapter MAY render commands differently, but it MUST NOT create a
separate lifecycle or artifact format. Product-specific connection and consent
instructions are deployment documentation rather than part of the portable
core specification.

## 37. Commands

The logical command set includes:

| Command | Purpose |
|---|---|
| `rdlc.start` | Start or resume an engagement. |
| `rdlc.status` | Show read-only state, gates, findings, and next action. |
| `rdlc.capture` | Record minimally structured user input or source material. |
| `rdlc.triage` | Classify captures and determine disposition. |
| `rdlc.promote` | Run promotion review and move accepted capture or working content into shared draft. |
| `rdlc.discover` | Gather document, tracker, stakeholder, and optional KB evidence. |
| `rdlc.draft` | Draft or revise requirements and related artifacts. |
| `rdlc.claim` | Declare, inspect, renew, or release an advisory work claim. |
| `rdlc.coverage` | Show requirement- and criterion-level working, draft, and approved coverage. |
| `rdlc.collisions` | Detect and resolve concurrent and semantic collisions. |
| `rdlc.components` | Suggest, review, and manage components. |
| `rdlc.decompose` | Create planning hierarchy, stories, and tasks. |
| `rdlc.dependencies` | Generate and review dependency planning. |
| `rdlc.estimate` | Configure, suggest, and confirm estimates. |
| `rdlc.raid` | Create and review RAID+D records. |
| `rdlc.comments-review` | Review newly imported source and tracker comments. |
| `rdlc.review` | Run deterministic and semantic quality checks. |
| `rdlc.dedupe` | Generate and adjudicate duplicate candidates. |
| `rdlc.trace` | Validate graph links and produce coverage. |
| `rdlc.tests` | Generate or review test candidates. |
| `rdlc.readiness` | Build the readiness package and approval plan. |
| `rdlc.approve` | Record a permitted stakeholder decision. |
| `rdlc.baseline` | Create an immutable approved baseline. |
| `rdlc.sync` | Pull, plan, preview, apply, and verify connector changes. |
| `rdlc.change` | Analyze and govern a baseline change. |
| `rdlc.doctor` | Validate installation, policy, state, and connectors. |

Commands that mutate external systems SHALL present the exact connection,
organization, project, items, operations, and write policy before application.

## 38. Role Lenses and Agents

Core role definitions include:

- `rdlc:facilitator`;
- `rdlc:business-analyst`;
- `rdlc:product-owner`;
- `rdlc:portfolio-analyst`;
- `rdlc:requirements-reviewer`;
- `rdlc:traceability-auditor`;
- `rdlc:test-designer`;
- `rdlc:integration-manager`;
- `rdlc:compliance-reviewer`;
- `rdlc:delivery-planner`.

These are role lenses, not automatic justification for multi-agent execution.
Interactive elicitation, clarification, and approval SHOULD remain inline with
the user. Independent execution is most useful for mutually blind reviews,
large source analysis, duplicate comparison, dependency analysis, and test
design.

An orchestrator SHALL provide only the necessary artifacts and permitted tools
to a delegated agent. Delegated output remains a proposal until integrated and
gated.

## 39. Customization

Users and organizations MAY customize:

- terminology and hierarchy;
- artifact types and ID patterns;
- templates and custom fields;
- acceptance-criteria formats;
- lifecycle stages and gates;
- approval roles and quorum;
- quality rules and severities;
- RAID types and scoring matrices;
- component classes and ownership models;
- dependency types;
- estimation schemes and scales;
- prioritization methods such as MoSCoW, WSJF, RICE, or custom methods;
- connector field and relation mappings;
- Confluence spaces, root pages, selection rules, body representations,
  attachment/comment inclusion, and macro handling;
- KB mounts and retrieval policy;
- test formats and output targets;
- retention, classification, and redaction policy;
- role prompts and organization-specific review lenses;
- reports and dashboards.

Customization SHALL resolve deterministically and SHALL expose the source and
version of every active rule. Locked controls SHALL be visible to the user.

## 40. Portfolio and PMO Support

The optional Portfolio module SHALL support:

- objectives, outcomes, and success measures;
- portfolio epics and initiatives;
- benefits and benefit owners;
- milestones and governance gates;
- cross-project dependencies;
- portfolio RAID+D roll-up;
- roadmap and release views;
- approval and baseline status;
- scope and change requests;
- status reporting;
- benefits realization evidence;
- links to funding, budget, capacity, and scheduling systems.

R-DLC SHOULD integrate with authoritative financial and resource tools rather
than implement full accounting, timesheet, or resource optimization systems in
Core.

## 41. Security, Privacy, and Trust

A conforming implementation SHALL:

1. Treat all imported content as untrusted.
2. Separate content from executable instructions and system prompts.
3. Use least-privilege connector scopes.
4. Keep secrets outside project artifacts and logs.
5. Enforce source, KB, and tracker access controls.
6. Redact tokens, credentials, personal data, and provider error payloads from
   logs and receipts according to policy.
7. Require preview and policy authorization for external writes.
8. Keep destructive connector operations disabled by default.
9. Record actor identity and authority for approval and waiver decisions.
10. Prevent an AI actor from impersonating a stakeholder.
11. Preserve tenant, organization, and project boundaries.
12. Detect prompt injection patterns in tracker comments and documents without
    treating ordinary business language as executable.
13. Support retention and deletion policies for captured personal or sensitive
    information.
14. Expose which sources and models influenced generated content.
15. Prevent restricted source content and its derivatives from entering a
    less-restricted model context, artifact, report, approval package, or
    external projection.

### 41.1 Retention, legal hold, deletion, and redaction

Every retained content class SHALL resolve to a policy defining classification,
purpose, owner, storage locations, retention period, deletion authority, legal
hold behavior, and whether source bytes may be embedded in an approval package
or baseline. Implementations SHOULD keep bulky or sensitive source bytes
separate from provenance and refer to them by access-controlled identity and
hash.

Before baseline, authorized deletion MAY remove content according to policy and
SHALL remove derived caches and indexes. After baseline, an implementation
MUST NOT silently rewrite the historical package, recompute its hash, or claim
that a redacted package is byte-for-byte the original. When law or policy
requires removal from an approved baseline, it SHALL:

1. Preserve a minimal redaction tombstone containing canonical artifact or
   source identity, original content hash, affected package and baseline,
   authorized actor, authority, scope, reason code, decision time, and optional
   replacement hash, while excluding the content being removed.
2. Delete or cryptographically erase the protected content and known derived
   copies within the declared storage boundary, subject to legal hold.
3. Create an append-only redaction addendum that projects the original package
   and baseline as `redacted` and, when applicable, `non-reconstructable`
   without modifying their original hashed manifests. Their original
   signatures or anchors remain historical proofs of the original hashes, not
   proofs of replacement text. `Governed-Regulated` SHALL sign and externally
   anchor the addendum.
4. Run impact analysis. A semantic replacement creates a new revision,
   approval package, and baseline under the materiality policy.
5. Record incomplete deletion, inaccessible replicas, provider retention, or
   backup limitations as an explicit exception.

Redaction tombstones and audit events SHALL minimize personal information. A
hash alone MUST NOT be treated as anonymization when the original value has a
small or guessable domain.

### 41.2 Trust boundaries

The implementation SHALL document trust boundaries among the local harness,
model provider, source stores, optional K-DLC, Git host, identity provider,
tracker, lease authority, signing service, trusted-time service, and external
anchor. It SHALL identify which content leaves each boundary and which system
is authoritative for identity, time, access control, and revision state.

## 42. Observability and Reports

Core reports include:

- engagement status and next action;
- capture and promotion queue;
- active work claims, contributors, and stale claims;
- working-to-draft promotion reviews and unresolved collisions;
- requirement quality findings;
- comment review queue;
- duplicate and conflict candidates;
- traceability matrix and graph coverage;
- dependency graph, cycles, and planning waves;
- component impact and ownership;
- estimation completeness and history;
- RAID aging and escalation;
- stakeholder readiness and approval status;
- baseline and change history;
- test coverage and verification status;
- connector drift, failures, and uncertain writes;
- Confluence source-lock freshness, unavailable pages, permission changes, and
  unresolved dynamic-content dependencies.

Reports are projections and MUST be reproducible from canonical artifacts,
state, audit events, and connector snapshots.

## 43. Error and Recovery Semantics

Errors SHALL be categorized as:

- validation failure;
- missing user input;
- approval required;
- permission denied;
- provider capability unavailable;
- provider conflict;
- rate limited;
- external write failed;
- external write uncertain;
- state corruption suspected;
- policy violation;
- recoverable stage failure;
- unrecoverable configuration failure.

Error output SHALL describe what was attempted, what changed, what did not
change, the safest next action, and whether retry is idempotent. It MUST NOT
expose secrets or silently skip a required gate.

## 44. Validation and Conformance Testing

Conformance is limited to deterministic, repeatable assertions. Model quality
is evaluated separately and MUST NOT be represented as deterministic
conformance.

### 44.1 Deterministic conformance suite

The repository SHALL provide exact fixtures and automated assertions for:

1. Artifact, relationship, state, changeset, identity-binding, lease, cursor,
   approval, and redaction-tombstone schemas.
2. `rdlc-jcs-v1` serialization and every hash profile, including
   cross-language known-answer vectors for Unicode, null and absent fields,
   decimals, large integers, ordered arrays, and set-like arrays.
3. UUIDv7 validation, canonical-identity preservation, display-alias
   allocation, and concurrent alias collision recovery.
4. Governance, synchronization, verification-progress, and
   verification-outcome transition tables.
5. Default and customized materiality decisions and the creation of a new
   immutable revision after material change.
6. Template inheritance, locked policies, and unknown-customization failure.
7. Verified identity binding, quorum, delegation, separation of duties,
   package-hash binding, approval read-back, and approval invalidation.
8. Regulated-profile signature, trusted-time, revocation, and external-anchor
   verification when `Governed-Regulated` is claimed.
9. Trace coverage, orphan detection, relationship constraints, dependency
   cycles, and planning waves.
10. Estimation-profile and RAID+D type-specific validation.
11. Connector dry runs, changeset previews, optimistic preconditions,
    idempotent retries, partial failures, uncertain-write reconciliation, and
    read-back hashes.
12. Polling-cursor atomicity, page failure, token expiry, overlap windows,
    duplicate events, and full reconciliation.
13. Webhook authentication, deduplication, reordered delivery, and poll-based
    repair when `Webhook-Receiver` is claimed.
14. Checkpoint and resume, recovery-breadcrumb mismatch, active and expired
    leases, forced lease break, and cross-host state compatibility for each
    claimed harness.
15. Prompt-injection isolation, tool-permission enforcement, secret redaction,
    retention decisions, and post-baseline redaction semantics.
16. Greenfield operation with no K-DLC configuration and intake fixtures for
    every required format, including explicit partial-extraction warnings.
17. Company issue-type discovery, custom mappings, and unknown-type prompts for
    each claimed connector profile.
18. Confluence selection locks, page-version anchoring, independent comment and
    attachment revisions, pagination/cursor recovery, permission changes,
    dynamic-content dependency warnings, and unavailable-page reconciliation
    for each claimed Confluence source profile.
19. Concurrent BA claims, stale-base three-way comparison, coverage and
    collision promotion gates, intentional multiple coverage, and two
    simultaneous promotion attempts.
20. Harness distribution drift and the reference scale fixture.

Rules that can be expressed deterministically, such as a missing required
field, SHALL be tested here even when a model can also describe the problem.

### 44.2 Semantic quality evaluation

Semantic behaviors such as ambiguity detection, contradiction review,
duplicate ranking, comment classification, component suggestions, dependency
suggestions, and test generation SHALL use versioned evaluation datasets rather
than exact-output conformance tests. Each evaluation run SHALL record:

- dataset and task version, licensing or origin, and train/test contamination
  controls;
- model, prompt, tool, policy, and retrieval configuration versions;
- number of trials and any supported random-seed or temperature controls;
- expected labels, permissible alternatives, and human adjudication guidance;
- precision, recall, F1, abstention, calibration, and blocking-false-negative
  measures where applicable; and
- threshold, confidence interval or observed variance, regression decision,
  and known limitations.

An implementation SHALL publish semantic quality claims separately from its
conformance claim. A semantic evaluator MAY approve a release threshold but
MUST NOT grant stakeholder approval, waive a deterministic gate, or turn a
suggestion into canonical truth. Human-reviewed decisions remain the expected
labels where a task has legitimate judgment rather than one exact answer.

### 44.3 Standing self-review regression fixture

The repository SHALL retain its earliest available frozen specification
baseline, the critical-review findings adjudicated against it, and each
finding's disposition as a standing self-review fixture. Where no pre-0.2
draft survives in the repository's history, the fixture anchors at the 0.2
baseline and its adjudicated review record. The evaluation SHALL test whether a reviewer
detects the known scope, terminology, hashing, identity, lifecycle, integrity,
concurrency, synchronization, privacy, scale, and evaluation defects without
requiring identical prose. New accepted specification defects SHALL be added
as regression cases with leakage controls so the fixture does not become a
claim of general reviewing ability.

### 44.4 Connector test safety

Connector contract tests SHOULD use recorded sanitized fixtures and optional
live integration suites. Live tests MUST use isolated test projects, synthetic
identities and content, bounded permissions, and cleanup plans. They MUST NOT
mutate production work items. Tests SHALL be partitioned by the exact connector
profile claimed; passing Jira Cloud company-managed tests does not imply Jira
Data Center, team-managed, or Jira Service Management conformance.

## 45. Initial Delivery Plan

### 45.1 Reference release 0.1: governed planning foundation

The first reference release SHALL claim only `Core`, `Planning`,
`Governed-Basic`, `Connected:Jira-Cloud-Company-Managed`, and
`Harness:Claude-Code`. Its bounded scope includes:

- portable v0.2 schemas, canonical hashing, UUID identity, trace graph, and
  lifecycle state;
- greenfield capture, the required direct-intake format matrix, anchored source
  snapshots, elicitation, drafting, triage, and promotion;
- company setup, Jira Cloud company-managed issue-taxonomy discovery, custom
  mappings, and comments as inception and review evidence;
- configurable templates, planning hierarchy, components, dependencies,
  estimation, non-development work, and RAID+D;
- deterministic validation and a clearly labeled initial semantic review;
- Multi-BA workstreams, advisory claims, mutation leases, coverage, collision
  review, and optimistic concurrency;
- identity-bound readiness, basic-integrity approvals, baselines, material
  change control, and redaction semantics;
- Jira incremental polling, changeset preview, approved writes, read-back,
  receipts, reconciliation, and durable resume; and
- the deterministic conformance suite applicable to the claimed profiles and
  the published scale benchmark.

Release 0.1 does not claim K-DLC integration, test generation, regulated
signatures, webhooks, Confluence API profiles, other Jira product profiles,
GitHub, Azure DevOps, Codex, or Kiro. Confluence pages MAY still be supplied as
manually exported HTML, PDF, DOCX, or other required direct-intake formats. An
experimental capability MAY ship, but MUST be labeled outside the release
conformance claim.

### 45.2 Reference release 0.2: knowledge and verification

Planned scope adds `Knowledge-Grounded`, `Verification`,
`Connected:GitHub-Issues`, `Source:Confluence-Cloud`, and `Harness:Codex`; test
generation and coverage; optional K-DLC evidence locks and knowledge-change
impact; and stronger versioned semantic evaluation. When the mounted K-DLC
version publishes
code-repository reverse-engineering artifacts, this release also consumes its
code-derived components, interfaces, behavior, and evidence as brownfield
requirement inputs without independently reimplementing reverse engineering.

### 45.3 Reference release 0.3: provider and harness expansion

Planned scope adds `Connected:GitHub-Projects`,
`Connected:AzureDevOps-Boards`, selected additional Jira profiles,
`Source:Confluence-Data-Center`, `Harness:Kiro-CLI`, `Harness:Kiro-IDE`,
`Webhook-Receiver`, and
`Governed-Regulated` after its signing, identity, trusted-time, and external
anchor profiles pass conformance.

### 45.4 Version 1.0 target

Version 1.0 defines the stable conformance manifest and migration guarantees.
The reference distribution MAY claim `Full` only when every module, connector
profile, harness profile, security control, fixture, and operational document
listed in that manifest passes.

### 45.5 Post-1.0 candidates

Candidate later work includes:

- optional rebuildable SQLite search index, runtime cache, and transaction
  accelerator;
- native test-management connectors;
- portfolio and benefits dashboards;
- additional trackers and document systems;
- facilitated planning-poker sessions;
- analytics across multiple requirement projects;
- richer process and journey modeling;
- MCP service mode for additional desktop and remote clients; and
- organization pack registry and signed distribution.

## 46. Definition of Done for Reference Release 0.1

Release 0.1 is complete only when one tagged build and its published test report
demonstrate this scenario end to end:

1. A user starts a greenfield engagement in Claude Code from a high-level scope
   document with no K-DLC configuration.
2. R-DLC detects the format, extracts anchored evidence, reports all skipped or
   partially processed content, and presents its scope understanding for
   correction.
3. Guided elicitation captures missing outcomes, stakeholders, boundaries,
   processes, rules, constraints, NFRs, governance needs, and open questions;
   the user promotes selected captures into traceable requirements.
4. R-DLC discovers a synthetic Jira Cloud company-managed project's hierarchy,
   custom issue types, templates, workflows, fields, approval mapping,
   estimation fields, link semantics, and immutable account identifiers.
5. It proposes components, planning items, non-development work, dependencies,
   RAID+D records, and estimates without treating proposals as accepted truth.
6. Two BAs create overlapping working stories. Claims reveal likely overlap;
   the promotion gate compares current requirement- and criterion-level
   coverage; a conflicting concurrent alias or promotion mutation is safely
   serialized by a lease and optimistic precondition.
7. The contributors resolve the collision through an audited human disposition
   and the accepted drafts pass deterministic template, trace, dependency,
   materiality, and approval-policy checks. Semantic findings remain labeled
   suggestions until dispositioned.
8. Verified Jira identities satisfy a readiness policy against the exact
   `rdlc-jcs-v1` approval-package hash. A generic task completed by the wrong
   account or against a stale hash is rejected.
9. R-DLC creates a basic-integrity baseline whose artifact, relationship,
   source, decision, and approval hashes pass independent known-answer
   verification.
10. A bounded changeset previews and writes the accepted plan to the synthetic
    Jira project, uses idempotency identities, reads back every operation, and
    stores receipts and the synchronization cursor.
11. A simulated interruption and uncertain response resume without duplicating
    verified writes; polling and full reconciliation repair a missed change.
12. A later material requirement change creates a new revision, invalidates the
    affected approval, and produces impact analysis without rewriting the old
    baseline.
13. An authorized privacy redaction preserves the tombstone and original hash
    evidence while marking the affected baseline non-reconstructable.
14. All applicable deterministic tests, required-format fixtures, migration
    fixture, standing self-review fixture, and the reference scale benchmark
    pass from a clean checkout.

## 47. Recommended Defaults

Unless a project explicitly chooses otherwise, implementations SHOULD use:

- `files-authoritative` authority mode;
- `propose` connector write mode;
- no K-DLC requirement unless the user or project enables it;
- direct scope documents retained as anchored engagement evidence;
- company setup resolved before generating provider-specific issue types;
- `working` author scope before shared `draft` promotion;
- advisory work claims and optimistic concurrency rather than long-lived hard
  locks;
- coverage and collision review immediately before draft promotion;
- all designated required approvers for readiness;
- task-based approval only when native approval is unavailable or not selected;
- captured comments as untrusted review inputs;
- Confluence connections read-only unless a separate write profile is
  explicitly installed and authorized;
- RAID+D enabled;
- no automatic estimate conversion;
- AI estimates, components, dependencies, and tests marked as suggestions;
- material changes invalidating affected approvals;
- read-back verification after every external write batch;
- checkpointing before and after every gate and write batch;
- separate Kiro CLI and Kiro IDE adapters over the same core.
