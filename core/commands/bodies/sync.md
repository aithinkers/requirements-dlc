## Procedure

1. Load connector config (loadConnectorConfig) — refuse unconfigured or invalid setups with the named failures; offer `/rdlc-setup-connector`.
2. Pull current provider state; compute three-way diffs; conflicts require policy-directed resolution before any write (§29.4).
3. Build the changeset and PRESENT THE PREVIEW: connection, organization, project, every operation with its target and idempotency key, and the write mode (§37). In `propose` mode, stop here by design.
4. With batch approval, apply: idempotent creates, precondition-guarded updates, read-back verification, receipts. Report per-operation status (§29.5); uncertain outcomes are reconciled by idempotency identity, never blindly retried.
5. Record results in engagement state (recordApplyResults), persist cursors, run format-drift detection over polled updates, checkpoint.
