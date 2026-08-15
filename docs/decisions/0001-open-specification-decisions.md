# ADR-001: Open decisions and change candidates against specification 0.2.0

Status: Adjudicated 2026-08-15 (issue #2). Dispositions recorded per item.
Accepted specification changes landed through the change record in
[`../specification-baseline.md`](../specification-baseline.md).

## A. Editorial corrections

1. **§27.7 mojibake** — **Rejected (moot).** The committed specification is
   clean UTF-8 ("§14.5"); the artifact existed only in an external pasted
   copy, not in the baseline bytes.
2. **§2.2 K-DLC reference** — **Accepted.** The relative link to
   `./knowledge-development-lifecycle-specification.md` was replaced with the
   canonical cross-repository URL.
3. **§9 architecture diagram alignment** — **Deferred.** Cosmetic; batch with
   a future editorial revision rather than churn the baseline hash alone.
4. **§2.4 migration steps** — **Accepted.** A clarifying paragraph marks the
   0.1→0.2 migration procedure informative until an implementation claims
   such a migration, while retaining it as a §44.1 conformance fixture
   requirement.

## B. Reference-distribution decisions

5. **UUIDv7 source** — **Accepted: vendor a small audited UUIDv7
   implementation** (deterministic, no new dependency) instead of the `uuid`
   npm package. Lands with FEAT-004 (#5).
6. **rdlc-jcs-v1 layering** — **Accepted: reuse the `canonicalize` package**
   for RFC 8785 serialization, with an authored profile layer implementing
   schema-driven set sorting, NFC normalization, decimal/large-integer
   strings, and absence-vs-null rules via `x-rdlc-set-keys` and
   `x-rdlc-governed` JSON Schema extension keywords. Lands with FEAT-003 (#4).
7. **Lease authority for 0.1** — **Accepted: GitHub API ref compare-and-swap**
   over `refs/rdlc/leases/*` as the reference lease authority (atomic CAS
   visible to all writers); plain `git push` is not treated as a safe CAS.
   Lands with FEAT-004/FEAT-008 (#5, #9).
8. **Intake stack** — **Accepted: Node.js stack reusing K-DLC's trusted
   parsers** (pdfjs-dist, fflate, saxes, csv-parse, gifuct-js and peers);
   §16.2.3 amended to state the named tools are exemplary. VSDX, MSG, and OCR
   support are conditional until a sandboxed adapter exists. Lands with
   FEAT-007 (#8).
9. **Jira test surface** — **Accepted: recorded sanitized fixtures are the CI
   contract.** Live-suite wiring against a dedicated Atlassian sandbox is
   **deferred** until a tenant exists (owner decision 2026-08-15); credentials
   would enter only via GitHub secrets, never the repository. Lands with
   FEAT-010 (#11).
10. **Identity self-binding in a CLI harness** — **Accepted:** bind via an
    authenticated Jira `myself` API call over the user-supplied credential,
    recording the immutable `accountId`; full OAuth device flow deferred.
    Lands with FEAT-009 (#10).
11. **Scale benchmark environment** — **Accepted: GitHub-hosted
    `ubuntu-latest` runner class**, with hardware/runtime details captured per
    run in the published benchmark record. Lands with REL-001 (#13).
12. **Regulated profile stubs** — **Accepted:** no `Governed-Regulated`
    schemas or stubs are published in 0.1; the profile first appears with its
    conformance tests (§45.3).

## C. Repository-process decisions

13. **Deferred K-DLC governance machinery** — **Accepted:** release-matrix,
    supply-chain verification, and statistical-evidence workflows are not
    ported at bootstrap; they arrive as REL-scoped issues once a distribution
    exists. `Full`-style claims remain impossible by construction.
14. **Standing self-review fixture (§44.3)** — **Deferred pending import:**
    the frozen 0.1 specification and its critical-review findings live in the
    authoring workspace; import them under `fixtures/self-review/` before
    REL-001 verification, or amend the clause to start the fixture at 0.2.
15. **Semantic evaluation scope** — **Accepted:** adopt K-DLC's
    recorded-evaluation pattern when the first semantic reviewer ships;
    binding no earlier than reference release 0.2 (§45.2).
