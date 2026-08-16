## Procedure

MANDATORY: follow `rdlc/reference/stage-protocol.md` for gates, questions, and completion messages.

1. **Detect state.** Look for `rdlc/spaces/*/engagements/*/rdlc-state.yaml`. If found, load with breadcrumb verification and present the four §34.4 resume options with the recorded next action — wait for the choice.
2. **New engagement:** read `requirements-project.yaml`; confirm project identity and connectors (offer `/rdlc-setup-connector` if none configured and the user wants a tracker).
3. **Scope selection** (confirmation required): present the seven profiles from `rdlc/reference/scopes/` with one-line intents; recommend one from what the user described; show which stages the choice includes and which it trims, with the trim rationale.
4. Create the engagement (createEngagement), checkpoint, and hand off to the first stage (`workspace-detection` → `intent-framing`) under the facilitator lens.
5. Close with the standard completion summary: state file path, chosen scope, next stage.
