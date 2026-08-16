/**
 * Multi-BA collaboration: advisory work claims, mutation leases with fencing
 * tokens, optimistic concurrency with three-way comparison, and audited
 * collision dispositions (spec §35).
 */

import { canonicalBytes } from "./canonical.mjs";
import { InMemoryCasBackend, isCanonicalIdentity, mintIdentity } from "./identity.mjs";

/** Key-order-insensitive structural equality. */
function sameValue(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try {
    return canonicalBytes({ v: a }).equals(canonicalBytes({ v: b }));
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

export class CollaborationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CollaborationError";
  }
}

/* ------------------------------------------------------------ work claims */

/** §35.2 — claims are advisory, time-bounded, and never exclusive locks. */
export function createClaim({ actor, workstream, scope, intent, createdAt, expiresAt }) {
  if (!isCanonicalIdentity(actor)) throw new CollaborationError("a claim requires a canonical actor");
  if (!workstream) throw new CollaborationError("a claim requires a workstream");
  if (!intent) throw new CollaborationError("a claim requires an intent");
  const scopeEntries = Object.values(scope ?? {}).flat();
  if (scopeEntries.length === 0) throw new CollaborationError("a claim requires a non-empty scope");
  if (!createdAt || !expiresAt || expiresAt <= createdAt) {
    throw new CollaborationError("a claim requires a bounded validity window");
  }
  return {
    schema_version: "rdlc.work-claim/v0.2",
    id: mintIdentity(),
    actor,
    workstream,
    scope,
    intent,
    created_at: createdAt,
    expires_at: expiresAt,
    status: "active"
  };
}

function scopeIds(claim) {
  return new Set(Object.values(claim.scope ?? {}).flat());
}

/**
 * §35.2 — overlapping active claims notify both contributors with the shared
 * scope; parallel work is never blocked solely because scope overlaps.
 * Expired claims are ignored for overlap but retained by the caller's audit.
 */
export function detectClaimOverlaps(claims, { now }) {
  if (!now) throw new CollaborationError("overlap detection requires the authority's current time");
  const active = claims.filter((claim) => claim.status === "active" && claim.expires_at > now);
  const sets = active.map((claim) => scopeIds(claim));
  const overlaps = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (active[i].actor === active[j].actor) continue;
      const shared = [...sets[i]].filter((id) => sets[j].has(id));
      if (shared.length > 0) {
        overlaps.push({
          claims: [active[i].id, active[j].id],
          notify: [active[i].actor, active[j].actor],
          shared_scope: shared,
          blocking: false,
          coordination: "offer"
        });
      }
    }
  }
  return overlaps;
}

/* ----------------------------------------------------------------- leases */

const LEASE_PURPOSES = Object.freeze([
  "allocate-display-aliases", "publish-baseline", "finalize-approval-package",
  "migrate", "recover-connector-cursor"
]);

/**
 * §35.9 — short-lived exclusive authority for bounded mutations. Backed by an
 * atomic compare-and-swap authority; expiry is decided by the authority's
 * clock and monotonic fencing tokens, never a claimant's wall clock.
 */
export class LeaseAuthority {
  #backend;
  #clock;

  constructor(backend = new InMemoryCasBackend(), { clock } = {}) {
    if (!clock) throw new CollaborationError("the lease authority requires its own clock source (§35.9)");
    this.#backend = backend;
    this.#clock = clock;
  }

