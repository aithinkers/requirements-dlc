## Procedure

Answer entirely from durable files — never from conversation memory (§34).

1. Load and verify state (breadcrumb check; report an interrupted checkpoint per its recovery hint).
2. Report: engagement + scope; completed/active/blocked stages against the stage graph; pending user decision; open blocking findings; unverified external writes; sync cursor freshness; the recorded next action.
3. If drift or uncertainty exists (state mismatch, uncertain writes, stale cursors), lead with it and the safest next step (§43).
