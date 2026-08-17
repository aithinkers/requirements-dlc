/**
 * Knowledge-Grounded consumer contract (spec §10, §17).
 *
 * R-DLC consumes K-DLC knowledge through the K-DLC mount model rather than a
 * second incompatible one: `knowledge-project.yaml` declares the mounts,
 * `knowledge.lock` pins the exact concept revisions an engagement was
 * grounded against, `kb://<kb-id>/<concept-id>` references resolve against
 * mounted retrieval catalogs, and catalog drift after locking produces
 * impact-review candidates — never silent rewrites of approved artifacts
 * (§17 items 1-8). Every resolution fails closed (§7.2).
 */

import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { canonicalBytes, normalizeTimestamp, parseStrict } from "./canonical.mjs";
import { mintIdentity } from "./identity.mjs";

export const KNOWLEDGE_LOCK_SCHEMA = "rdlc.knowledge-lock/v0.2";
const CATALOG_VERSION = "kdlc-retrieval-catalog-1";
const KB_REFERENCE_PATTERN = /^kb:\/\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(\S+)$/;

export class KnowledgeError extends Error {
  constructor(message, code = "RDLC_KB_INVALID") {
    super(message);
    this.name = "KnowledgeError";
    this.code = code;
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Confine a manifest-declared path to the project root (§7.2 fail closed). */
function confinedPath(projectRoot, declared, subject) {
  if (typeof declared !== "string" || declared.length === 0) {
    throw new KnowledgeError(`${subject} must be a project-relative path`);
  }
  const absolute = resolve(projectRoot, declared);
  const relativePart = relative(resolve(projectRoot), absolute);
  if (isAbsolute(declared) || relativePart.startsWith("..") || isAbsolute(relativePart)) {
    throw new KnowledgeError(`${subject} escapes the project root: ${declared}`, "RDLC_KB_PATH");
  }
  return absolute;
}

/** Parse a stable `kb://<kb-id>/<concept-id>` reference (§17 item 3). */
export function parseKbReference(reference) {
  const match = typeof reference === "string" ? reference.match(KB_REFERENCE_PATTERN) : null;
  if (!match) throw new KnowledgeError(`not a kb:// reference: ${reference}`);
  return Object.freeze({ knowledge_base: match[1], concept_id: match[2] });
}

/** True when a source or evidence string is a kb:// reference. */
export function isKbReference(reference) {
  return typeof reference === "string" && KB_REFERENCE_PATTERN.test(reference);
}

/**
 * Load the K-DLC project manifest and return the mount table (§17 item 1-2).
 * The manifest is K-DLC's own `knowledge-project.yaml`; only what the
 * consumer contract needs is read, and unknown structure is left alone.
 */
/**
 * Locate an out-of-root mount's K-DLC verified materialization (§17 items 1-2).
 * Raw external paths are never read: the mount must be pinned in K-DLC's own
 * `knowledge.lock` and present in the `.kdlc/mounts` cache with a
 * `knowledge-base.yaml` whose bytes match the lock's manifest_hash. Anything
 * less fails closed — the live external folder is not a fallback.
 */
async function materializedMount(projectRoot, name) {
  let lock;
  try {
    lock = JSON.parse(await readFile(resolve(projectRoot, "knowledge.lock"), "utf8"));
  } catch {
    throw new KnowledgeError(`external mount ${name} needs K-DLC's knowledge.lock; run a kdlc retrieval (or refresh) to materialize it`, "RDLC_KB_UNMATERIALIZED");
  }
  const pinned = lock?.knowledge_bases?.[name];
  if (typeof pinned?.manifest_hash !== "string" || typeof pinned?.resolved_ref !== "string") {
    throw new KnowledgeError(`external mount ${name} is not pinned in knowledge.lock`, "RDLC_KB_UNMATERIALIZED");
  }
  const cacheRoot = resolve(projectRoot, ".kdlc/mounts");
  let entries;
  try {
    entries = (await readdir(cacheRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  } catch {
    throw new KnowledgeError(`external mount ${name} has no materialized cache under .kdlc/mounts`, "RDLC_KB_UNMATERIALIZED");
  }
  // The catalog beside a hash-matched manifest is trusted: an in-project
  // writer who could forge it could equally rewrite knowledge.lock itself,
  // so the boundary is the working tree — rdlc's own lock re-pins every
  // concept byte_hash at lock time. Sorted so same-manifest duplicates
  // resolve deterministically across filesystems.
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const directory = join(cacheRoot, entry.name);
    let bytes;
    try {
      bytes = await readFile(join(directory, "knowledge-base.yaml"));
    } catch {
      continue;
    }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest === pinned.manifest_hash) return { directory, resolved_ref: pinned.resolved_ref };
  }
  throw new KnowledgeError(`external mount ${name} matches no verified materialization (manifest hash ${pinned.manifest_hash})`, "RDLC_KB_UNMATERIALIZED");
}

function isExternalUri(projectRoot, uri) {
  if (typeof uri !== "string" || uri.length === 0) return false;
  if (uri.startsWith("git+")) return true;
  if (isAbsolute(uri)) return true;
  const relativePart = relative(resolve(projectRoot), resolve(projectRoot, uri));
  return relativePart.startsWith("..") || isAbsolute(relativePart);
}

export async function loadKnowledgeProject(projectRoot, manifestPath = "knowledge-project.yaml") {
  const absolute = confinedPath(projectRoot, manifestPath, "knowledge manifest");
  let text;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    throw new KnowledgeError(`knowledge manifest is unavailable: ${manifestPath}`, "RDLC_KB_MANIFEST");
  }
  const manifest = parseStrict(text);
  if (manifest?.kind !== "Project" || !Array.isArray(manifest.knowledge_bases) || manifest.knowledge_bases.length === 0) {
    throw new KnowledgeError("knowledge manifest must be a K-DLC Project with knowledge_bases", "RDLC_KB_MANIFEST");
  }
  const mounts = [];
  for (const mount of manifest.knowledge_bases) {
    if (typeof mount?.name !== "string" || mount.name.length === 0) {
      throw new KnowledgeError("every knowledge base mount requires a name", "RDLC_KB_MANIFEST");
    }
    if (isExternalUri(projectRoot, mount.uri)) {
      const materialized = await materializedMount(projectRoot, mount.name);
      mounts.push({
        name: mount.name,
        uri: mount.uri,
        mode: mount.mode ?? "consume",
        role: mount.role ?? "dependency",
        directory: materialized.directory,
        resolved_ref: materialized.resolved_ref
      });
      continue;
    }
    mounts.push({
      name: mount.name,
      uri: mount.uri,
      mode: mount.mode ?? "consume",
      role: mount.role ?? "dependency",
      directory: confinedPath(projectRoot, mount.uri, `mount ${mount.name}`)
    });
  }
  // A symlinked mount must not smuggle in a directory outside the project:
  // confine the real path too, not just the lexical one (§7.2).
  const realRoot = await realpath(resolve(projectRoot));
  for (const mount of mounts) {
    let real;
    try {
      real = await realpath(mount.directory);
    } catch {
      continue; // absent mounts fail later, at catalog read, with RDLC_KB_CATALOG
    }
    const relativePart = relative(realRoot, real);
    if (relativePart.startsWith("..") || isAbsolute(relativePart)) {
      throw new KnowledgeError(`mount ${mount.name} resolves outside the project root`, "RDLC_KB_PATH");
    }
  }
  for (const mount of mounts) Object.freeze(mount);
  const names = new Set(mounts.map(({ name }) => name));
  if (names.size !== mounts.length) throw new KnowledgeError("mount names must be unique", "RDLC_KB_MANIFEST");
  return deepFreeze({ manifest_path: manifestPath, mounts });
}

/** Read one mount's retrieval catalog, failing closed on shape drift. */
export async function readCatalog(mount) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(join(mount.directory, "retrieval-catalog.json"), "utf8"));
  } catch {
    throw new KnowledgeError(`mount ${mount.name} has no readable retrieval catalog`, "RDLC_KB_CATALOG");
  }
  if (parsed?.version !== CATALOG_VERSION || !Array.isArray(parsed.concepts)) {
    throw new KnowledgeError(`mount ${mount.name} catalog is not ${CATALOG_VERSION}`, "RDLC_KB_CATALOG");
  }
  const seen = new Set();
  for (const concept of parsed.concepts) {
    if (typeof concept?.id !== "string" || typeof concept?.byte_hash !== "string") {
      throw new KnowledgeError(`mount ${mount.name} catalog entry is missing id or byte_hash`, "RDLC_KB_CATALOG");
    }
    if (seen.has(concept.id)) {
      throw new KnowledgeError(`mount ${mount.name} catalog declares ${concept.id} twice`, "RDLC_KB_CATALOG");
    }
    seen.add(concept.id);
  }
  return parsed;
}

