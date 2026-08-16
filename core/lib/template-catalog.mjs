/**
 * Per-artifact-type template catalog (spec §18.2, §18.3, §20.2, §24.1).
 *
 * The authored framework pack declares the expected content elements for
 * requirement types and every hierarchy level. Organization/portfolio/
 * space/project/engagement overlay packs resolve through the §18.3
 * precedence chain — locked framework controls cannot be weakened.
 *
 * The same resolved templates drive connector validation (§20.1): a
 * versioned provider field mapping projects an external item onto template
 * fields, so a Jira issue can be checked for the required details, and an
 * externally updated item that breaks its format yields RDLC-FMT findings.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TemplateError, resolveTemplate, validateAgainstTemplate } from "./templates.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Load the authored framework pack (plus optional overlay packs). */
export async function loadCatalog({ overlays = [] } = {}) {
  const framework = JSON.parse(await readFile(join(packageRoot, "core", "templates", "framework.json"), "utf8"));
  for (const overlay of overlays) {
    if (!overlay.level || !overlay.version || !overlay.artifact_types) {
      throw new TemplateError("an overlay pack requires level, version, and artifact_types (§18.3)");
    }
  }
  return new TemplateCatalog([framework, ...overlays]);
}

export class TemplateCatalog {
  #packs;
  #resolved = new Map();

  constructor(packs) {
    // Clone + freeze so later mutation of caller-held pack objects can never
    // bypass resolution-time lock validation (review finding).
    this.#packs = deepFreeze(structuredClone(packs));
  }

  types() {
    return Object.keys(this.#packs[0].artifact_types);
  }

  /** Resolve one artifact type through the pack chain (§18.3). */
  resolve(type) {
    if (this.#resolved.has(type)) return this.#resolved.get(type);
    const relevant = this.#packs
      .filter((pack) => pack.artifact_types[type])
      .map((pack) => ({ level: pack.level, version: pack.version, fields: pack.artifact_types[type].fields }));
    if (relevant.length === 0) throw new TemplateError(`no template is defined for artifact type: ${type}`);
    // Deep-freeze the memoized result: a consumer mutating a returned
    // template must throw, never silently poison the cache (review finding).
    const resolved = deepFreeze(structuredClone(resolveTemplate(relevant.map((pack) => structuredClone(pack)))));
    this.#resolved.set(type, resolved);
    return resolved;
  }

  /** Validate an artifact against its type's resolved template (§24.1). */
  validateArtifact(artifact) {
    const type = artifact?.type;
    if (!type) return ["artifact has no type; no template can be resolved"];
    return validateAgainstTemplate(artifact, this.resolve(type));
  }

  /** A promotion-gate template validator (§35.3 step 3). */
  promotionValidator() {
    return (working) => this.validateArtifact(working);
  }

  /**
   * §20.1 — validate that a provider item carries the required details.
   * `mapping` is versioned: { version, artifact_type, fields: {templateField:
   * providerField|path} }. Missing mapped values produce explainable
   * findings naming BOTH sides (§7.7).
   */
  validateProviderItem(snapshot, mapping) {
    if (!mapping?.version || !mapping.artifact_type || !mapping.fields) {
      throw new TemplateError("a versioned provider field mapping is required (§20.1)");
    }
    if (!snapshot || typeof snapshot !== "object") {
      throw new TemplateError("a provider snapshot is required (§20.1)");
    }
    const resolved = this.resolve(mapping.artifact_type);
    const projected = { type: mapping.artifact_type };
    for (const [templateField, providerPath] of Object.entries(mapping.fields)) {
      const fields = snapshot.fields ?? {};
      // Literal field names win (ADO's System.Title contains dots); dotted
      // traversal applies only when no literal key exists.
      projected[templateField] = Object.hasOwn(fields, providerPath)
        ? fields[providerPath]
        : providerPath.split(".").reduce(
            (value, key) => (value === undefined || value === null ? undefined : value[key]),
            fields
          );
    }
    const failures = validateAgainstTemplate(projected, resolved);
    const findings = failures.map((failure) => {
      const field =
        failure.match(/missing: ([a-z0-9_-]+)/)?.[1]
        ?? failure.match(/^field ([a-z0-9_-]+)/)?.[1]
        ?? failure.match(/allowed_values for ([a-z0-9_-]+)/)?.[1]
        ?? null;
      return {
        rule: "RDLC-FMT-001",
        severity: "warning",
        item: snapshot.item_id,
        revision: snapshot.revision ?? null,
        template: `${mapping.artifact_type}@${resolved.provenance?.[field]?.version ?? "framework/v1"}`,
        template_field: field,
        provider_field: field ? mapping.fields[field] ?? null : null,
        mapping_version: mapping.version,
        message: failure
      };
    });
    // Unmapped required fields cannot be carried by the tracker at all —
    // that is a mapping gap, reported distinctly (§20.1).
    for (const [name, definition] of Object.entries(resolved.fields)) {
      if (definition.required && !(name in mapping.fields)) {
        findings.push({
          rule: "RDLC-FMT-002",
          severity: "warning",
          item: snapshot.item_id,
          revision: snapshot.revision ?? null,
          template_field: name,
          provider_field: null,
          mapping_version: mapping.version,
          message: `required field "${name}" has no provider mapping; the tracker cannot carry it (§20.1)`
        });
      }
    }
    return { valid: findings.length === 0, findings };
  }

  /**
   * §26/§29.6/§42 — format drift for externally updated items: given polled
   * changes and their pulled snapshots, report every item whose current
   * provider content no longer satisfies its template. Findings are review
   * inputs; nothing is auto-repaired.
   */
  detectFormatDrift(updatedSnapshots, mapping) {
    const drifted = [];
    for (const snapshot of updatedSnapshots) {
      const { valid, findings } = this.validateProviderItem(snapshot, mapping);
      if (!valid) {
        drifted.push({
          item: snapshot.item_id,
          revision: snapshot.revision ?? null,
          rule: "RDLC-FMT-003",
          severity: "warning",
          message: `externally updated item no longer follows the ${mapping.artifact_type} template (${findings.length} violations)`,
          violations: findings.filter((finding) => finding.rule === "RDLC-FMT-001"),
          disposition_options: ["create-change-request", "propose-corrective-changeset", "request-clarification", "accept-with-waiver"]
        });
      }
    }
    return drifted;
  }
}