  async #mutate(mutator) {
    for (let attempt = 0; attempt < 5000; attempt += 1) {
      const { state, version } = await this.#backend.read();
      const current = state ?? { leases: {}, fencing: 0, audit: [] };
      const next = structuredClone(current);
      // A mutator may both mutate (audit, expiry observation) and reject the
      // caller: `reject` is thrown only AFTER the mutation persists (§35.9 —
      // every expiry observation is a materialized auditable record).
      const result = mutator(next);
      if (await this.#backend.compareAndSwap(version, next)) {
        if (result && typeof result === "object" && result.reject instanceof Error) throw result.reject;
        return result;
      }
    }
    throw new CollaborationError("lease authority contention: retries exhausted");
  }

  #audit(state, event, lease, details = {}) {
    state.audit.push({ event, lease: lease.id, resource: lease.resource, holder: lease.holder.principal, at: this.#clock(), ...details });
  }

  async acquire({ resource, purpose, holder, ttlMs, baseHash }) {
    if (!LEASE_PURPOSES.includes(purpose)) throw new CollaborationError(`unknown lease purpose: ${purpose}`);
    if (!isCanonicalIdentity(holder?.principal)) throw new CollaborationError("a lease requires a canonical holder principal");
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new CollaborationError("a lease requires a positive ttl");
    return this.#mutate((state) => {
      const now = this.#clock();
      const existing = state.leases[resource];
      if (existing && existing.status === "active" && existing.expires_at > now) {
        return { acquired: false, holder: existing.holder.principal, expires_at: existing.expires_at };
      }
      if (existing && existing.status === "active") {
        existing.status = "expired";
        this.#audit(state, "expiry-observed", existing);
      }
      state.fencing += 1;
      const lease = {
        schema_version: "rdlc.lease/v0.2",
        id: mintIdentity(),
        resource,
        purpose,
        holder,
        authority: "git-ref-compare-and-swap",
        fencing_token: String(state.fencing).padStart(8, "0"),
        base_hash: baseHash ?? null,
        acquired_at: now,
        heartbeat_at: now,
        expires_at: now + ttlMs,
        status: "active"
      };
      state.leases[resource] = lease;
      this.#audit(state, "acquired", lease);
      return { acquired: true, lease };
    });
  }

  /** Renewal is rejected once ownership is lost (§35.9). */
  async renew(resource, leaseId, ttlMs) {
    return this.#mutate((state) => {
      const lease = state.leases[resource];
      const now = this.#clock();
      if (!lease || lease.id !== leaseId) throw new CollaborationError("lease is not held by this claimant");
      if (lease.status !== "active" || lease.expires_at <= now) {
        lease.status = "expired";
        this.#audit(state, "renewal-rejected-after-loss", lease);
        return { reject: new CollaborationError("an expired lease must not be renewed (§35.9)") };
      }
      lease.heartbeat_at = now;
      lease.expires_at = now + ttlMs;
      this.#audit(state, "renewed", lease);
      return lease;
    });
  }

  async release(resource, leaseId) {
    return this.#mutate((state) => {
      const lease = state.leases[resource];
      if (!lease || lease.id !== leaseId) throw new CollaborationError("lease is not held by this claimant");
      lease.status = "released";
      this.#audit(state, "released", lease);
      return lease;
    });
  }

  /** §35.9 — forced break requires role, reason, and notification attempt. */
  async forceBreak(resource, { role, reason, notifiedHolder }) {
    if (!role || !reason) throw new CollaborationError("forced break requires an authorized role and reason");
    return this.#mutate((state) => {
      const lease = state.leases[resource];
      if (!lease || lease.status !== "active") throw new CollaborationError("no active lease to break");
      lease.status = "broken";
      this.#audit(state, "forced-break", lease, { role, reason, notified_holder: notifiedHolder ?? false });
      return lease;
    });
  }

  /**
   * Fencing guard for the mutation target: every protected write carries the
   * current token and older tokens are rejected (§35.9).
   *
   * This check is advisory at the caller: the lease can expire between guard
   * and write. The mutation target must verify the fencing token atomically
   * at write time; collision detection and optimistic version checks remain
   * mandatory (§35.9 "a broken or expired lease never proves the prior
   * writer stopped").
   */
  async guardWrite(resource, fencingToken) {
    const { state } = await this.#backend.read();
    const lease = state?.leases?.[resource];
    const now = this.#clock();
    if (!lease || lease.status !== "active" || lease.expires_at <= now) {
      throw new CollaborationError("no active lease authorizes this write (§35.9)");
    }
    if (lease.fencing_token !== fencingToken) {
      throw new CollaborationError(`stale fencing token rejected: ${fencingToken} != ${lease.fencing_token}`);
    }
    return true;
  }

  async auditLog() {
    const { state } = await this.#backend.read();
    return state?.audit ?? [];
  }
}

/* ----------------------------------------------- optimistic concurrency */

/** Fields whose overlap always requires human resolution (§35.7). */
const HUMAN_RESOLUTION_FIELDS = Object.freeze([
  "statement", "acceptance_criteria", "business_rules", "priority",
  "estimate", "owner", "approval", "title", "rationale"
]);

/**
 * §35.7 — every shared write carries an expected base version or hash; a
 * mismatch stops the write and produces a base/current/proposed comparison.
 * Non-overlapping relationship additions may merge deterministically.
 */
