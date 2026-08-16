import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ConnectorError, JiraConnector, recordedTransport } from "../../core/connectors/jira/index.mjs";
import { mintIdentity } from "../../core/lib/identity.mjs";

const fixture = JSON.parse(await readFile("fixtures/jira/synthetic-project.json", "utf8"));
const mapping = { version: "jira-com/v1", projectKey: "COM", fields: ["summary", "status"] };

const get = (path, body, status = 200) => ({ method: "GET", path, response: { status, body } });
const issueGet = (key, issueBody) => get(`/rest/api/3/issue/${key}?expand=changelog`, issueBody);

function makeIssue(key, id, updated, summary) {
  return { id, key, fields: { summary, status: { name: "To Do" }, updated } };
}

function connector(recording, writeMode = "approve-each-batch") {
  return new JiraConnector({
    transport: recordedTransport(recording),
    mapping,
    writeMode,
    now: () => "2026-08-15T22:00:00.000Z"
  });
}

function changesetWith(operations) {
  return { id: mintIdentity(), connection: "delivery-jira", operations };
}

const emptySearch = (extra = "") => get(`/rest/api/3/search?jql=${encodeURIComponent("project = COM")}&properties=rdlc.operation${extra}`, { issues: [] });

test("FEAT-010: schema and permission discovery read the synthetic company-managed project", async () => {
  const jira = connector([
    get("/rest/api/3/issue/createmeta?projectKeys=COM&expand=projects.issuetypes.fields", fixture.createmeta),
    get("/rest/api/3/myself", fixture.myself)
  ]);
  const schema = await jira.discoverSchema();
  assert.deepEqual(schema.issue_types.map((type) => type.name), ["Story", "Task", "Readiness Review"]);
  const who = await jira.discoverPermissions();
  assert.equal(who.account_id, "acc-alex-immutable");
});

test("FEAT-010: pull produces a snapshot with provider revision identity and source hash", async () => {
  const jira = connector([issueGet("COM-104", fixture.issue_com_104)]);
  const snapshot = await jira.pull("COM-104");
  assert.equal(snapshot.item_id, "COM-104");
  assert.equal(snapshot.revision, "2026-08-15 18:00");
  assert.match(snapshot.source_hash, /^sha256:[0-9a-f]{64}$/);
});

test("FEAT-010: three-way diff separates clean changes from provider conflicts (§29.4)", () => {
  const jira = connector([]);
  const base = { fields: { summary: "old", status: "To Do" } };
  const current = { fields: { summary: "edited in Jira", status: "To Do" } };
  const result = jira.diff({ base, current, proposed: { summary: "our edit", status: "In Progress" } });
  assert.equal(result.requiresResolution, true);
  assert.equal(result.conflicts[0].field, "summary");
  assert.deepEqual(result.changes.map((change) => change.field), ["status"]);
});

test("FEAT-010: changeset validation enforces idempotency keys, preconditions, and the destructive default (§29.2)", () => {
  const jira = connector([]);
  const schema = { issue_types: [{ name: "Story" }] };
  const bad = jira.validateChangeset(changesetWith([
    { operation_id: "op-001", action: "create", target: { work_type: "Bug" } },
    { operation_id: "op-002", action: "update", target: "COM-104", fields: {} },
    { operation_id: "op-003", action: "delete", target: "COM-104" }
  ]), { schema });
  assert.equal(bad.valid, false);
  assert.equal(bad.failures.length, 4);
  const good = jira.validateChangeset(changesetWith([
    { operation_id: "op-001", action: "create", target: { work_type: "Story" }, idempotency_key: "rdlc:x" },
    { operation_id: "op-002", action: "update", target: "COM-104", fields: {}, preconditions: { revision: "1" } }
  ]), { schema });
  assert.equal(good.valid, true);
});

test("FEAT-010: propose mode previews without applying; read-only refuses; batch approval is required (§29.2)", async () => {
  const changeset = changesetWith([{ operation_id: "op-001", action: "create", target: { work_type: "Story" }, fields: { summary: "S" }, idempotency_key: "rdlc:a", artifact: mintIdentity() }]);
  const proposeOnly = await connector([], "propose").applyChangeset(changeset, {});
  assert.equal(proposeOnly.applied, false);
  assert.match(proposeOnly.reason, /propose mode/);
  assert.equal(proposeOnly.preview.operations[0].action, "create");

  await assert.rejects(connector([], "read-only").applyChangeset(changeset, {}), /read-only/);
  await assert.rejects(
    connector([]).applyChangeset(changeset, { approval: { status: "pending" } }),
    (error) => error.category === "approval-required"
  );
});

