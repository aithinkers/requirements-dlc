/**
 * Template resolution and inheritance (spec §18.3).
 *
 * Precedence: framework defaults < organization < portfolio < space/team <
 * project < engagement override. A lower level may extend or tighten
 * inherited rules; it MUST NOT weaken a locked control.
 */

export class TemplateError extends Error {
  constructor(message) {
    super(message);
    this.name = "TemplateError";
  }
}

export const PACK_ORDER = Object.freeze(["framework", "organization", "portfolio", "space", "project", "engagement"]);

/**
 * Resolve one artifact-type template across ordered packs. Each pack entry:
 * { level, fields: {name: {required?, allowed_values?, locked?}},
 *   rules: {name: {…, locked?}} }. Locked entries record their source level
 * and version; later levels may not remove or relax them (§18.3, §39).
 */
export function resolveTemplate(packs) {
  const ordered = [...packs].sort((a, b) => PACK_ORDER.indexOf(a.level) - PACK_ORDER.indexOf(b.level));
  for (const pack of ordered) {
    if (!PACK_ORDER.includes(pack.level)) throw new TemplateError(`unknown pack level: ${pack.level}`);
    if (!pack.version) throw new TemplateError(`pack at level ${pack.level} requires a version (§39)`);
  }
  const fields = {};
  const provenance = {};
  for (const pack of ordered) {
    for (const [name, definition] of Object.entries(pack.fields ?? {})) {
      const existing = fields[name];
      if (existing?.locked) {
        const weakens =
          (existing.required && definition.required === false) ||
          (existing.allowed_values && definition.allowed_values &&
            !definition.allowed_values.every((value) => existing.allowed_values.includes(value)));
        if (weakens || definition.locked === false) {
          throw new TemplateError(
            `pack ${pack.level}@${pack.version} attempts to weaken locked field "${name}" from ${provenance[name].level}@${provenance[name].version} (§18.3)`
          );
        }
        // Tightening a locked field is permitted; the lock is preserved.
        fields[name] = { ...existing, ...definition, locked: true };
      } else {
        fields[name] = { ...existing, ...definition };
        provenance[name] = { level: pack.level, version: pack.version };
      }
      if (fields[name].locked) provenance[name] = provenance[name] ?? { level: pack.level, version: pack.version };
    }
  }
  return {
    fields,
    // §39 — the source and version of every active rule is exposed.
    provenance,
    locked: Object.fromEntries(Object.entries(fields).filter(([, definition]) => definition.locked).map(([name]) => [name, provenance[name]]))
  };
}

/** Validate an artifact against a resolved template (§24.1 template conformance). */
export function validateAgainstTemplate(artifact, resolved) {
  const failures = [];
  for (const [name, definition] of Object.entries(resolved.fields)) {
    const value = artifact[name];
    if (definition.required && (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
      failures.push(`required field missing: ${name}`);
    }
    if (definition.allowed_values && value !== undefined && value !== null && !definition.allowed_values.includes(value)) {
      failures.push(`field ${name} has a value outside its allowed set: ${value}`);
    }
  }
  return failures;
}
