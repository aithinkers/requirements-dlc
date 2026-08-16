#!/usr/bin/env node
/**
 * rdlc-sensors — plain-language project health for BAs, POs, and release
 * managers. Run from any R-DLC project (or --target <dir>). Exit 0 when all
 * checks pass, 1 when something needs attention.
 */

import process from "node:process";
import { resolve } from "node:path";

import { runSensors, SENSORS } from "../core/lib/sensors.mjs";

let target = process.cwd();
const names = [];
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--target") target = resolve(argv[++index] ?? ".");
  else if (argv[index] === "--help" || argv[index] === "-h") {
    console.log(`Usage: rdlc-sensors [--target <dir>] [check ...]\nChecks: ${Object.keys(SENSORS).join(", ")} (default: all)`);
    process.exit(0);
  } else names.push(argv[index]);
}

const { results, summary, ok } = await runSensors(target, names.length ? { names } : {});
for (const entry of results) {
  console.log(`${entry.ok ? "✓" : "✗"} ${entry.headline}${entry.next_command && !entry.ok ? `  → ${entry.next_command}` : ""}`);
}
console.log(`\n${summary}`);
process.exit(ok ? 0 : 1);
