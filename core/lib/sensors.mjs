/**
 * Stage sensors with human-first reporting (§15, §42).
 *
 * Each sensor wraps the tested engine and answers three questions in plain
 * language: is anything wrong, what does it mean for the work, and which
 * command fixes it. Rule codes and stack traces stay in `details` for
 * engineers; the `headline` is written for BAs, POs, and release managers.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import YAML from "yaml";

import { detectCycles } from "./promotion.mjs";
import { loadCatalog } from "./template-catalog.mjs";
import { createValidator, validateRecord } from "../schemas/v0.2/index.mjs";

/** One sensor result, written for humans first. */
function result(sensor, ok, headline, { next = null, details = [] } = {}) {
  return { sensor, ok, headline, next_command: next, details };
}

async function loadArtifacts(projectRoot) {
  const artifacts = [];
  const base = join(projectRoot, "rdlc", "spaces");
  let spaces = [];
  try { spaces = await readdir(base); } catch { return artifacts; }
  for (const space of spaces) {
    let engagements = [];
    try { engagements = await readdir(join(base, space, "engagements")); } catch { continue; }
    for (const engagement of engagements) {
      const artifactRoot = join(base, space, "engagements", engagement, "artifacts");
      let kinds = [];
      try { kinds = await readdir(artifactRoot); } catch { continue; }
      for (const kind of kinds) {
        let files = [];
        try { files = await readdir(join(artifactRoot, kind)); } catch { continue; }
        for (const file of files.filter((name) => /\.(ya?ml|json)$/.test(name))) {
          try {
            const text = await readFile(join(artifactRoot, kind, file), "utf8");
            artifacts.push({ file: join(kind, file), record: YAML.parse(text) });
          } catch {
            artifacts.push({ file: join(kind, file), unreadable: true });
          }
        }
      }
    }
  }
  return artifacts;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const SENSORS = {
  /** Every stored artifact matches its schema. */
  async schema(context) {
    const broken = [];
    const ajv = await createValidator();
    for (const entry of context.artifacts) {
      if (entry.unreadable) { broken.push({ file: entry.file, reason: "file cannot be read" }); continue; }
      if (!entry.record?.schema_version) continue;
      const { valid, failures } = await validateRecord(entry.record, ajv);
      if (!valid) broken.push({ file: entry.file, reason: failures[0] });
    }
    return broken.length === 0
      ? result("schema", true, "All stored records are well-formed.")
      : result("schema", false,
          `${plural(broken.length, "record")} in this project can't be used reliably until repaired — nothing has been deleted.`,
          { next: "/rdlc-doctor", details: broken });
  },

  /** Every typed artifact carries its template's expected elements. */
  async "template-catalog"(context) {
    const catalog = await loadCatalog();
    const known = new Set(catalog.types());
    const gaps = [];
    for (const entry of context.artifacts) {
      const record = entry.record;
      if (!record?.type || !known.has(record.type)) continue;
      const failures = catalog.validateArtifact(record);
      if (failures.length > 0) gaps.push({ file: entry.file, title: record.title ?? record.display_id ?? entry.file, missing: failures });
    }
    if (gaps.length === 0) return result("template-catalog", true, "Every requirement and story has its expected content.");
    const example = gaps[0];
    return result("template-catalog", false,
      `${plural(gaps.length, "item")} ${gaps.length === 1 ? "is" : "are"} missing expected content — e.g. "${example.title}" (${example.missing[0].replace("required field missing: ", "no ").replaceAll("_", " ")}). Incomplete items will be held at the promotion gate.`,
      { next: "/rdlc-draft", details: gaps });
  },

  /** No hard dependency loops. */
  async cycles(context) {
    const edges = [];
    for (const entry of context.artifacts) {
      for (const relationship of entry.record?.relationships ?? []) {
        if (relationship.type === "depends-on") edges.push({ source: entry.record.id, target: relationship.target });
      }
    }
    const cycles = detectCycles(edges);
    return cycles.length === 0
      ? result("cycles", true, "No circular dependencies — the work can be sequenced.")
      : result("cycles", false,
          `${plural(cycles.length, "dependency loop")} found — the items in each loop wait on each other, so none of them can start. Someone needs to break the loop.`,
          { next: "/rdlc-dependencies", details: cycles.map((cycle) => ({ loop: cycle })) });
  },

  /** Engagement state is healthy and resumable. */
  async state(context) {
    const { loadEngagement } = await import("./engagement.mjs");
    const base = join(context.projectRoot, "rdlc", "spaces");
    const engagements = [];
    let spaces = [];
    try { spaces = await readdir(base); } catch { /* none yet */ }
    for (const space of spaces) {
      let ids = [];
      try { ids = await readdir(join(base, space, "engagements")); } catch { continue; }
      for (const id of ids) {
        const directory = join(base, space, "engagements", id);
        try {
          await readFile(join(directory, "rdlc-state.yaml"));
        } catch { continue; }
        try {
          const { state } = await loadEngagement(directory);
          engagements.push({ id, next: state.next_action, uncertain: state.uncertain_writes?.length ?? 0 });
        } catch (error) {
          return result("state", false,
            "An engagement's saved progress doesn't match its safety record — it was probably interrupted mid-save. Resume it to recover safely; don't edit the files by hand.",
            { next: "/rdlc-start", details: [{ engagement: id, error: error.message }] });
        }
      }
    }
    if (engagements.length === 0) return result("state", true, "No engagement started yet.", { next: "/rdlc-start" });
    const uncertain = engagements.filter((entry) => entry.uncertain > 0);
    if (uncertain.length > 0) {
      return result("state", false,
        `${plural(uncertain.reduce((sum, entry) => sum + entry.uncertain, 0), "tracker write")} finished with an unknown outcome — the tracker may or may not have the change. Run a sync to reconcile before writing anything else.`,
        { next: "/rdlc-sync", details: uncertain });
    }
    return result("state", true, `${plural(engagements.length, "engagement")} healthy. Next: ${engagements[0].next}`);
  },

  /** Release assignments point at declared, live releases. */
  async releases(context) {
    const { validateReleaseAssignments } = await import("./scope-doc.mjs");
    const releases = context.artifacts.filter((entry) => entry.record?.type === "release").map((entry) => entry.record);
    const assigned = context.artifacts.filter((entry) => entry.record?.target_release != null && entry.record.target_release !== "").map((entry) => entry.record);
    if (assigned.length === 0) return result("releases", true, "No release assignments yet (assign work to a release anytime).");
    let findings;
    try {
      findings = validateReleaseAssignments(assigned, releases);
    } catch (error) {
      return result("releases", false,
        "The declared releases themselves have a problem (a duplicate or unnamed release) — fix the release records before assigning work to them.",
        { next: "/rdlc-scope-doc", details: [{ error: error.message }] });
    }
    return findings.length === 0
      ? result("releases", true, `${plural(assigned.length, "item")} assigned across ${plural(releases.length, "release")} — all assignments check out.`)
      : result("releases", false,
          `${plural(findings.length, "item")} point${findings.length === 1 ? "s" : ""} at a release that doesn't exist or was cancelled — those items are effectively unscheduled until someone fixes the assignment.`,
          { next: "/rdlc-scope-doc", details: findings });
  },

  /** Connector configuration is valid, when declared. */
  async connectors(context) {
    const { loadConnectorConfig } = await import("./connector-config.mjs");
    const catalog = await loadCatalog();
    try {
      const configs = await loadConnectorConfig(context.projectRoot, { catalogTypes: catalog.types() });
      if (configs.length === 0) return result("connectors", true, "No tracker connected (that's fine — connect one anytime).", { next: "/rdlc-setup-connector" });
      return result("connectors", true, `${plural(configs.length, "tracker connection")} configured and valid (${configs.map((config) => config.id).join(", ")}).`);
    } catch (error) {
      return result("connectors", false,
        "A tracker connection is configured but its settings don't add up — syncing would fail. The setup assistant can fix it.",
        { next: "/rdlc-setup-connector", details: [{ error: error.message }] });
    }
  }
};

/**
 * Run the named sensors (default: all) against a project. Returns results
 * plus a one-paragraph plain-language summary.
 */
export async function runSensors(projectRoot, { names = Object.keys(SENSORS) } = {}) {
  const context = { projectRoot, artifacts: await loadArtifacts(projectRoot) };
  const results = [];
  for (const name of names) {
    const sensor = SENSORS[name];
    if (!sensor) {
      results.push(result(name, false, `Unknown check "${name}" — this is a configuration mistake, not a problem with your work.`, { next: "/rdlc-doctor" }));
      continue;
    }
    try {
      results.push(await sensor(context));
    } catch (error) {
      results.push(result(name, false, `The "${name}" check itself failed to run — your work is untouched.`, { next: "/rdlc-doctor", details: [{ error: error.message }] }));
    }
  }
  const problems = results.filter((entry) => !entry.ok);
  const summary = problems.length === 0
    ? "Everything checks out."
    : `${plural(problems.length, "thing")} need${problems.length === 1 ? "s" : ""} attention: ${problems.map((entry) => entry.headline.split(" — ")[0]).join("; ")}.`;
  return { results, summary, ok: problems.length === 0 };
}
