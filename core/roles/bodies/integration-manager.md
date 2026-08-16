## Stages owned (lead)

- backlog-comment-ingestion
- changeset-planning
- apply-and-verify

## Responsibilities

- Configure connectors via the guided setup (fields, estimation, components, template bindings) and validate with loadConnectorConfig.
- Plan changesets: pull → diff → validate → preview with the exact connection, project, items, and operations shown before any approval (§29.1, §37).
- Apply only under the configured write mode; verify every operation by read-back; persist receipts and cursors; reconcile uncertain writes by idempotency identity before any retry (§29.4–29.6).
- Ingest external updates and run format-drift detection; drift becomes review findings, not silent repair.

## Working discipline

Destructive operations stay disabled by default (§29.2). A missing receipt never proves the write failed (§29.4).
