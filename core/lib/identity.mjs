/**
 * UUIDv7 canonical identities and display-alias allocation (spec §12.1, §12.2).
 *
 * Any offline writer may mint a UUIDv7 without coordination; sequential
 * display aliases are allocated by a lease-protected alias authority whose
 * storage backend must provide atomic compare-and-swap (ADR-001 item 7).
 * A UUIDv7's timestamp bits are never trusted chronology (§12.1, §12.6).
 */

import { randomBytes } from "node:crypto";

export class IdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = "IdentityError";
  }
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const URN_PREFIX = "urn:uuid:";

/**
 * Generate an RFC 9562 UUIDv7: 48-bit Unix-millisecond timestamp,
 * version 7, RFC 4122 variant, 74 random bits (vendored per ADR-001 item 5).
 */
export function uuidv7(now = Date.now()) {
  if (!Number.isInteger(now) || now < 0 || now > 2 ** 48 - 1) {
    throw new IdentityError(`timestamp out of the UUIDv7 range: ${now}`);
  }
  const bytes = randomBytes(16);
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidv7(value) {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

/** Mint a canonical UUID URN identity (§12.1). */
export function mintIdentity(now) {
  return `${URN_PREFIX}${uuidv7(now)}`;
}

export function isCanonicalIdentity(value) {
  return typeof value === "string" && value.startsWith(URN_PREFIX) && isUuidv7(value.slice(URN_PREFIX.length));
}

export function parseUrn(urn) {
  if (!isCanonicalIdentity(urn)) throw new IdentityError(`not a canonical UUIDv7 URN: ${urn}`);
  return urn.slice(URN_PREFIX.length);
}

/**
 * Extract the embedded millisecond timestamp. Named to make the trust
 * boundary explicit: this value is producer-asserted wall clock and MUST NOT
 * be used for causal ordering, approval time, or lease decisions (§12.6).
 */
export function untrustedTimestampMs(urn) {
  const uuid = parseUrn(urn);
  return Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

/**
 * In-memory compare-and-swap backend. Production deployments use a
 * distributed authority (GitHub API ref CAS per ADR-001 item 7); this
 * backend provides the same atomic contract for tests and single-process use.
 */
export class InMemoryCasBackend {
  #state = null;
  #version = 0;

  async read() {
    return { state: this.#state, version: this.#version };
  }

  /** Atomically replace state only when the caller read the current version. */
  async compareAndSwap(expectedVersion, nextState) {
    if (expectedVersion !== this.#version) return false;
    this.#state = nextState;
    this.#version += 1;
    return true;
  }
}

const INITIAL_AUTHORITY_STATE = Object.freeze({ counters: {}, aliases: {}, history: [] });

/**
 * Lease-protected sequential alias authority (§12.2, §35.9).
 *
 * Aliases are display conveniences: allocation never changes a canonical
 * UUID, duplicate proposals are reconciled by retaining the first binding
 * and allocating the next sequential alias to the second artifact, and
 * released aliases are never recycled inside the retention window.
 */
export class AliasAuthority {
  #backend;
  #now;

  constructor(backend, { now = () => new Date().toISOString() } = {}) {
    this.#backend = backend ?? new InMemoryCasBackend();
    this.#now = now;
  }

  async #mutate(mutator) {
    for (let attempt = 0; attempt < 5000; attempt += 1) {
      const { state, version } = await this.#backend.read();
      const current = state ?? INITIAL_AUTHORITY_STATE;
      const next = structuredClone(current);
      const result = mutator(next);
      if (await this.#backend.compareAndSwap(version, next)) return result;
    }
    throw new IdentityError("alias authority contention: compare-and-swap retries exhausted");
  }

  static #assertPrefix(prefix) {
    if (typeof prefix !== "string" || !/^[A-Z][A-Z0-9]*(-[A-Z]+)?$/.test(prefix)) {
      throw new IdentityError(`invalid alias prefix: ${prefix}`);
    }
  }

  /** Allocate the next sequential alias for an artifact identity. */
  async allocate(prefix, artifactUrn) {
    AliasAuthority.#assertPrefix(prefix);
    if (!isCanonicalIdentity(artifactUrn)) throw new IdentityError(`not a canonical identity: ${artifactUrn}`);
    return this.#mutate((state) => {
      const existing = Object.entries(state.aliases).find(
        ([, binding]) => binding.artifact === artifactUrn && binding.prefix === prefix && binding.status === "active"
      );
      if (existing) return existing[0];
      const counter = (state.counters[prefix] ?? 0) + 1;
      state.counters[prefix] = counter;
      const alias = `${prefix}-${counter}`;
      state.aliases[alias] = { artifact: artifactUrn, prefix, status: "active", effective_at: this.#now() };
      state.history.push({ alias, artifact: artifactUrn, action: "allocated", at: this.#now() });
      return alias;
    });
  }

  /**
   * Reconcile branch-proposed aliases (§12.2): the first proposal for an
   * alias is retained; a competing proposal for the same alias keeps its
   * canonical UUID and receives the next sequential alias instead.
   */
  async reconcileProposal(proposedAlias, artifactUrn) {
    if (!isCanonicalIdentity(artifactUrn)) throw new IdentityError(`not a canonical identity: ${artifactUrn}`);
    const match = proposedAlias.match(/^([A-Z][A-Z0-9]*(?:-[A-Z]+)?)-(\d+)$/);
    if (!match) throw new IdentityError(`invalid proposed alias: ${proposedAlias}`);
    const [, prefix, number] = match;
    return this.#mutate((state) => {
      const binding = state.aliases[proposedAlias];
      if (binding && binding.artifact !== artifactUrn) {
        const counter = Math.max(state.counters[prefix] ?? 0, Number(number)) + 1;
        state.counters[prefix] = counter;
        const alias = `${prefix}-${counter}`;
        state.aliases[alias] = { artifact: artifactUrn, prefix, status: "active", effective_at: this.#now() };
        state.history.push({ alias, artifact: artifactUrn, action: "reassigned-after-collision", proposed: proposedAlias, at: this.#now() });
        return { alias, collided: true };
      }
      if (!binding) {
        state.counters[prefix] = Math.max(state.counters[prefix] ?? 0, Number(number));
        state.aliases[proposedAlias] = { artifact: artifactUrn, prefix, status: "active", effective_at: this.#now() };
        state.history.push({ alias: proposedAlias, artifact: artifactUrn, action: "allocated", at: this.#now() });
      }
      return { alias: proposedAlias, collided: false };
    });
  }

  /** Retire an alias when a new one supersedes it; history keeps both (§12.2). */
  async supersede(alias, replacementAlias, artifactUrn) {
    if (typeof replacementAlias !== "string" || !/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-?\d*$/.test(replacementAlias) || replacementAlias === alias) {
      throw new IdentityError(`invalid replacement alias: ${replacementAlias}`);
    }
    return this.#mutate((state) => {
      const binding = state.aliases[alias];
      if (!binding || binding.artifact !== artifactUrn) {
        throw new IdentityError(`alias is not bound to the artifact: ${alias}`);
      }
      if (binding.status !== "active") {
        throw new IdentityError(`alias is not active and cannot be superseded: ${alias}`);
      }
      if (state.aliases[replacementAlias]) {
        throw new IdentityError(`replacement alias is already bound: ${replacementAlias}`);
      }
      const numeric = replacementAlias.match(/^([A-Z][A-Z0-9]*(?:-[A-Z]+)?)-(\d+)$/);
      if (numeric) {
        // Reserve numeric replacements against the sequential counter so a
        // later allocation can never recycle this alias (§12.2).
        state.counters[numeric[1]] = Math.max(state.counters[numeric[1]] ?? 0, Number(numeric[2]));
      }
      binding.status = "superseded";
      binding.superseded_by = replacementAlias;
      state.aliases[replacementAlias] = {
        artifact: artifactUrn, prefix: binding.prefix, status: "active",
        effective_at: this.#now(), previous: alias
      };
      state.history.push({ alias: replacementAlias, previous: alias, artifact: artifactUrn, action: "superseded", at: this.#now() });
      return replacementAlias;
    });
  }

  /**
   * Resolve an alias (current or historical) to its canonical UUID URN;
   * ambiguous or recycled aliases fail closed (§12.2).
   */
  async resolve(alias) {
    const { state } = await this.#backend.read();
    const current = state ?? INITIAL_AUTHORITY_STATE;
    const binding = current.aliases[alias];
    if (!binding) throw new IdentityError(`unknown alias: ${alias}`);
    const boundArtifacts = new Set(
      current.history.filter((entry) => entry.alias === alias).map((entry) => entry.artifact)
    );
    if (boundArtifacts.size > 1) throw new IdentityError(`ambiguous or recycled alias: ${alias}`);
    return { id: binding.artifact, status: binding.status };
  }

  /** Full audit history for an alias or artifact. */
  async history({ alias, artifact } = {}) {
    const { state } = await this.#backend.read();
    const current = state ?? INITIAL_AUTHORITY_STATE;
    return current.history.filter(
      (entry) => (alias === undefined || entry.alias === alias) && (artifact === undefined || entry.artifact === artifact)
    );
  }
}
