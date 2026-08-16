# Specification example fixtures

Each file reproduces a specification example verbatim, except that
placeholder values the spec elides (`sha256:...`, `optional-provider-token`)
are expanded to schema-valid concrete values so the fixtures can be validated
strictly. Every substitution is limited to placeholder literals; no field is
added, removed, or renamed relative to the specification text.

| Fixture | Specification section |
|---|---|
| artifact.yaml | §12.3 Common envelope |
| source-snapshot-jira.yaml | §16.1 Source snapshots |
| source-snapshot-confluence.yaml | §16.1.1 Confluence page snapshots |
| finding.yaml | §24.3 Finding contract |
| principal.yaml | §27.2 Identity registry |
| changeset.yaml | §33.1 Changeset example |
| work-claim.yaml | §35.2 Work claims |
| lease.yaml | §35.9 Mutation leases |
| project.yaml | §11.1 Project manifest |