/**
 * Resolve a kb:// reference against the mounted catalogs (§17 items 3, 5).
 * When `allowedClassifications` is provided, resolution is access-checked and
 * fails closed on a concept outside the principal's clearance.
 */
export async function resolveKbReference(project, reference, { allowedClassifications = null } = {}) {
  const { knowledge_base: kbName, concept_id: conceptId } = parseKbReference(reference);
  const mount = project.mounts.find(({ name }) => name === kbName);
  if (!mount) throw new KnowledgeError(`no mount named ${kbName} for ${reference}`, "RDLC_KB_UNMOUNTED");
  const catalog = await readCatalog(mount);
  const concept = catalog.concepts.find(({ id }) => id === conceptId);
  if (!concept) throw new KnowledgeError(`concept ${conceptId} is not published in ${kbName}`, "RDLC_KB_UNRESOLVED");
  const classification = concept.access?.classification ?? "internal";
  if (Array.isArray(allowedClassifications) && !allowedClassifications.includes(classification)) {
    throw new KnowledgeError(`principal may not access ${reference} (${classification})`, "RDLC_KB_ACCESS");
  }
  return deepFreeze({
    reference,
    knowledge_base: kbName,
    concept_id: conceptId,
    // The catalog is external, untrusted content: its declared path must
    // stay inside the mount (§7.2 fail closed).
    path: confinedPath(mount.directory, concept.path ?? `${conceptId}.md`, `catalog path for ${reference}`),
    byte_hash: concept.byte_hash,
    access: { classification }
  });
}

