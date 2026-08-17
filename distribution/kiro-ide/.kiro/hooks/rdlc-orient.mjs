#!/usr/bin/env node
// R-DLC session orientation for Kiro IDE. Deduped to once per 4 hours via a
// marker file; best-effort, never fails the session.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
try {
  const marker = join("rdlc", ".kiro-oriented");
  try {
    if (Date.now() - Number(readFileSync(marker, "utf8")) < 4 * 3600 * 1000) process.exit(0);
  } catch { /* not yet oriented */ }
  const lines = [];
  if (existsSync("rdlc")) {
    lines.push("This project runs R-DLC governed requirements engagements (state under rdlc/).");
    try {
      const spaces = readdirSync(join("rdlc", "spaces"));
      if (spaces.length > 0) lines.push("Engagement spaces on record: " + spaces.length + " — the rdlc-status skill shows where each stands.");
    } catch { /* no spaces yet */ }
    lines.push("Approvals, baselines, and rdlc/reference change only through their governed skills — never by direct edit.");
  } else {
    lines.push("No R-DLC engagement detected. The rdlc-start skill begins one.");
  }
  // Only mark inside an existing rdlc/ dir: creating one here would make the
  // next orientation falsely claim an engagement exists (review LOW).
  if (existsSync("rdlc")) { try { writeFileSync(marker, String(Date.now())); } catch { /* dedup is best-effort */ } }
  process.stdout.write(lines.join("\n") + "\n");
} catch { /* orientation is best-effort */ }
