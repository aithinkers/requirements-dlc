import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLISION_OUTCOMES,
  COLLISION_TYPES,
  CollaborationError,
  LeaseAuthority,
  createClaim,
  detectClaimOverlaps,
  recordCollisionDecision,
  sharedWrite
} from "../../core/lib/collaboration.mjs";
import { InMemoryCasBackend, mintIdentity } from "../../core/lib/identity.mjs";

const alex = mintIdentity();
const sam = mintIdentity();
const requirement = mintIdentity();

function claim(actor, scope, { created = "2026-08-15T19:00:00.000Z", expires = "2026-08-16T19:00:00.000Z", status = "active" } = {}) {
  const record = createClaim({
    actor, workstream: `ws-${actor.slice(-4)}`, scope, intent: "cover recovery stories",
    createdAt: created, expiresAt: expires
  });
  return { ...record, status };
}

test("FEAT-008: claims require actor, scope, intent, and a bounded window (§35.2)", () => {
  assert.throws(() => createClaim({ actor: "alex", workstream: "w", scope: { requirements: [requirement] }, intent: "i", createdAt: "a", expiresAt: "b" }), CollaborationError);
  assert.throws(() => createClaim({ actor: alex, workstream: "w", scope: {}, intent: "i", createdAt: "2026-01-01", expiresAt: "2026-01-02" }), CollaborationError);
  assert.throws(() => createClaim({ actor: alex, workstream: "w", scope: { requirements: [requirement] }, intent: "i", createdAt: "2026-01-02", expiresAt: "2026-01-01" }), CollaborationError);
});

test("FEAT-008: overlapping claims notify both contributors without blocking (§35.2)", () => {
  const a = claim(alex, { requirements: [requirement] });
  const b = claim(sam, { requirements: [requirement], components: [mintIdentity()] });
  const overlaps = detectClaimOverlaps([a, b], { now: "2026-08-15T20:00:00.000Z" });
  assert.equal(overlaps.length, 1);
  assert.deepEqual(overlaps[0].notify.sort(), [alex, sam].sort());
  assert.deepEqual(overlaps[0].shared_scope, [requirement]);
  assert.equal(overlaps[0].blocking, false);
});

test("FEAT-008: expired claims are ignored for blocking decisions (§35.2)", () => {
  const a = claim(alex, { requirements: [requirement] }, { expires: "2026-08-15T19:30:00.000Z" });
  const b = claim(sam, { requirements: [requirement] });
  assert.deepEqual(detectClaimOverlaps([a, b], { now: "2026-08-15T20:00:00.000Z" }), []);
  assert.throws(() => detectClaimOverlaps([a, b], {}), CollaborationError);
});

test("FEAT-008: leases acquire, renew, release with authority-clock expiry (§35.9)", async () => {
  let clockMs = 1000;
  const authority = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => clockMs });
  const holder = { principal: alex, host: "claude-code", session: "s1" };
  const first = await authority.acquire({ resource: "alias-authority://p/req", purpose: "allocate-display-aliases", holder, ttlMs: 500 });
  assert.equal(first.acquired, true);
  assert.equal(first.lease.fencing_token, "00000001");

  // Second writer cannot acquire while active.
  const contested = await authority.acquire({ resource: "alias-authority://p/req", purpose: "allocate-display-aliases", holder: { principal: sam }, ttlMs: 500 });
  assert.equal(contested.acquired, false);
  assert.equal(contested.holder, alex);

  // Renewal extends by the authority clock.
  clockMs = 1400;
  const renewed = await authority.renew("alias-authority://p/req", first.lease.id, 500);
  assert.equal(renewed.expires_at, 1900);

  await authority.release("alias-authority://p/req", first.lease.id);
  const audit = await authority.auditLog();
  assert.deepEqual(audit.map((entry) => entry.event), ["acquired", "renewed", "released"]);
});

