#!/usr/bin/env node
/**
 * R-DLC session orientation (SessionStart hook). Dependency-free: prints one
 * friendly line about where the engagement stands so a returning BA/PO knows
 * exactly where they left off. Never blocks the session.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function scalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

try {
  const base = join(process.cwd(), "rdlc", "spaces");
  const found = [];
  for (const space of readdirSync(base)) {
    const engagements = join(base, space, "engagements");
    let ids = [];
    try { ids = readdirSync(engagements); } catch { continue; }
    for (const id of ids) {
      try {
        const text = readFileSync(join(engagements, id, "rdlc-state.yaml"), "utf8");
        found.push({
          scope: scalar(text, "scope"),
          stage: scalar(text, "active_stage"),
          next: scalar(text, "next_action"),
          updated: scalar(text, "updated_at")
        });
      } catch { /* unreadable state surfaces via /rdlc-status */ }
    }
  }
  if (found.length === 0) {
    console.log("R-DLC is set up here but no engagement has started — /rdlc-start begins one.");
  } else {
    const latest = found.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
    const clean = (value) => value && /^[\w./ :-]{1,80}$/.test(value) ? value : null;
    if (clean(latest.stage) && clean(latest.scope)) {
      console.log(`R-DLC: ${found.length > 1 ? `${found.length} engagements; latest` : "engagement"} at stage "${clean(latest.stage)}" (${clean(latest.scope)} scope). Next: ${clean(latest.next) ?? "/rdlc-status"}`);
    } else {
      console.log("R-DLC: an engagement exists here — /rdlc-status has the details.");
    }
  }
} catch {
  // No rdlc/ here — stay silent; this project may not use R-DLC.
}
process.exit(0);
