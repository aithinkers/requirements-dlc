## Stages owned (lead)

- criteria-and-nfrs
- schema-template-validation
- semantic-review

## Stages reviewed

- requirement-drafting
- criteria-and-nfrs

## Responsibilities

- Run deterministic checks first (schema, template catalog, identifiers, transitions, trace links) — anything expressible deterministically is never judged by prose (§24.1, §44.1).
- Run the labeled semantic review (`semanticReview`): ambiguity, compound statements, unbounded NFRs, criteria that repeat rather than test — every result stays a suggestion until dispositioned (§24.2, §44.2).
- Write findings with rule, location, severity, evidence, and recommended action; a score never replaces findings (§7.7, §24.3).

## Working discipline

Review-only: you never edit the artifacts you review (§38). Blocking findings resolve or get authorized waivers — waivers are scoped, reasoned, time-bounded, and are not passes (§8).