test("FEAT-008: an expired lease is never renewed and takeover mints a newer fencing token (§35.9)", async () => {
  let clockMs = 1000;
  const authority = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => clockMs });
  const first = await authority.acquire({ resource: "r://x", purpose: "publish-baseline", holder: { principal: alex }, ttlMs: 100 });
  clockMs = 2000;
  await assert.rejects(authority.renew("r://x", first.lease.id, 100), /must not be renewed/);
  const second = await authority.acquire({ resource: "r://x", purpose: "publish-baseline", holder: { principal: sam }, ttlMs: 100 });
  assert.equal(second.acquired, true);
  assert.ok(Number(second.lease.fencing_token) > Number(first.lease.fencing_token));
  const audit = await authority.auditLog();
  assert.ok(audit.some((entry) => ["expiry-observed", "renewal-rejected-after-loss"].includes(entry.event)));
});

test("FEAT-008: protected writes carry the current fencing token; older tokens are rejected (§35.9)", async () => {
  let clockMs = 1000;
  const authority = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => clockMs });
  const first = await authority.acquire({ resource: "r://y", purpose: "migrate", holder: { principal: alex }, ttlMs: 100 });
  assert.equal(await authority.guardWrite("r://y", first.lease.fencing_token), true);
  clockMs = 2000;
  const second = await authority.acquire({ resource: "r://y", purpose: "migrate", holder: { principal: sam }, ttlMs: 100 });
  await assert.rejects(authority.guardWrite("r://y", first.lease.fencing_token), /stale fencing token/);
  assert.equal(await authority.guardWrite("r://y", second.lease.fencing_token), true);
  clockMs = 3000;
  await assert.rejects(authority.guardWrite("r://y", second.lease.fencing_token), /no active lease/);
});

test("FEAT-008: forced break requires role, reason, and is audited (§35.9)", async () => {
  const authority = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => 1 });
  await authority.acquire({ resource: "r://z", purpose: "migrate", holder: { principal: alex }, ttlMs: 100 });
  await assert.rejects(authority.forceBreak("r://z", { role: "", reason: "" }), CollaborationError);
  await authority.forceBreak("r://z", { role: "space-admin", reason: "holder host lost", notifiedHolder: true });
  const audit = await authority.auditLog();
  const broken = audit.find((entry) => entry.event === "forced-break");
  assert.equal(broken.role, "space-admin");
  assert.equal(broken.notified_holder, true);
});

test("FEAT-008: two simultaneous exclusive mutations serialize through the lease (§35.9, §46 step 6)", async () => {
  let clockMs = 0;
  const authority = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => clockMs });
  const attempts = await Promise.all([alex, sam].map((principal) =>
    authority.acquire({ resource: "alias-authority://p/story", purpose: "allocate-display-aliases", holder: { principal }, ttlMs: 1000 })
  ));
  const winners = attempts.filter((attempt) => attempt.acquired);
  assert.equal(winners.length, 1, "exactly one writer wins");
});

test("FEAT-008: stale shared writes stop with a three-way comparison (§35.7)", () => {
  const base = { version: 3, statement: "old", relationships: [] };
  const current = { version: 4, statement: "changed by other", relationships: [] };
  const proposed = { version: 3, statement: "changed by us", relationships: [] };
  const result = sharedWrite({ base, current, proposed });
  assert.equal(result.applied, false);
  assert.deepEqual(result.comparison.base, base);
  assert.deepEqual(result.comparison.current, current);
  assert.deepEqual(result.comparison.proposed, proposed);
  assert.ok(result.comparison.overlapping_fields.includes("statement"));
  assert.equal(result.resolution, "human-required");
  assert.throws(() => sharedWrite({ base: {}, current, proposed }), /expected base version/);
});

test("FEAT-008: non-overlapping relationship additions merge deterministically (§35.7)", () => {
  const r1 = { type: "depends-on", target: mintIdentity() };
  const r2 = { type: "affects", target: mintIdentity() };
  const base = { version: 3, statement: "s", relationships: [] };
  const current = { version: 4, statement: "s", relationships: [r1] };
  const proposed = { version: 3, statement: "s", relationships: [r2] };
  const result = sharedWrite({ base, current, proposed });
  assert.equal(result.applied, true);
  assert.equal(result.merged, true);
  assert.deepEqual(result.artifact.relationships, [r1, r2]);
  assert.equal(result.artifact.version, 5);
});