function lockDigest(lock) {
  const { lock_digest: _ignored, ...projection } = lock;
  return `sha256:${createHash("sha256").update(canonicalBytes(projection)).digest("hex")}`;
}

/**
 * Pin every mounted concept revision into a deterministic lock (§17 items 1, 4).
 * `lockedAt` must be supplied by the caller's audited clock — the lock itself
 * introduces no ambient time so identical knowledge yields identical digests
 * apart from the declared instant.
 */
export async function createKnowledgeLock(project, { lockedAt }) {
  const mounts = [];
  for (const mount of project.mounts) {
    const catalog = await readCatalog(mount);
    mounts.push({
      name: mount.name,
      mode: mount.mode,
      ...(mount.resolved_ref ? { resolved_ref: mount.resolved_ref } : {}),
      concepts: [...catalog.concepts]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((concept) => ({
          id: concept.id,
          byte_hash: concept.byte_hash,
          access: { classification: concept.access?.classification ?? "internal" }
        }))
    });
  }
  const lock = {
    schema_version: KNOWLEDGE_LOCK_SCHEMA,
    manifest_path: project.manifest_path,
    locked_at: normalizeTimestamp(lockedAt),
    mounts
  };
  return deepFreeze({ ...lock, lock_digest: lockDigest(lock) });
}

/** Recompute and check the digest, failing closed on any tampering. */
export function verifyKnowledgeLock(lock) {
  if (lock?.schema_version !== KNOWLEDGE_LOCK_SCHEMA || typeof lock.lock_digest !== "string") {
    throw new KnowledgeError("not a knowledge lock", "RDLC_KB_LOCK");
  }
  if (lockDigest(lock) !== lock.lock_digest) {
    throw new KnowledgeError("knowledge lock digest does not match its content", "RDLC_KB_LOCK");
  }
  return true;
}

/**
 * Compare the lock against the mounted catalogs now (§17 item 7). Returns the
 * drift as explicit changes; an empty list means the grounding still holds.
 */
export async function diffKnowledgeLock(project, lock) {
  verifyKnowledgeLock(lock);
  const changes = [];
  for (const locked of lock.mounts) {
    const mount = project.mounts.find(({ name }) => name === locked.name);
    if (!mount) {
      for (const concept of locked.concepts) {
        changes.push({ knowledge_base: locked.name, concept_id: concept.id, kind: "removed", locked_hash: concept.byte_hash });
      }
      continue;
    }
    const current = new Map((await readCatalog(mount)).concepts.map((concept) => [concept.id, concept]));
    for (const concept of locked.concepts) {
      const now = current.get(concept.id);
      if (!now) {
        changes.push({ knowledge_base: locked.name, concept_id: concept.id, kind: "removed", locked_hash: concept.byte_hash });
      } else if (now.byte_hash !== concept.byte_hash) {
        changes.push({ knowledge_base: locked.name, concept_id: concept.id, kind: "changed", locked_hash: concept.byte_hash, current_hash: now.byte_hash });
      }
      current.delete(concept.id);
    }
    for (const [id] of current) {
      changes.push({ knowledge_base: locked.name, concept_id: id, kind: "added" });
    }
  }
  return deepFreeze(changes);
}

/**
 * Turn knowledge drift into impact-review candidates for the artifacts that
 * cite the moved concepts (§17 items 7-8). Returns rdlc.finding/v0.2 records
 * with status "open"; the cited artifacts are never touched — a human resolves
 * each candidate through the normal review flow.
 */
export function knowledgeImpact({ changes, artifacts, now }) {
  const byReference = new Map();
  for (const change of changes) {
    if (change.kind === "added") continue;
    byReference.set(`kb://${change.knowledge_base}/${change.concept_id}`, change);
  }
  const candidates = [];
  for (const artifact of artifacts) {
    const cited = [...new Set([...(artifact.sources ?? []), ...(artifact.evidence ?? [])])].filter(isKbReference);
    for (const reference of cited) {
      const change = byReference.get(reference);
      if (!change) continue;
      candidates.push(deepFreeze({
        schema_version: "rdlc.finding/v0.2",
        id: mintIdentity(now),
        rule: change.kind === "removed" ? "RDLC-KB-002" : "RDLC-KB-001",
        severity: change.kind === "removed" ? "blocking" : "warning",
        artifact: artifact.id,
        ...(artifact.display_id ? { artifact_display_id: artifact.display_id } : {}),
        message: change.kind === "removed"
          ? `grounding evidence ${reference} is no longer published; the artifact's basis must be re-established`
          : `grounding evidence ${reference} changed since the knowledge lock (locked ${change.locked_hash}, now ${change.current_hash}); re-review the artifact against the current concept`,
        evidence: [reference],
        suggested_action: "review the cited concept and resolve, accept, challenge, or waive this candidate",
        status: "open"
      }));
    }
  }
  return deepFreeze(candidates);
}