export function sharedWrite({ base, current, proposed }) {
  if (!base?.version && !base?.content_hash) {
    throw new CollaborationError("a shared write requires an expected base version or content hash (§35.7)");
  }
  const fresh = (base.version === undefined || base.version === current.version)
    && (base.content_hash === undefined || base.content_hash === current.content_hash);
  if (fresh) return { applied: true, artifact: { ...proposed, version: (current.version ?? 0) + 1 } };

  // Diff over the UNION of keys so deletions are first-class changes (§35.7,
  // §35.6: never silently discard another contributor's changes).
  const allKeys = [...new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(proposed)])];
  const changedByOther = allKeys.filter((key) => !sameValue(current[key], base[key]));
  const changedByUs = allKeys.filter((key) => !sameValue(proposed[key], base[key]));
  const overlapping = changedByUs.filter((key) => changedByOther.includes(key));
  const deletionInvolved = overlapping.some(
    (key) => !Object.hasOwn(current, key) || !Object.hasOwn(proposed, key)
  );

  const humanRequired = deletionInvolved || overlapping.some((key) => HUMAN_RESOLUTION_FIELDS.includes(key));
  const onlyRelationshipAdditions =
    overlapping.length === 1 && overlapping[0] === "relationships"
    && Array.isArray(base.relationships) && Array.isArray(current.relationships) && Array.isArray(proposed.relationships)
    && base.relationships.every((entry) => current.relationships.some((other) => JSON.stringify(other) === JSON.stringify(entry)))
    && base.relationships.every((entry) => proposed.relationships.some((other) => JSON.stringify(other) === JSON.stringify(entry)));

  if (!humanRequired && (overlapping.length === 0 || onlyRelationshipAdditions)) {
    const merged = { ...current };
    for (const key of changedByUs) {
      if (!Object.hasOwn(proposed, key)) {
        // Our own deletion of a field the other side did not touch.
        if (!changedByOther.includes(key)) delete merged[key];
        continue;
      }
      if (key === "relationships" && onlyRelationshipAdditions) {
        const combined = [...current.relationships];
        for (const entry of proposed.relationships) {
          if (!combined.some((other) => JSON.stringify(other) === JSON.stringify(entry))) combined.push(entry);
        }
        merged.relationships = combined;
      } else if (!changedByOther.includes(key)) {
        merged[key] = proposed[key];
      }
    }
    return {
      applied: true,
      merged: true,
      artifact: { ...merged, version: (current.version ?? 0) + 1 },
      mergedFields: changedByUs
    };
  }

  return {
    applied: false,
    comparison: { base, current, proposed, overlapping_fields: overlapping },
    resolution: "human-required"
  };
}

/* ------------------------------------------------- collision dispositions */

export const COLLISION_TYPES = Object.freeze([
  "identity", "edit", "semantic-duplicate", "partial-overlap", "behavioral-conflict",
  "coverage-gap", "hierarchy", "component-ownership", "dependency",
  "baseline-staleness", "approval-staleness", "external-drift"
]);

export const COLLISION_OUTCOMES = Object.freeze([
  "promote-cleanly", "promote-with-warnings", "revise-and-rerun", "link-related",
  "declare-intentional-multiple", "partition-scope", "split-story", "propose-merge",
  "reuse-existing", "supersede-via-change-control", "escalate-to-owner", "defer", "withdraw"
]);

/** §35.6 — every collision decision is an audited human disposition. */
export function recordCollisionDecision({
  collisionType, comparedRevisions, participants, rationale, outcome, affectedCoverage, resultingRelationships, at
}) {
  if (!COLLISION_TYPES.includes(collisionType)) throw new CollaborationError(`unknown collision type: ${collisionType}`);
  if (!COLLISION_OUTCOMES.includes(outcome)) throw new CollaborationError(`unknown collision outcome: ${outcome}`);
  if (!Array.isArray(comparedRevisions) || comparedRevisions.length < 2) {
    throw new CollaborationError("a collision decision records the compared revisions");
  }
  if (!Array.isArray(participants) || participants.length === 0 || !participants.every(isCanonicalIdentity)) {
    throw new CollaborationError("a collision decision records canonical participants");
  }
  if (!rationale) throw new CollaborationError("a collision decision requires a rationale");
  // §35.6: overlap is never marked intentional silently — the rationale and
  // participants above are that explicit human declaration.
  return Object.freeze({
    schema_version: "rdlc.collision-decision/v0.2",
    id: mintIdentity(),
    collision_type: collisionType,
    compared_revisions: comparedRevisions,
    participants,
    rationale,
    outcome,
    affected_coverage: affectedCoverage ?? [],
    resulting_relationships: resultingRelationships ?? [],
    at: at ?? new Date().toISOString()
  });
}
