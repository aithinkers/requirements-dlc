/**
 * Connector configuration loader (spec §11.1, §20.1, §22.2, §29).
 *
 * Reads `requirements-project.yaml` and each declared connector's versioned
 * mapping file (`rdlc.connector-mapping/v0.2`) and yields ready-to-use
 * objects: the JiraConnector field mapping, the estimation profile binding,
 * the component binding, and per-artifact-type template mappings for
 * TemplateCatalog.validateProviderItem / detectFormatDrift.
 *
 * Fails closed on every inconsistency (§7.2): unknown schemes, estimation or
 * template fields absent from the mapped field list, duplicate issue types,
 * unknown artifact types.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import YAML from "yaml";

import { SCHEMES, createProfile } from "./estimation.mjs";

export class ConnectorConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectorConfigError";
  }
}

const WRITE_MODES = ["read-only", "propose", "approve-each-batch", "approved-automation"];

/** Validate one mapping document (already parsed). */
export function validateMapping(mapping, { catalogTypes = null } = {}) {
  const failures = [];
  if (mapping?.schema_version !== "rdlc.connector-mapping/v0.2") {
    failures.push(`unknown mapping schema_version: ${mapping?.schema_version}`);
    return failures;
  }
  for (const field of ["version", "provider", "project_key"]) {
    if (!mapping[field]) failures.push(`mapping requires ${field}`);
  }
  if (!Array.isArray(mapping.fields) || mapping.fields.length === 0) {
    failures.push("mapping requires a non-empty fields list (§29)");
  }
  const fieldSet = new Set(mapping.fields ?? []);

  const estimation = mapping.estimation;
  if (estimation) {
    if (!SCHEMES.includes(estimation.scheme)) failures.push(`unknown estimation scheme: ${estimation.scheme} (§22.1)`);
    if (!estimation.provider_field) failures.push("estimation requires provider_field (§22.2 item 11)");
    else if (!fieldSet.has(estimation.provider_field)) {
      failures.push(`estimation provider_field "${estimation.provider_field}" is not in the mapped fields list`);
    }
    if (!estimation.profile) failures.push("estimation requires the profile id it binds (§22.2)");
    if (estimation.scheme !== "no-estimate" && (!Array.isArray(estimation.allowed_values) || estimation.allowed_values.length === 0)) {
      failures.push("estimation requires allowed_values (§22.2 item 2)");
    }
  }

  if (mapping.components) {
    if (!mapping.components.provider_field) failures.push("components binding requires provider_field");
    else if (!fieldSet.has(mapping.components.provider_field)) {
      failures.push(`components provider_field "${mapping.components.provider_field}" is not in the mapped fields list`);
    }
    if (!["name", "id"].includes(mapping.components.match_by ?? "name")) {
      failures.push(`components match_by must be name or id, not ${mapping.components.match_by}`);
    }
  }

  const issueTypes = new Set();
  for (const [artifactType, binding] of Object.entries(mapping.artifact_types ?? {})) {
    if (catalogTypes && !catalogTypes.includes(artifactType)) {
      failures.push(`artifact type "${artifactType}" has no template in the catalog (§20.1)`);
    }
    if (!binding.issue_type) failures.push(`artifact type "${artifactType}" requires its provider issue_type (§20.1)`);
    else if (issueTypes.has(binding.issue_type)) {
      failures.push(`issue type "${binding.issue_type}" is bound to more than one artifact type`);
    } else {
      issueTypes.add(binding.issue_type);
    }
    for (const [templateField, providerField] of Object.entries(binding.template_fields ?? {})) {
      const head = String(providerField).split(".")[0];
      if (!fieldSet.has(head)) {
        failures.push(`artifact type "${artifactType}": template field "${templateField}" maps to "${providerField}", which is not in the mapped fields list`);
      }
    }
  }
  return failures;
}

/**
 * Load the project's connector configuration. Returns one entry per declared
 * connector: { id, provider, write_mode, connectorMapping, estimation,
 * components, templateMappings }.
 */
