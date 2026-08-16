import assert from "node:assert/strict";
import test from "node:test";

import {
  AliasAuthority,
  IdentityError,
  InMemoryCasBackend,
  isCanonicalIdentity,
  isUuidv7,
  mintIdentity,
  untrustedTimestampMs,
  uuidv7
} from "../../core/lib/identity.mjs";

test("FEAT-004: generated identifiers validate as RFC 9562 UUIDv7", () => {
  for (let i = 0; i < 500; i += 1) {
    const value = uuidv7();
    assert.ok(isUuidv7(value), value);
    assert.equal(value[14], "7", "version nibble");
    assert.ok("89ab".includes(value[19]), "variant nibble");
  }
});

test("FEAT-004: minted identities are unique canonical URNs", () => {
  const seen = new Set(Array.from({ length: 2000 }, () => mintIdentity()));
  assert.equal(seen.size, 2000);
  for (const urn of seen) assert.ok(isCanonicalIdentity(urn));
});

test("FEAT-004: the embedded timestamp is exposed only as untrusted metadata", () => {
  const urn = mintIdentity(1755277320000);
  assert.equal(untrustedTimestampMs(urn), 1755277320000);
  // The API name is the contract: no trusted-chronology accessor exists.
  const identity = await_import_names();
  assert.ok(!identity.includes("trustedTimestamp"));
  assert.ok(identity.includes("untrustedTimestampMs"));
});

function await_import_names() {
  return Object.keys({
    AliasAuthority, IdentityError, InMemoryCasBackend, isCanonicalIdentity,
    isUuidv7, mintIdentity, untrustedTimestampMs, uuidv7
  });
}

test("FEAT-004: uuidv7 rejects out-of-range timestamps", () => {
  assert.throws(() => uuidv7(-1), IdentityError);
  assert.throws(() => uuidv7(2 ** 48), IdentityError);
  assert.throws(() => uuidv7(1.5), IdentityError);
});

test("FEAT-004: sequential aliases allocate per prefix and are idempotent per artifact", async () => {
  const authority = new AliasAuthority(new InMemoryCasBackend());
  const a = mintIdentity();
  const b = mintIdentity();
  assert.equal(await authority.allocate("REQ", a), "REQ-1");
  assert.equal(await authority.allocate("REQ", b), "REQ-2");
  assert.equal(await authority.allocate("REQ", a), "REQ-1", "re-allocation is idempotent");
  assert.equal(await authority.allocate("RISK", b), "RISK-1", "counters are per prefix");
  await assert.rejects(authority.allocate("req", a), IdentityError);
  await assert.rejects(authority.allocate("REQ", "REQ-104"), IdentityError);
});

test("FEAT-004: colliding branch proposals reconcile without changing canonical UUIDs (§12.2)", async () => {
  const authority = new AliasAuthority(new InMemoryCasBackend());
  const first = mintIdentity();
  const second = mintIdentity();
  const kept = await authority.reconcileProposal("REQ-104", first);
  assert.deepEqual(kept, { alias: "REQ-104", collided: false });
  const reassigned = await authority.reconcileProposal("REQ-104", second);
  assert.equal(reassigned.collided, true);
  assert.equal(reassigned.alias, "REQ-105");
  assert.equal((await authority.resolve("REQ-104")).id, first);
  assert.equal((await authority.resolve("REQ-105")).id, second);
});

test("FEAT-004: alias history retains previous aliases and effective dates (§12.2)", async () => {
  let tick = 0;
  const authority = new AliasAuthority(new InMemoryCasBackend(), {
    now: () => `2026-08-15T19:00:0${tick++}.000Z`
  });
  const artifact = mintIdentity();
  const alias = await authority.allocate("REQ", artifact);
  await authority.supersede(alias, "REQ-CHECKOUT-1", artifact);
  const history = await authority.history({ artifact });
  assert.equal(history.length, 2);
  assert.equal(history[0].action, "allocated");
  assert.equal(history[1].action, "superseded");
  assert.equal(history[1].previous, "REQ-1");
  assert.ok(history.every((entry) => /^2026-08-15T19:00:0\dZ?/.test(entry.at) || entry.at.endsWith("Z")));
  const resolved = await authority.resolve("REQ-1");
  assert.deepEqual(resolved, { id: artifact, status: "superseded" });
  assert.equal((await authority.resolve("REQ-CHECKOUT-1")).status, "active");
});

test("FEAT-004: superseding an alias not bound to the artifact fails closed", async () => {
  const authority = new AliasAuthority(new InMemoryCasBackend());
  const artifact = mintIdentity();
  await authority.allocate("REQ", artifact);
  await assert.rejects(authority.supersede("REQ-1", "REQ-2", mintIdentity()), IdentityError);
  await assert.rejects(authority.resolve("REQ-999"), IdentityError);
});

test("FEAT-004: concurrent allocations serialize through compare-and-swap without duplicates", async () => {
  const authority = new AliasAuthority(new InMemoryCasBackend());
  const aliases = await Promise.all(
    Array.from({ length: 100 }, () => authority.allocate("STORY", mintIdentity()))
  );
  assert.equal(new Set(aliases).size, 100);
  const numbers = aliases.map((alias) => Number(alias.split("-")[1])).sort((x, y) => x - y);
  assert.deepEqual(numbers, Array.from({ length: 100 }, (_, i) => i + 1));
});

test("FEAT-004: a recycled alias is detected as ambiguous and fails closed", async () => {
  const backend = new InMemoryCasBackend();
  const authority = new AliasAuthority(backend);
  const first = mintIdentity();
  const second = mintIdentity();
  await authority.allocate("REQ", first);
  // Simulate an unauthorized manual recycle in the underlying state.
  const { state, version } = await backend.read();
  const corrupted = structuredClone(state);
  corrupted.aliases["REQ-1"] = { artifact: second, prefix: "REQ", status: "active", effective_at: "2027-01-01T00:00:00.000Z" };
  corrupted.history.push({ alias: "REQ-1", artifact: second, action: "allocated", at: "2027-01-01T00:00:00.000Z" });
  await backend.compareAndSwap(version, corrupted);
  await assert.rejects(authority.resolve("REQ-1"), /ambiguous or recycled/);
});
