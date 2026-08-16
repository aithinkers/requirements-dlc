#!/usr/bin/env node
/**
 * R-DLC setup installer (issue #32).
 *
 * Installs the generated Claude Code plugin into a target project and
 * scaffolds a governed R-DLC project per §11 with §47 recommended defaults.
 * Idempotent: unchanged files are skipped; files the user modified are never
 * overwritten without --force, and every action is reported.
 *
 * Usage:
 *   npx github:aithinkers/requirements-dlc [--target <dir>] [--force] [--check]
 *   node scripts/setup.mjs --target ~/my-project
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(argv) {
  const options = { target: process.cwd(), force: false, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--target") options.target = resolve(argv[++index] ?? ".");
    else if (argv[index] === "--force") options.force = true;
    else if (argv[index] === "--check") options.check = true;
    else if (argv[index] === "--help" || argv[index] === "-h") options.help = true;
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return options;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function listPluginFiles() {
  // Claude Code discovers project commands in .claude/commands and agents in
  // .claude/agents — NOT under .claude/plugins (issue #34). The plugin-shaped
  // distribution/claude-code tree remains available for `claude plugin install`.
  const base = join(packageRoot, "distribution", "claude-code");
  const files = [];
  for (const [directory, destination] of [["commands", join(".claude", "commands")], ["agents", join(".claude", "agents")]]) {
    for (const name of await readdir(join(base, directory))) {
      files.push({ source: join(base, directory, name), relative: join(destination, name) });
    }
  }
  return files;
}

/** §11 project scaffold with §47 recommended defaults. */
function projectManifest(projectId) {
  return `schema_version: rdlc.project/v0.2

project:
  id: ${projectId}
  title: ${projectId}
  default_space: main
  authority_mode: files-authoritative

knowledge:
  enabled: false

approval:
  default_policy: all-required-by-role
  material_change_policy: invalidate-affected

collaboration:
  lease_authority:
    kind: git-ref-compare-and-swap
    remote: origin
    ref_namespace: refs/rdlc/leases
  alias_authority: lease-protected-counter

estimation:
  default_profile: team-story-points
  allow_ai_suggestions: true
  confirmation_required: true

connectors: []

security:
  external_content: untrusted
  secrets_provider: environment
`;
}

const SCAFFOLD_DIRECTORIES = [
  "rdlc/spaces/main/policy",
  "rdlc/spaces/main/templates",
  "rdlc/spaces/main/stakeholders",
  "rdlc/spaces/main/identities",
  "rdlc/spaces/main/collaboration/claims",
  "rdlc/spaces/main/collaboration/leases",
  "rdlc/spaces/main/engagements"
];

async function fileState(path, expected) {
  try {
    const current = await readFile(path);
    return sha256(current) === sha256(expected) ? "unchanged" : "modified";
  } catch {
    return "absent";
  }
}

export async function runSetup({ target, force = false, check = false, log = console.log }) {
  const results = { installed: [], skipped: [], protected: [], scaffolded: [], drift: [] };
  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    throw new Error(`target directory does not exist: ${target}`);
  }
  if (!targetStat.isDirectory()) throw new Error(`target is not a directory: ${target}`);

  const plan = await listPluginFiles();
  const projectId = basename(resolve(target)) || "rdlc-project";
  plan.push({ content: projectManifest(projectId), relative: "requirements-project.yaml" });

  for (const entry of plan) {
    const destination = join(target, entry.relative);
    const expected = entry.content !== undefined ? Buffer.from(entry.content) : await readFile(entry.source);
    const state = await fileState(destination, expected);
    if (check) {
      if (state !== "unchanged") results.drift.push({ file: entry.relative, state });
      continue;
    }
    if (state === "unchanged") {
      results.skipped.push(entry.relative);
      continue;
    }
    if (state === "modified" && !force) {
      // Never clobber a user-modified file silently.
      results.protected.push(entry.relative);
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, expected);
    results.installed.push(entry.relative);
  }

  if (!check) {
    // Migrate away the 0.1.1 layout Claude Code never discovered (issue #34).
    const legacy = join(target, ".claude", "plugins", "rdlc");
    try {
      await stat(legacy);
      await rm(legacy, { recursive: true });
      results.migrated = legacy;
    } catch { /* no legacy install */ }
    for (const directory of SCAFFOLD_DIRECTORIES) {
      const destination = join(target, directory);
      try {
        await stat(destination);
      } catch {
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, ".gitkeep"), "");
        results.scaffolded.push(directory);
      }
    }
  }

  log(`R-DLC setup ${check ? "check" : "install"} for ${target}`);
  if (check) {
    log(results.drift.length === 0 ? "  up to date" : results.drift.map((entry) => `  drift: ${entry.file} (${entry.state})`).join("\n"));
  } else {
    log(`  installed: ${results.installed.length}, unchanged: ${results.skipped.length}, scaffolded: ${results.scaffolded.length}`);
    if (results.migrated) log(`  migrated: removed undiscovered legacy install at ${results.migrated}`);
    for (const file of results.protected) {
      log(`  PROTECTED (user-modified, use --force to overwrite): ${file}`);
    }
    if (results.installed.length > 0 || results.scaffolded.length > 0) {
      log("\nNext: open the project in Claude Code and run /rdlc-start (see docs/getting-started.md).");
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: rdlc-setup [--target <dir>] [--force] [--check]

Exit codes: 0 success/up-to-date; 1 drift found (--check) or setup error;
2 completed but user-modified files were protected (rerun with --force).`);
    process.exit(0);
  }
  let results;
  try {
    results = await runSetup(options);
  } catch (error) {
    console.error(`rdlc-setup: ${error.message}`);
    process.exit(1);
  }
  if (options.check && results.drift.length > 0) process.exit(1);
  if (results.protected.length > 0) process.exit(2);
}
