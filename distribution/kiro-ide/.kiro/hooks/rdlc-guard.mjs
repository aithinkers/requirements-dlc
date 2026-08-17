#!/usr/bin/env node
// R-DLC write guard for Kiro IDE. Channel-aware (0.12 USER_PROMPT camelCase
// with a never-closing stdin; 1.x snake_case stdin JSON). Exit 2 blocks;
// unknown payloads fail open.
async function readPayload() {
  const legacy = process.env.USER_PROMPT ?? "";
  if (legacy.trim().length > 0) return legacy;
  const read = (async () => {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  })();
  const timeout = new Promise((settle) => setTimeout(settle, 2000, "").unref?.());
  return Promise.race([read, timeout]);
}
let parsed = {};
try { parsed = JSON.parse(await readPayload()); } catch { process.exit(0); }
const toolInput = parsed.tool_input ?? parsed.toolArgs ?? {};
let path = String(toolInput?.file_path ?? toolInput?.path ?? "");
if (!path) process.exit(0);
path = path.replace(/\\/g, "/").replace(/\/\.\//g, "/").replace(/\/{2,}/g, "/");
const rules = [
  [/rdlc\/(spaces\/[^/]+\/engagements\/[^/]+\/)?(approvals|baselines)\//,
    "Approvals and baselines are evidence — editing them by hand would break the audit trail. Use the rdlc-approve or rdlc-baseline skills instead."],
  [/rdlc\/reference\//,
    "The rdlc/reference files are the shared playbook installed by R-DLC. To change how the workflow behaves, change project policy or rerun setup — direct edits here get overwritten on upgrade."],
  [/rdlc\/\.install-manifest\.json$/,
    "This file is R-DLC's record of what it installed. It maintains itself."]
];
for (const [pattern, message] of rules) {
  if (pattern.test(path)) { console.error(message); process.exit(2); }
}
process.exit(0);
