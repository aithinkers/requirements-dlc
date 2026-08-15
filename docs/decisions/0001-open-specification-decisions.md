# ADR-001: Open decisions and change candidates against specification 0.2.0

Status: Proposed — each item needs an explicit adjudication before or during
the implementation slice it affects. Accepted changes to the specification
must land through the change record in
[`../specification-baseline.md`](../specification-baseline.md).

## A. Editorial corrections (low risk, need a recorded spec amendment)

1. **§27.7 mojibake** — the text reads "according to Â§14.5"; the `Â` is a
   UTF-8/CP1252 encoding artifact and should read "§14.5".
2. **§2.2 K-DLC reference** — links to
   `./knowledge-development-lifecycle-specification.md`, which does not exist
   in this repository. Replace with the canonical cross-repository URL
   (https://github.com/aithinkers/knowledge-dlc).
3. **§9 architecture diagram** — the `RAID+D` row has inconsistent box
   alignment (cosmetic).
4. **§2.4 migration steps** — the 0.1→0.2 migration procedure is normative,
   but no 0.1 project exists. Mark the migration clause informative-until-1.0
   or keep it as a conformance fixture requirement only (§44.1 item 16 vs.
   §46 item 14 both reference a "migration fixture" — decide which governs).

## B. Reference-distribution decisions (block implementation slices)

5. **UUIDv7 source** — Node's `crypto.randomUUID()` emits v4. Decide: vendor a
   small audited UUIDv7 implementation (recommended — deterministic, no new
   dependency) vs. the `uuid` npm package. Affects §12.1 and every schema.
6. **rdlc-jcs-v1 layering** — RFC 8785 serialization can reuse the
   `canonicalize` package already trusted in K-DLC, but the profile's
   schema-driven set-sorting, NFC normalization, decimal-as-string, and
   absence-vs-null rules must be an authored layer above it. Decide the
   schema annotation format for "set-like array" and "governed field"
   (proposal: `x-rdlc-set-keys` / `x-rdlc-governed` JSON Schema extensions).
7. **Lease authority for 0.1** — §11.1 example names
   `git-ref-compare-and-swap` over `refs/rdlc/leases`; §35.9 requires atomic
   CAS visible to all writers. Git ref updates via the GitHub API are
   CAS-capable; plain `git push` is not a safe CAS under races on some
   transports. Decide the reference lease authority: GitHub API ref CAS
   (recommended), provider-conditional-create, or defer multi-writer leases
   behind a single-writer default for 0.1.
8. **Intake stack** — §16.2.3's informative stack is Python-centric (PyMuPDF,
   python-docx, openpyxl). This repository's tooling is Node. Decide: reuse
   the K-DLC Node extraction stack (pdfjs-dist, fflate, saxes, csv-parse,
   gifuct-js) and amend §16.2.3, or introduce a Python toolchain. Recommend
   Node reuse; VSDX/MSG/OCR support becomes "conditional" until a sandboxed
   adapter exists.
9. **Jira test surface** — §46 requires a *synthetic* Jira Cloud
   company-managed project for the DoD scenario. Decide: recorded sanitized
   fixtures as the CI contract plus an optional live suite against a
   dedicated Atlassian sandbox (who owns the tenant and credentials; secrets
   never in-repo per §11.1). CI must pass with fixtures alone.
10. **Identity verification in a CLI harness** — §27.2 "authenticated
    self-binding" needs a concrete 0.1 mechanism. Proposal: bind via an
    authenticated Jira `myself` API call over the user-supplied token,
    recording the immutable accountId; full OAuth device flow deferred.
11. **Scale benchmark environment** — §7.10 requires a published benchmark
    with declared hardware. Decide the reference environment (proposal: the
    GitHub-hosted `ubuntu-latest` runner class, documented per run) and when
    the 5,000-artifact fixture generator lands (needed by §44.1 item 20).
12. **Trusted time / regulated profile** — out of 0.1 scope (§45.3); confirm
    no `Governed-Regulated` schema stubs are published early enough to be
    mistaken for supported capability.

## C. Repository-process decisions (this repo's governance, not the spec)

13. **Deferred K-DLC governance machinery** — release-matrix, supply-chain
    verification, and statistical-evidence workflows are not ported in the
    bootstrap. They become REL-scoped issues once there is a distribution to
    release. Until then `Full`-style claims are impossible by construction.
14. **Standing self-review fixture (§44.3)** — requires the frozen 0.1 spec
    and its critical-review findings. Those artifacts must be imported (from
    the authoring workspace) or the clause amended to start the fixture at
    0.2. Decide before REL work begins.
15. **Spec §46/§44 semantic evaluation** — semantic review quality claims need
    versioned datasets; adopt K-DLC's recorded-evaluation pattern when the
    first semantic reviewer ships (release 0.2 per §45.2 is when this becomes
    binding — confirm scope).
