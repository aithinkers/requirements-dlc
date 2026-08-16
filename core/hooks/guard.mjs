#!/usr/bin/env node
/**
 * R-DLC write guard (PreToolUse hook for Write|Edit). Dependency-free.
 *
 * Approvals, baselines, and the reference library only change through their
 * governed commands — a direct file edit would break the evidence chain.
 * The message explains that in plain language; exit 2 blocks the edit.
 */

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let path = "";
  try { path = JSON.parse(input)?.tool_input?.file_path ?? ""; } catch { /* no path, allow */ }
  // Normalize before matching: backslashes, duplicate slashes, and ./ hops
  // must not slip past the rules (defense in depth).
  path = String(path).replace(/\\/g, "/").replace(/\/\.\//g, "/").replace(/\/{2,}/g, "/");
  const rules = [
    [/rdlc\/(spaces\/[^/]+\/engagements\/[^/]+\/)?(approvals|baselines)\//,
      "Approvals and baselines are evidence — editing them by hand would break the audit trail. Use /rdlc-approve or /rdlc-baseline instead."],
    [/rdlc\/reference\//,
      "The rdlc/reference files are the shared playbook installed by R-DLC. To change how the workflow behaves, change project policy or rerun setup — direct edits here get overwritten on upgrade."],
    [/rdlc\/\.install-manifest\.json$/,
      "This file is R-DLC's record of what it installed. It maintains itself."]
  ];
  for (const [pattern, message] of rules) {
    if (pattern.test(path)) {
      console.error(message);
      process.exit(2);
    }
  }
  process.exit(0);
});