test("FEAT-010: the full write sequence creates, reads back, verifies, and issues a receipt (§29.1, §33.2)", async () => {
  const created = makeIssue("COM-201", "20201", "2026-08-15 19:00", "New story");
  const jira = connector([
    emptySearch(),
    { method: "POST", path: "/rest/api/3/issue", response: { status: 201, body: { id: "20201", key: "COM-201" }, headers: { "x-arequestid": "req-1" } } },
    issueGet("COM-201", created)
  ]);
  const changeset = changesetWith([{
    operation_id: "op-001", action: "create", target: { work_type: "Story" },
    fields: { summary: "New story", status: { name: "To Do" } }, idempotency_key: "rdlc:create-1", artifact: mintIdentity()
  }]);
  const result = await jira.applyChangeset(changeset, { approval: { status: "approved" } });
  assert.equal(result.applied, true);
  const receipt = result.receipts[0];
  assert.equal(receipt.external_target, "COM-201");
  assert.equal(receipt.result, "created");
  assert.equal(receipt.provider_request_id, "req-1");
  assert.match(receipt.readback_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.after_revision, "2026-08-15 19:00");
  assert.equal(result.results["op-001"].status, "verified");
});

test("FEAT-010: retrying an uncertain create reconciles by idempotency identity without duplicating (§29.4, §46 step 11)", async () => {
  const existing = { ...makeIssue("COM-202", "20202", "2026-08-15 19:05", "Recovered story"), properties: { "rdlc.operation": { key: "rdlc:create-2" } } };
  const jira = connector([
    get(`/rest/api/3/search?jql=${encodeURIComponent("project = COM")}&properties=rdlc.operation`, { issues: [existing] }),
    issueGet("COM-202", existing)
  ]);
  const changeset = changesetWith([{
    operation_id: "op-001", action: "create", target: { work_type: "Story" },
    fields: { summary: "Recovered story", status: { name: "To Do" } }, idempotency_key: "rdlc:create-2", artifact: mintIdentity()
  }]);
  const result = await jira.applyChangeset(changeset, { approval: { status: "approved" } });
  assert.equal(result.applied, true);
  assert.equal(result.receipts[0].result, "reconciled-existing");
  assert.equal(result.receipts[0].external_target, "COM-202");
});

test("FEAT-010: a timed-out create reports uncertain and later resumes without duplicating verified ops (§29.5)", async () => {
  const jira = connector([
    emptySearch(),
    { method: "POST", path: "/rest/api/3/issue", response: { timeout: true } }
  ]);
  const artifact = mintIdentity();
  const changeset = changesetWith([
    { operation_id: "op-001", action: "create", target: { work_type: "Story" }, fields: { summary: "A" }, idempotency_key: "rdlc:u-1", artifact },
    { operation_id: "op-002", action: "comment", target: "COM-104", fields: { body: "note" } }
  ]);
  const first = await jira.applyChangeset(changeset, { approval: { status: "approved" } });
  assert.equal(first.applied, false);
  assert.equal(first.results["op-001"].status, "uncertain");
  assert.equal(first.results["op-002"].status, "not-started");

  // Resume: verified op-001 (now reconciled) is not re-applied.
  const created = { ...makeIssue("COM-203", "20203", "2026-08-15 19:10", "A"), properties: { "rdlc.operation": { key: "rdlc:u-1" } } };
  const resume = connector([
    get(`/rest/api/3/search?jql=${encodeURIComponent("project = COM")}&properties=rdlc.operation`, { issues: [created] }),
    issueGet("COM-203", { ...created, fields: { ...created.fields, status: { name: "To Do" } } }),
    { method: "POST", path: "/rest/api/3/issue/COM-104/comment", response: { status: 201, body: { id: "c-1" } } }
  ]);
  const second = await resume.applyChangeset(
    { ...changeset, operations: [{ ...changeset.operations[0], fields: { summary: "A", status: { name: "To Do" } } }, changeset.operations[1]] },
    { approval: { status: "approved" } }
  );
  assert.equal(second.applied, true);
  assert.equal(second.results["op-001"].receipt.result, "reconciled-existing");
  assert.equal(second.results["op-002"].status, "verified");
});

test("FEAT-010: updates enforce revision preconditions and fail on provider drift (§29.4)", async () => {
  const drifted = makeIssue("COM-104", "20104", "2026-08-15 21:00", "Changed in Jira");
  const jira = connector([issueGet("COM-104", drifted)]);
  const changeset = changesetWith([{
    operation_id: "op-001", action: "update", target: "COM-104",
    fields: { summary: "our edit" }, preconditions: { revision: "2026-08-15 18:00" }
  }]);
  const result = await jira.applyChangeset(changeset, { approval: { status: "approved" } });
  assert.equal(result.applied, false);
  assert.equal(result.results["op-001"].status, "failed");
  assert.match(result.results["op-001"].error.message, /revision precondition failed/);
});

