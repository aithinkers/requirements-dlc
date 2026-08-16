import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const schemaDirectory = dirname(fileURLToPath(import.meta.url));

/** Map of schema_version values to their schema files (spec §12). */
export const schemaFiles = Object.freeze({
  "rdlc.artifact/v0.2": "artifact.schema.json",
  "rdlc.source-snapshot/v0.2": "source-snapshot.schema.json",
  "rdlc.principal/v0.2": "principal.schema.json",
  "rdlc.finding/v0.2": "finding.schema.json",
  "rdlc.work-claim/v0.2": "work-claim.schema.json",
  "rdlc.lease/v0.2": "lease.schema.json",
  "rdlc.changeset/v0.2": "changeset.schema.json",
  "rdlc.project/v0.2": "project.schema.json"
});

async function loadSchema(name) {
  return JSON.parse(await readFile(resolve(schemaDirectory, name), "utf8"));
}

/** Build one Ajv instance with the common definitions and every v0.2 schema registered. */
export async function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictSchema: false, strictRequired: false });
  ajv.addSchema(await loadSchema("common.schema.json"));
  for (const file of Object.values(schemaFiles)) ajv.addSchema(await loadSchema(file));
  return ajv;
}

/**
 * Validate a portable record by its declared schema_version.
 * Fails closed: an unknown or missing schema_version is a failure (spec §7.2, §43).
 */
export async function validateRecord(record, ajv) {
  const validator = ajv ?? await createValidator();
  const schemaVersion = record?.schema_version;
  const file = schemaFiles[schemaVersion];
  if (!file) return { valid: false, failures: [`unknown or missing schema_version: ${schemaVersion}`] };
  const validate = validator.getSchema(`https://rdlc.dev/schemas/v0.2/${file}`);
  if (!validate) return { valid: false, failures: [`schema not registered: ${file}`] };
  const valid = validate(record);
  return {
    valid,
    failures: valid ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`)
  };
}
