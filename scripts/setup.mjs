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
 *   npx github:aithinkers/requirements-dlc [--target <dir>] [--tool <host>] [--force] [--check]
 *   Hosts: claude-code (default) | codex | kiro | kiro-ide  — codex and kiro
 *   surfaces are experimental and outside the 0.1 conformance claim (§45.1).
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TOOLS = Object.freeze(["claude-code", "codex", "kiro", "kiro-ide"]);

function parseArguments(argv) {
  const options = { target: process.cwd(), tool: "claude-code", force: false, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--target") options.target = resolve(argv[++index] ?? ".");
    else if (argv[index] === "--tool") options.tool = argv[++index];
    else if (argv[index] === "--force") options.force = true;
    else if (argv[index] === "--check") options.check = true;
    else if (argv[index] === "--help" || argv[index] === "-h") options.help = true;
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return options;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function walk(base, prefix = "") {
  const entries = [];
  for (const entry of await readdir(join(base, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) entries.push(...await walk(base, relative));
    else entries.push(relative);
  }
  return entries;
}

async function listPluginFiles(tool) {
  if (!TOOLS.includes(tool)) throw new Error(`unknown tool: ${tool} (expected ${TOOLS.join("|")})`);
  if (tool === "claude-code") {
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
    for (const relative of await walk(join(base, "reference"))) {
      files.push({ source: join(base, "reference", relative), relative: join("rdlc", "reference", relative) });
    }
    for (const relative of await walk(join(base, "hooks"))) {
      if (relative === "hooks.json") continue; // merged into settings below
      files.push({ source: join(base, "hooks", relative), relative: join("rdlc", "hooks", relative) });
    }
    return files;
  }
  // Codex and Kiro surfaces install their dot-directory trees verbatim
  // (.codex/… or .kiro/…). Experimental outside the 0.1 conformance claim.
  const base = join(packageRoot, "distribution", tool);
  const dot = tool === "codex" ? ".codex" : ".kiro";
  const files = (await walk(join(base, dot))).map((relative) => ({
    source: join(base, dot, relative),
    relative: join(dot, relative)
  }));
  for (const relative of await walk(join(base, "reference"))) {
    files.push({ source: join(base, "reference", relative), relative: join("rdlc", "reference", relative) });
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

# Declare connectors here and describe each in its mapping file, e.g.:
#   - id: delivery-jira
#     provider: jira
#     mapping: config/connectors/jira-example.yaml
#     write_mode: propose
connectors: []

security:
  external_content: untrusted
  secrets_provider: environment
`;
}

const EXAMPLE_MAPPING = `schema_version: rdlc.connector-mapping/v0.2
version: jira-example/v1
provider: jira
project_key: COM
fields: [summary, description, status, components, customfield_10016]

estimation:
  profile: team-story-points
  provider_field: customfield_10016
  scheme: story-points
  allowed_values: [1, 2, 3, 5, 8, 13]
  # confirmers: [urn:uuid:...]        # who may confirm estimates (§22.2)

components:
  provider_field: components
  match_by: name

artifact_types:
  story:
    issue_type: Story
    template_fields:
      statement: summary
      acceptance_criteria: description
  epic:
    issue_type: Epic
    template_fields:
      outcome: summary
`;

const ADO_EXAMPLE_MAPPING = `schema_version: rdlc.connector-mapping/v0.2
version: ado-example/v1
provider: azure-devops
organization: your-org
project_key: YourProject
# NOTE: azure-devops runtime synchronization is roadmap (§45.3); this mapping
# powers template validation and format-drift checks today.
fields: [System.Title, System.Description, System.State, System.AreaPath, Microsoft.VSTS.Scheduling.StoryPoints, Microsoft.VSTS.Common.AcceptanceCriteria]

estimation:
  profile: team-story-points
  provider_field: Microsoft.VSTS.Scheduling.StoryPoints
  scheme: story-points
  allowed_values: [1, 2, 3, 5, 8, 13]

components:
  provider_field: System.AreaPath
  match_by: name

artifact_types:
  story:
    issue_type: User Story
    template_fields:
      statement: System.Title
      acceptance_criteria: Microsoft.VSTS.Common.AcceptanceCriteria
  epic:
    issue_type: Epic
    template_fields:
      outcome: System.Title
`;

const SCAFFOLD_DIRECTORIES = [
  "rdlc/spaces/main/policy",
  "rdlc/spaces/main/templates",
  "rdlc/spaces/main/stakeholders",
  "rdlc/spaces/main/identities",
  "rdlc/spaces/main/collaboration/claims",
  "rdlc/spaces/main/collaboration/leases",
  "rdlc/spaces/main/engagements"
];

async function fileState(path, expected, installedHash) {
  try {
    const current = await readFile(path);
    const currentHash = sha256(current);
    if (currentHash === sha256(expected)) return "unchanged";
    // Upgrade-aware protection: a file still matching what R-DLC installed
    // last time was never touched by the user — new versions apply cleanly.
    if (installedHash && currentHash === installedHash) return "upgradeable";
    return "modified";
  } catch {
    return "absent";
  }
}

export async function runSetup({ target, tool = "claude-code", force = false, check = false, log = console.log }) {
  const results = { installed: [], skipped: [], protected: [], scaffolded: [], drift: [] };
  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    throw new Error(`target directory does not exist: ${target}`);
  }
  if (!targetStat.isDirectory()) throw new Error(`target is not a directory: ${target}`);

  const manifestPath = join(target, "rdlc", ".install-manifest.json");
  let installManifest = {};
  try { installManifest = JSON.parse(await readFile(manifestPath, "utf8")).files ?? {}; } catch { /* first install */ }
  const plan = await listPluginFiles(tool);
  const projectId = basename(resolve(target)) || "rdlc-project";
  plan.push({ content: projectManifest(projectId), relative: "requirements-project.yaml" });
  plan.push({ content: EXAMPLE_MAPPING, relative: join("config", "connectors", "jira-example.yaml") });
  plan.push({ content: ADO_EXAMPLE_MAPPING, relative: join("config", "connectors", "azure-devops-example.yaml") });

  const newManifest = {};
  for (const entry of plan) {
    const destination = join(target, entry.relative);
    const expected = entry.content !== undefined ? Buffer.from(entry.content) : await readFile(entry.source);
    const expectedHash = sha256(expected);
    const state = await fileState(destination, expected, installManifest[entry.relative]);
    newManifest[entry.relative] = expectedHash;
    if (check) {
      if (state === "modified") results.drift.push({ file: entry.relative, state });
      if (state === "absent" || state === "upgradeable") results.drift.push({ file: entry.relative, state });
      continue;
    }
    if (state === "unchanged") {
      results.skipped.push(entry.relative);
      continue;
    }
    if (state === "modified" && !force) {
      // The user changed this file since we installed it — never clobber.
      results.protected.push(entry.relative);
      newManifest[entry.relative] = installManifest[entry.relative] ?? expectedHash;
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, expected);
    (state === "upgradeable" ? (results.upgraded ??= []) : results.installed).push(entry.relative);
  }
  if (!check) {
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ schema_version: "rdlc.install-manifest/v1", files: newManifest }, null, 2) + "\n");
  }

  if (!check && tool === "claude-code") {
    // Session hooks: create or merge .claude/settings.json — never touching
    // hooks that are not ours (issue #48).
    const settingsPath = join(target, ".claude", "settings.json");
    let settings = {};
    let settingsReadable = true;
    try { settings = JSON.parse(await readFile(settingsPath, "utf8")); } catch (error) {
      if (error?.code !== "ENOENT") settingsReadable = false;
    }
    const shapeOk = settingsReadable
      && (settings.hooks === undefined || (typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
        && Object.values(settings.hooks).every((value) => Array.isArray(value))));
    if (settingsReadable && shapeOk) {
      const ours = JSON.parse(await readFile(join(packageRoot, "distribution", "claude-code", "hooks", "hooks.json"), "utf8")).hooks;
      settings.hooks ??= {};
      let merged = false;
      for (const [event, entries] of Object.entries(ours)) {
        settings.hooks[event] ??= [];
        for (const entry of entries) {
          const command = entry.hooks[0].command;
          const present = settings.hooks[event].some((existing) =>
            (existing.hooks ?? []).some((hook) => hook.command === command));
          if (!present) {
            settings.hooks[event].push(entry);
            merged = true;
          }
        }
      }
      if (merged) {
        await mkdir(dirname(settingsPath), { recursive: true });
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        results.hooks_merged = true;
      }
    } else {
      results.hooks_skipped = "your .claude/settings.json couldn't be updated automatically (unusual format); to enable the session hooks, copy the entries from rdlc-installed hooks (distribution hooks.json) in yourself — nothing else is affected";
    }
  }
  if (!check) {
    // Scaffold memory files from templates when absent (user content after that).
    for (const memory of ["organization.md", "project.md", "team.md"]) {
      const destination = join(target, "rdlc", "spaces", "main", "memory", memory);
      const source = join(packageRoot, "distribution", tool === "claude-code" ? "claude-code" : tool, "reference", "memory-templates", memory);
      try {
        // Exclusive create: never clobbers user content, no check-then-write race.
        const content = await readFile(source);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content, { flag: "wx" });
        results.scaffolded.push(join("rdlc", "spaces", "main", "memory", memory));
      } catch { /* already present, or host without templates */ }
    }
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

  log(`R-DLC setup ${check ? "check" : "install"} (${tool}) for ${target}`);
  if (tool !== "claude-code" && !check) log("  note: this harness surface is experimental and outside the 0.1 conformance claim (§45.1)");
  if (check) {
    log(results.drift.length === 0 ? "  up to date" : results.drift.map((entry) => `  drift: ${entry.file} (${entry.state})`).join("\n"));
  } else {
    log(`  installed: ${results.installed.length}, upgraded: ${results.upgraded?.length ?? 0}, unchanged: ${results.skipped.length}, scaffolded: ${results.scaffolded.length}`);
    if (results.hooks_merged) log("  session hooks added to .claude/settings.json (orientation + write guard)");
    if (results.hooks_skipped) log(`  NOTE: ${results.hooks_skipped}`);
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

// realpathSync both sides: npm/npx install bins as SYMLINKS, and a lexical
// compare made the npx entry point silently no-op (#62).
const invokedAs = process.argv[1] ? (() => { try { return realpathSync(resolve(process.argv[1])); } catch { return resolve(process.argv[1]); } })() : null;
if (invokedAs && invokedAs === realpathSync(fileURLToPath(import.meta.url))) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: npx github:aithinkers/requirements-dlc (or rdlc-setup) [--target <dir>] [--tool claude-code|codex|kiro|kiro-ide] [--force] [--check]

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