test("FEAT-010: read-back mismatches surface as uncertain, never silent success (§29.1)", async () => {
  const wrong = makeIssue("COM-204", "20204", "2026-08-15 19:20", "NOT what we wrote");
  const jira = connector([
    emptySearch(),
    { method: "POST", path: "/rest/api/3/issue", response: { status: 201, body: { id: "20204", key: "COM-204" } } },
    issueGet("COM-204", wrong)
  ]);
  const changeset = changesetWith([{
    operation_id: "op-001", action: "create", target: { work_type: "Story" },
    fields: { summary: "What we wrote", status: { name: "To Do" } }, idempotency_key: "rdlc:rb-1", artifact: mintIdentity()
  }]);
  const result = await jira.applyChangeset(changeset, { approval: { status: "approved" } });
  assert.equal(result.applied, false);
  assert.equal(result.results["op-001"].status, "uncertain");
  assert.match(result.results["op-001"].error.message, /read-back verification failed/);
});

test("FEAT-010: cursors advance atomically with persistence and never past a failed page (§29.6)", async () => {
  const persisted = [];
  const persist = async (entry) => persisted.push(entry);
  const searchPath = (watermark, startAt = 0) => `/rest/api/3/search?jql=${encodeURIComponent(`project = COM AND updated >= "${watermark}" ORDER BY updated ASC`)}&startAt=${startAt}`;

  const ok = connector([get(searchPath("2026-08-15 00:00"), { issues: [makeIssue("COM-104", "20104", "2026-08-15 18:00", "s")] })]);
  const advanced = await ok.poll({ watermark: "2026-08-15 00:00", startAt: 0, seen: [] }, { persist });
  assert.equal(advanced.items.length, 1);
  assert.equal(persisted.at(-1).cursor.watermark, "2026-08-15 18:00");
  assert.equal(persisted.at(-1).items.length, 1, "cursor advances atomically with its items");

  const failing = connector([get(searchPath("2026-08-15 18:00"), {}, 500)]);
  await assert.rejects(failing.poll({ watermark: "2026-08-15 18:00", startAt: 0, seen: [] }, { persist }));
  const failedCursor = persisted.at(-1).cursor;
  assert.equal(failedCursor.watermark, "2026-08-15 18:00", "watermark did not advance past the failed page");
  assert.match(failedCursor.failure_state, /page-failed:500/);
});

test("FEAT-010: duplicate provider events dedup by immutable identity plus revision (§29.6)", async () => {
  const persisted = [];
  const item = makeIssue("COM-104", "20104", "2026-08-15 18:00", "s");
  const searchPath = (watermark) => `/rest/api/3/search?jql=${encodeURIComponent(`project = COM AND updated >= "${watermark}" ORDER BY updated ASC`)}&startAt=0`;
  const jira = connector([
    get(searchPath("2026-08-15 00:00"), { issues: [item] }),
    get(searchPath("2026-08-15 18:00"), { issues: [item] })
  ]);
  const first = await jira.poll({ watermark: "2026-08-15 00:00", startAt: 0, seen: [] }, { persist: async (entry) => persisted.push(entry) });
  const second = await jira.poll(first.cursor, { persist: async (entry) => persisted.push(entry) });
  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 0, "same identity+revision is not re-emitted");
});

test("FEAT-010: expired provider tokens trigger a safe rescan from the recovery boundary (§29.6)", async () => {
  const persisted = [];
  const searchPath = (watermark) => `/rest/api/3/search?jql=${encodeURIComponent(`project = COM AND updated >= "${watermark}" ORDER BY updated ASC`)}&startAt=5`;
  const jira = connector([get(searchPath("2026-08-15 18:00"), { errorMessages: ["The provided token has expired"] }, 410)]);
  const result = await jira.poll(
    { watermark: "2026-08-15 18:00", startAt: 5, seen: [], recovery_boundary: "2026-08-01 00:00" },
    { persist: async (entry) => persisted.push(entry) }
  );
  assert.equal(result.rescan, true);
  assert.equal(result.cursor.watermark, "2026-08-01 00:00");
  assert.equal(result.cursor.startAt, 0);
});

test("FEAT-010: permission and rate-limit responses map to error categories (§43)", async () => {
  const denied = connector([{ method: "GET", path: "/rest/api/3/issue/COM-1?expand=changelog", response: { status: 403 } }]);
  await assert.rejects(denied.pull("COM-1"), (error) => error.category === "permission-denied");
  const limited = connector([{ method: "GET", path: "/rest/api/3/myself", response: { status: 429 } }]);
  await assert.rejects(limited.discoverPermissions(), (error) => error.category === "rate-limited");
});