export async function loadConnectorConfig(projectRoot, { catalogTypes = null, confirmers = [] } = {}) {
  let manifest;
  try {
    manifest = YAML.parse(await readFile(join(projectRoot, "requirements-project.yaml"), "utf8"));
  } catch (error) {
    throw new ConnectorConfigError(`requirements-project.yaml cannot be read: ${error.message}`);
  }
  const declared = manifest?.connectors ?? [];
  const results = [];
  const seenIds = new Set();
  for (const connector of declared) {
    for (const field of ["id", "provider", "mapping", "write_mode"]) {
      if (!connector[field]) throw new ConnectorConfigError(`connector declaration requires ${field} (§11.1)`);
    }
    if (!WRITE_MODES.includes(connector.write_mode)) {
      throw new ConnectorConfigError(`unknown write mode for ${connector.id}: ${connector.write_mode} (§29.2)`);
    }
    if (seenIds.has(connector.id)) throw new ConnectorConfigError(`duplicate connector id: ${connector.id}`);
    seenIds.add(connector.id);
    // Mapping paths are confined to the project root (§7.2 fail closed);
    // foreign file content is never echoed into errors.
    const mappingPath = resolve(projectRoot, connector.mapping);
    const confined = relative(resolve(projectRoot), mappingPath);
    if (isAbsolute(connector.mapping) || confined.startsWith("..") || isAbsolute(confined)) {
      throw new ConnectorConfigError(`mapping path for ${connector.id} escapes the project root: ${connector.mapping}`);
    }
    let raw;
    try {
      raw = await readFile(mappingPath, "utf8");
    } catch {
      throw new ConnectorConfigError(`mapping file for ${connector.id} cannot be read: ${connector.mapping}`);
    }
    let mapping;
    try {
      mapping = YAML.parse(raw);
    } catch {
      throw new ConnectorConfigError(`mapping file for ${connector.id} is not valid YAML: ${connector.mapping}`);
    }
    const failures = validateMapping(mapping, { catalogTypes });
    if (failures.length > 0) {
      throw new ConnectorConfigError(`mapping ${connector.mapping} is invalid:\n  - ${failures.join("\n  - ")}`);
    }
    if (mapping.provider !== connector.provider) {
      throw new ConnectorConfigError(`mapping provider "${mapping.provider}" does not match connector "${connector.provider}"`);
    }

    // Ready-to-use JiraConnector mapping (§29/§30).
    const connectorMapping = { version: mapping.version, projectKey: mapping.project_key, fields: [...mapping.fields] };

    // Ready-to-use estimation profile (§22): confirmation stays with the
    // configured confirmers; AI values remain suggestions.
    let estimation = null;
    if (mapping.estimation) {
      try {
        estimation = {
          provider_field: mapping.estimation.provider_field,
          profile: createProfile({
            id: mapping.estimation.profile,
            scheme: mapping.estimation.scheme,
            allowedValues: mapping.estimation.allowed_values ?? null,
            meaning: mapping.estimation.meaning ?? "as configured by the team (§22.2 item 3)",
            aiSuggestionsAllowed: mapping.estimation.allow_ai_suggestions ?? true,
            confirmers: (mapping.estimation.confirmers?.length ? mapping.estimation.confirmers : confirmers)
          })
        };
      } catch (error) {
        throw new ConnectorConfigError(`connector ${connector.id} (${connector.mapping}): estimation configuration invalid: ${error.message}`);
      }
    }

    // Per-artifact-type template mappings for validateProviderItem/drift (§20.1).
    const templateMappings = Object.fromEntries(
      Object.entries(mapping.artifact_types ?? {}).map(([artifactType, binding]) => [
        artifactType,
        {
          version: `${mapping.version}/${artifactType}`,
          artifact_type: artifactType,
          issue_type: binding.issue_type,
          fields: { ...(binding.template_fields ?? {}) }
        }
      ])
    );

    results.push({
      id: connector.id,
      provider: connector.provider,
      write_mode: connector.write_mode,
      connectorMapping,
      estimation,
      components: mapping.components ? { ...mapping.components } : null,
      templateMappings
    });
  }
  return results;
}