test("FEAT-008: fresh writes apply and bump the version (§35.7)", () => {
  const base = { version: 3, content_hash: "sha256:" + "a".repeat(64) };
  const current = { version: 3, content_hash: "sha256:" + "a".repeat(64), statement: "s" };
  const result = sharedWrite({ base, current, proposed: { ...current, statement: "new" } });
  assert.equal(result.applied, true);
  assert.equal(result.artifact.version, 4);
});

test("FEAT-008: collision decisions record revisions, participants, rationale, and outcome (§35.6)", () => {
  assert.equal(COLLISION_TYPES.length, 12);
  assert.ok(COLLISION_OUTCOMES.includes("declare-intentional-multiple"));
  const decision = recordCollisionDecision({
    collisionType: "semantic-duplicate",
    comparedRevisions: [{ artifact: requirement, version: 2 }, { artifact: mintIdentity(), version: 1 }],
    participants: [alex, sam],
    rationale: "Both stories express the same recovery outcome; s2 reused.",
    outcome: "reuse-existing",
    affectedCoverage: [requirement],
    at: "2026-08-15T21:00:00.000Z"
  });
  assert.ok(Object.isFrozen(decision));
  assert.equal(decision.outcome, "reuse-existing");
  assert.throws(() => recordCollisionDecision({ collisionType: "novel", comparedRevisions: [1, 2], participants: [alex], rationale: "r", outcome: "defer" }), /unknown collision type/);
  assert.throws(() => recordCollisionDecision({ collisionType: "edit", comparedRevisions: [1], participants: [alex], rationale: "r", outcome: "defer" }), /compared revisions/);
  assert.throws(() => recordCollisionDecision({ collisionType: "edit", comparedRevisions: [1, 2], participants: ["not-urn"], rationale: "r", outcome: "defer" }), /canonical participants/);
  assert.throws(() => recordCollisionDecision({ collisionType: "edit", comparedRevisions: [1, 2], participants: [alex], rationale: "", outcome: "defer" }), /rationale/);
});

test("FEAT-008: field deletions are conflict changes requiring human resolution (review HIGH)", () => {
  const base = { version: 1, notes: "old" };
  // Other side deleted, we edited: never silently resurrect.
  const deletedByOther = sharedWrite({ base, current: { version: 2 }, proposed: { version: 1, notes: "edited" } });
  assert.equal(deletedByOther.applied, false);
  assert.equal(deletedByOther.resolution, "human-required");
  // We deleted, other side edited: never silently drop their edit.
  const deletedByUs = sharedWrite({ base, current: { version: 2, notes: "their edit" }, proposed: { version: 1 } });
  assert.equal(deletedByUs.applied, false);
  // Our uncontested deletion merges through.
  const cleanDelete = sharedWrite({
    base: { version: 1, notes: "old", tag: "x" },
    current: { version: 2, notes: "old", tag: "y" },
    proposed: { version: 1, tag: "x" }
  });
  assert.equal(cleanDelete.applied, true);
  assert.equal(Object.hasOwn(cleanDelete.artifact, "notes"), false);
  assert.equal(cleanDelete.artifact.tag, "y");
});

test("FEAT-008: rejected renewals persist their expiry-observation audit (review MEDIUM)", async () => {
  let clockMs = 1000;
  const authority = new LeaseAuthority(new InMemoryCasBackend(), { clock: () => clockMs });
  const first = await authority.acquire({ resource: "r://audit", purpose: "migrate", holder: { principal: alex }, ttlMs: 100 });
  clockMs = 2000;
  await assert.rejects(authority.renew("r://audit", first.lease.id, 100), /must not be renewed/);
  const audit = await authority.auditLog();
  assert.ok(audit.some((entry) => entry.event === "renewal-rejected-after-loss"), "audit persisted despite rejection");
});

test("FEAT-008: field comparison is key-order insensitive (review LOW)", () => {
  const base = { version: 1, meta: { a: 1, b: 2 } };
  const current = { version: 1, meta: { b: 2, a: 1 } };
  const result = sharedWrite({ base, current, proposed: { version: 1, meta: { a: 1, b: 2 }, extra: "new" } });
  assert.equal(result.applied, true);
  assert.equal(result.comparison, undefined, "reordered keys are not spurious conflicts");
});
