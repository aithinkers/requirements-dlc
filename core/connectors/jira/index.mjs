/**
 * Jira Cloud company-managed connector (spec §29, §30, §33).
 *
 * Implements the common connector contract over an injected transport so CI
 * runs entirely on recorded sanitized fixtures (§44.4, ADR-001 item 9).
 * Every mutation follows pull -> diff -> validate -> changeset -> preview ->
 * approval -> idempotent apply -> read-back -> verify -> receipt (§29.1).
 * External content is untrusted data throughout (§7.8).
 *
 * Capability profile: Connected:Jira-Cloud-Company-Managed, release-0.1
 * subset. Declared deferrals (§30): attachments, native approvals,
 * estimation-field mapping, changelog/history retention, labels/components/
 * versions/sprint fields, subtask hierarchy mapping, webhooks
 * (Webhook-Receiver unclaimed), and rich-text (ADF) read-back normalization —
 * ADF-transformed fields must be excluded from the read-back mapping until a
 * comparator profile lands. Status changes use the transition operation, not
 * field updates.
 */

import { canonicalBytes, readbackHash, sourceHash } from "../../lib/canonical.mjs";
import { mintIdentity } from "../../lib/identity.mjs";

export class ConnectorError extends Error {
  constructor(message, category = "provider-conflict") {
    super(message);
    this.name = "ConnectorError";
    this.category = category;
  }
}

export const WRITE_MODES = Object.freeze(["read-only", "propose", "approve-each-batch", "approved-automation"]);

/** §30 capability declaration for conformance reporting. */
export const CAPABILITIES = Object.freeze({
  profile: "Connected:Jira-Cloud-Company-Managed",
  supported: Object.freeze(["discover-schema", "discover-permissions", "pull", "normalize", "diff", "validate-changeset", "create", "update", "link", "comment", "transition", "poll", "read-back", "receipts", "full-reconciliation"]),
  deferred: Object.freeze(["attach", "native-approvals", "estimation-fields", "history-retention", "labels-components-versions-sprints", "subtask-hierarchy", "webhooks", "adf-readback-normalization"])
});

const IDEMPOTENCY_PROPERTY = "rdlc.operation";

export class JiraConnector {
  #transport;
  #mapping;
  #writeMode;
  #now;
  #actor = null;

  /**
   * @param transport injected request executor: ({method, path, body}) -> {status, body}
   * @param mapping   versioned field mapping: {version, projectKey, fields: [...], issueTypes: {...}}
   */
  constructor({ transport, mapping, writeMode = "propose", now = () => new Date().toISOString() }) {
    if (!transport) throw new ConnectorError("a transport is required", "unrecoverable-configuration");
    if (!mapping?.version || !Array.isArray(mapping.fields)) {
      throw new ConnectorError("a versioned field mapping is required", "unrecoverable-configuration");
    }
    if (!WRITE_MODES.includes(writeMode)) throw new ConnectorError(`unknown write mode: ${writeMode}`, "policy-violation");
    this.#transport = transport;
    this.#mapping = mapping;
    this.#writeMode = writeMode;
    this.#now = now;
  }

  async #request(method, path, body) {
    const response = await this.#transport({ method, path, body });
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorError(`permission denied: ${method} ${path}`, "permission-denied");
    }
    if (response.status === 429) throw new ConnectorError("rate limited", "rate-limited");
    return response;
  }

  /** discover-schema: live project issue types, fields, and hierarchy (§20.1, §29). */
  async discoverSchema() {
    const meta = await this.#request("GET", `/rest/api/3/issue/createmeta?projectKeys=${this.#mapping.projectKey}&expand=projects.issuetypes.fields`);
    if (meta.status !== 200) throw new ConnectorError("schema discovery failed", "provider-capability-unavailable");
    const project = meta.body.projects?.[0];
    if (!project) throw new ConnectorError(`project not visible: ${this.#mapping.projectKey}`, "permission-denied");
    return {
      project: project.key,
      issue_types: (project.issuetypes ?? []).map((type) => ({
        id: type.id, name: type.name, subtask: Boolean(type.subtask),
        fields: Object.keys(type.fields ?? {})
      }))
    };
  }

  /** discover-permissions: the authenticated account and its immutable id (§27.2). */
  async discoverPermissions() {
    const myself = await this.#request("GET", "/rest/api/3/myself");
    if (myself.status !== 200) throw new ConnectorError("identity discovery failed", "permission-denied");
    return { account_id: myself.body.accountId, display_name: myself.body.displayName, active: myself.body.active };
  }

  /** pull: an immutable provider snapshot with revision identity (§16.1, §29). */
  async pull(itemId) {
    const response = await this.#request("GET", `/rest/api/3/issue/${itemId}?expand=changelog`);
    if (response.status === 404) throw new ConnectorError(`item not found: ${itemId}`, "provider-conflict");
    if (response.status !== 200) throw new ConnectorError(`pull failed for ${itemId}`, "provider-conflict");
    const issue = response.body;
    const bytes = canonicalBytes({ issue: { id: issue.id, key: issue.key, fields: issue.fields ?? {} } });
    return {
      schema_version: "rdlc.source-snapshot/v0.2",
      id: mintIdentity(),
      provider: "jira",
      project: this.#mapping.projectKey,
      item_id: issue.key,
      provider_item_id: issue.id,
      revision: String(issue.fields?.updated ?? issue.id),
      retrieved_at: this.#now(),
      source_hash: sourceHash(bytes).hash,
      fields: issue.fields ?? {},
      properties: issue.properties ?? {}
    };
  }

  /** normalize: mapping-selected provider fields (§29, readback profile §12.5). */
  normalize(snapshot) {
    const projected = {};
    for (const field of this.#mapping.fields) projected[field] = snapshot.fields?.[field] ?? null;
    return { item_id: snapshot.item_id, mapping_version: this.#mapping.version, fields: projected };
  }

  /** diff: three-way provider comparison for update preconditions (§29.4, §35.5). */
  diff({ base, current, proposed }) {
    const fields = new Set([...Object.keys(base?.fields ?? {}), ...Object.keys(current?.fields ?? {}), ...Object.keys(proposed ?? {})]);
    const changes = [];
    const conflicts = [];
    for (const field of fields) {
      if (!this.#mapping.fields.includes(field)) continue;
      const baseValue = JSON.stringify(base?.fields?.[field] ?? null);
      const currentValue = JSON.stringify(current?.fields?.[field] ?? null);
      const proposedValue = JSON.stringify(proposed?.[field] ?? null);
      if (proposedValue === baseValue) continue;
      if (currentValue !== baseValue) conflicts.push({ field, base: base?.fields?.[field] ?? null, current: current?.fields?.[field] ?? null, proposed: proposed?.[field] ?? null });
      else changes.push({ field, from: base?.fields?.[field] ?? null, to: proposed?.[field] ?? null });
    }
    return { changes, conflicts, requiresResolution: conflicts.length > 0 };
  }

  /** validate-changeset: schema targets, permissions, and destructive-op policy (§29.2). */
  validateChangeset(changeset, { schema, destructiveAllowed = false }) {
    const failures = [];
    for (const operation of changeset.operations) {
      if (["delete", "bulk-close", "unlink-all"].includes(operation.action) && !destructiveAllowed) {
        failures.push(`destructive operation disabled by default: ${operation.operation_id} (§29.2)`);
      }
      if (operation.action === "create") {
        const type = schema.issue_types.find((entry) => entry.name === operation.target?.work_type);
        if (!type) failures.push(`unknown issue type for ${operation.operation_id}: ${operation.target?.work_type}`);
        if (!operation.idempotency_key) failures.push(`create without idempotency key: ${operation.operation_id} (§29.4)`);
      }
      if (operation.action === "update" && !operation.preconditions?.revision) {
        failures.push(`update without a revision precondition: ${operation.operation_id} (§29.4)`);
      }
    }
    return { valid: failures.length === 0, failures };
  }

  /** changeset preview: exact connection, project, items, and operations (§37). */
  preview(changeset) {
    return {
      connection: changeset.connection,
      project: this.#mapping.projectKey,
      mapping_version: this.#mapping.version,
      write_mode: this.#writeMode,
      operations: changeset.operations.map((operation) => ({
        operation_id: operation.operation_id,
        action: operation.action,
        target: operation.target ?? operation.source ?? null,
        summary: operation.fields?.summary ?? operation.relation ?? null
      }))
    };
  }

  /** Reconcile an uncertain create by its idempotency identity (§29.4). */
  async reconcileCreate(operation) {
    const jql = encodeURIComponent(`project = ${this.#mapping.projectKey}`);
    let startAt = 0;
    for (;;) {
      const search = await this.#request("GET", `/rest/api/3/search?jql=${jql}&properties=${IDEMPOTENCY_PROPERTY}&startAt=${startAt}`);
      if (search.status !== 200) throw new ConnectorError("reconciliation search failed", "external-write-uncertain");
      const issues = search.body.issues ?? [];
      for (const issue of issues) {
        if (issue.properties?.[IDEMPOTENCY_PROPERTY]?.key === operation.idempotency_key) {
          return { found: true, item_id: issue.key, provider_item_id: issue.id };
        }
      }
      const total = search.body.total ?? issues.length;
      startAt += issues.length;
      // Every page must be inspected before concluding the create is absent (§29.4).
      if (issues.length === 0 || startAt >= total) return { found: false };
    }
  }

  /**
   * apply: the §29.1 write sequence over one approved changeset. Returns
   * per-operation statuses and receipts; resumable without duplicating
   * verified operations (§29.5).
   */
  async applyChangeset(changeset, { approval, automationPolicy, actor = null, priorResults = {} } = {}) {
    if (this.#writeMode === "read-only") throw new ConnectorError("write mode is read-only", "policy-violation");
    if (this.#writeMode === "propose") {
      return { applied: false, preview: this.preview(changeset), reason: "propose mode generates changesets without applying (§29.2)" };
    }
    if (this.#writeMode === "approve-each-batch" && approval?.status !== "approved") {
      throw new ConnectorError("changeset requires human batch approval before apply (§29.2)", "approval-required");
    }
    if (this.#writeMode === "approved-automation") {
      // §29.2 — pre-authorized operations apply only within DECLARED policy and scope.
      if (!automationPolicy?.id || !Array.isArray(automationPolicy.allowedActions)) {
        throw new ConnectorError("approved-automation requires a declared automation policy (§29.2)", "approval-required");
      }
      for (const operation of changeset.operations) {
        if (!automationPolicy.allowedActions.includes(operation.action)) {
          throw new ConnectorError(`operation ${operation.operation_id} (${operation.action}) is outside the automation policy scope (§29.2)`, "policy-violation");
        }
      }
      if (automationPolicy.maxOperations !== undefined && changeset.operations.length > automationPolicy.maxOperations) {
        throw new ConnectorError("changeset exceeds the automation policy operation bound (§29.2)", "policy-violation");
      }
    }
    this.#actor = actor;

    const results = { ...priorResults };
    const receipts = [];
    for (const operation of changeset.operations) {
      if (results[operation.operation_id]?.status === "verified") {
        receipts.push(results[operation.operation_id].receipt);
        continue; // §29.5 — never duplicate verified operations.
      }
      try {
        const receipt = await this.#applyOperation(changeset, operation);
        results[operation.operation_id] = { status: "verified", receipt };
        receipts.push(receipt);
      } catch (error) {
        results[operation.operation_id] = {
          status: error.category === "external-write-uncertain" ? "uncertain" : "failed",
          error: { message: error.message, category: error.category ?? "external-write-failed" }
        };
        // Stop at the first failure; the batch reports every remaining
        // operation as not-started (§29.5).
        for (const remaining of changeset.operations) {
          if (!results[remaining.operation_id]) results[remaining.operation_id] = { status: "not-started" };
        }
        return { applied: false, results, receipts };
      }
    }
    return { applied: true, results, receipts };
  }

  async #applyOperation(changeset, operation) {
    if (operation.action === "create") return this.#applyCreate(changeset, operation);
    if (operation.action === "update") return this.#applyUpdate(changeset, operation);
    if (operation.action === "link") return this.#applyLink(changeset, operation);
    if (operation.action === "comment") return this.#applyComment(changeset, operation);
    if (operation.action === "transition") return this.#applyTransition(changeset, operation);
    throw new ConnectorError(`unsupported operation action: ${operation.action}`, "provider-capability-unavailable");
  }

  async #verifyReadback(itemId, expectedFields, extra = {}) {
    const readBack = await this.pull(itemId);
    const normalized = this.normalize(readBack);
    const expected = readbackHash(expectedFields, { version: this.#mapping.version, fields: this.#mapping.fields });
    const actual = readbackHash(normalized.fields, { version: this.#mapping.version, fields: this.#mapping.fields });
    if (expected.hash !== actual.hash) {
      throw new ConnectorError(`read-back verification failed for ${itemId}`, "external-write-uncertain");
    }
    return { readback_hash: actual.hash, after_revision: readBack.revision, ...extra };
  }

  async #applyCreate(changeset, operation) {
    // Before retrying an uncertain create, reconcile by identity (§29.4):
    // a missing local receipt never proves the external write failed.
    const existing = await this.reconcileCreate(operation);
    let itemId;
    let requestId = null;
    if (existing.found) {
      itemId = existing.item_id;
    } else {
      let response;
      try {
        response = await this.#request("POST", "/rest/api/3/issue", {
          fields: { project: { key: this.#mapping.projectKey }, issuetype: { name: operation.target.work_type }, ...operation.fields },
          properties: [{ key: IDEMPOTENCY_PROPERTY, value: { key: operation.idempotency_key, artifact: operation.artifact } }]
        });
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        // A thrown network error mid-create means the outcome is UNKNOWN (§29.4).
        throw new ConnectorError(`create outcome unknown for ${operation.operation_id}: ${error.message}`, "external-write-uncertain");
      }
      if (response.status === undefined || response.timeout) {
        throw new ConnectorError(`create outcome unknown for ${operation.operation_id}`, "external-write-uncertain");
      }
      if (response.status !== 201) throw new ConnectorError(`create failed: HTTP ${response.status}`, "external-write-failed");
      itemId = response.body.key;
      requestId = response.headers?.["x-arequestid"] ?? null;
    }
    const verification = await this.#verifyReadback(itemId, operation.fields ?? {});
    return this.#receipt(changeset, operation, {
      external_target: itemId, before_revision: null, result: existing.found ? "reconciled-existing" : "created",
      provider_request_id: requestId, ...verification
    });
  }

  async #applyUpdate(changeset, operation) {
    const current = await this.pull(operation.target);
    if (String(current.revision) !== String(operation.preconditions.revision)) {
      throw new ConnectorError(`revision precondition failed for ${operation.target}: ${current.revision} != ${operation.preconditions.revision}`, "provider-conflict");
    }
    const response = await this.#request("PUT", `/rest/api/3/issue/${operation.target}`, { fields: operation.fields });
    if (response.status !== 204) throw new ConnectorError(`update failed: HTTP ${response.status}`, "external-write-failed");
    const merged = { ...this.normalize(current).fields, ...operation.fields };
    const verification = await this.#verifyReadback(operation.target, merged);
    return this.#receipt(changeset, operation, {
      external_target: operation.target, before_revision: current.revision, result: "updated", ...verification
    });
  }

  async #applyLink(changeset, operation) {
    const response = await this.#request("POST", "/rest/api/3/issueLink", {
      type: { name: operation.relation }, inwardIssue: { key: operation.source_item }, outwardIssue: { key: operation.target_item }
    });
    if (response.status !== 201) throw new ConnectorError(`link failed: HTTP ${response.status}`, "external-write-failed");
    return this.#receipt(changeset, operation, {
      external_target: `${operation.source_item}->${operation.target_item}`, before_revision: null,
      result: "linked", readback_hash: null, after_revision: null
    });
  }

  async #applyComment(changeset, operation) {
    const response = await this.#request("POST", `/rest/api/3/issue/${operation.target}/comment`, { body: operation.fields.body });
    if (response.status !== 201) throw new ConnectorError(`comment failed: HTTP ${response.status}`, "external-write-failed");
    return this.#receipt(changeset, operation, {
      external_target: operation.target, before_revision: null, result: "commented",
      readback_hash: null, after_revision: null, provider_comment_id: response.body.id
    });
  }

  async #applyTransition(changeset, operation) {
    // §30 — status changes go through the transitions endpoint, never field updates.
    const available = await this.#request("GET", `/rest/api/3/issue/${operation.target}/transitions`);
    if (available.status !== 200) throw new ConnectorError(`transition discovery failed for ${operation.target}`, "provider-capability-unavailable");
    const match = (available.body.transitions ?? []).find((entry) => entry.to?.name === operation.fields.status || entry.name === operation.fields.status);
    if (!match) throw new ConnectorError(`no transition reaches status ${operation.fields.status}`, "provider-capability-unavailable");
    const response = await this.#request("POST", `/rest/api/3/issue/${operation.target}/transitions`, { transition: { id: match.id } });
    if (response.status !== 204) throw new ConnectorError(`transition failed: HTTP ${response.status}`, "external-write-failed");
    return this.#receipt(changeset, operation, {
      external_target: operation.target, before_revision: null, result: `transitioned:${match.id}`,
      readback_hash: null, after_revision: null
    });
  }

  /** §33.2 — receipts with redacted failure details and revision identity. */
  #receipt(changeset, operation, details) {
    return Object.freeze({
      schema_version: "rdlc.receipt/v0.2",
      id: mintIdentity(),
      changeset: changeset.id,
      operation_id: operation.operation_id,
      connection: changeset.connection,
      mapping_version: this.#mapping.version,
      actor: this.#actor,
      warnings: details.warnings ?? [],
      at: this.#now(),
      ...details
    });
  }

  /* -------------------------------------------------- polling and cursors */

  /**
   * poll: bounded incremental synchronization (§29.6). The cursor advances
   * atomically with persistence of the page it covers and never past a
   * failed or unpersisted page.
   */
  /** Derive a valid JQL `updated >=` operand ("yyyy-MM-dd HH:mm") from a provider revision. */
  static jqlWatermark(revision, fallback) {
    // Only ISO-dated revisions may move the watermark; an id-fallback revision
    // must never corrupt it (review residual: year-99999 watermark).
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(revision))) return fallback;
    const parsed = new Date(String(revision).replace(" ", "T"));
    if (Number.isNaN(parsed.getTime())) return fallback;
    const pad = (value) => String(value).padStart(2, "0");
    return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}`;
  }

  async poll(cursor, { persist }) {
    if (!persist) throw new ConnectorError("cursor advancement requires a persistence callback (§29.6)", "unrecoverable-configuration");
    const watermark = cursor.watermark ?? "1970-01-01 00:00";
    const jql = encodeURIComponent(`project = ${this.#mapping.projectKey} AND updated >= "${watermark}" ORDER BY updated ASC`);
    let seen = new Set(cursor.seen ?? []);
    let startAt = cursor.startAt ?? 0;
    let working = { ...cursor, last_attempted_at: this.#now() };
    const collected = [];
    let lastRevision = null;
    for (;;) {
      const response = await this.#request("GET", `/rest/api/3/search?jql=${jql}&startAt=${startAt}`);
      if (response.status === 410 || response.body?.errorMessages?.some((message) => /expired/i.test(message))) {
        // Expired provider token: safe rescan from the declared recovery boundary.
        const recovered = { ...working, startAt: 0, watermark: cursor.recovery_boundary ?? "1970-01-01 00:00", failure_state: "token-expired-rescan" };
        await persist({ cursor: recovered, items: [] });
        return { items: [], cursor: recovered, rescan: true };
      }
      if (response.status !== 200) {
        // The cursor does NOT advance past the failed page; already-persisted
        // pages stay persisted (§29.6 atomic per-page advancement).
        const failed = { ...working, startAt, watermark: working.watermark ?? watermark, failure_state: `page-failed:${response.status}` };
        await persist({ cursor: failed, items: [] });
        throw new ConnectorError(`poll page failed: HTTP ${response.status}`, "external-write-failed");
      }
      const issues = response.body.issues ?? [];
      const items = issues.map((issue) => ({
        item_id: issue.key, provider_item_id: issue.id, revision: String(issue.fields?.updated ?? issue.id)
      }));
      // Dedup by immutable identity + revision, never timestamps alone (§29.6).
      const fresh = items.filter((item) => !seen.has(`${item.provider_item_id}@${item.revision}`));
      for (const item of fresh) seen.add(`${item.provider_item_id}@${item.revision}`);
      if (items.length) lastRevision = items.at(-1).revision;
      collected.push(...fresh);
      const total = response.body.total ?? (startAt + items.length);
      startAt += items.length;
      const morePages = items.length > 0 && startAt < total;
      // Retain seen entries that remain re-queryable under the inclusive
      // watermark so eviction never re-emits boundary items.
      const nextWatermark = morePages ? watermark : (lastRevision ? JiraConnector.jqlWatermark(lastRevision, watermark) : watermark);
      working = {
        ...working,
        startAt: morePages ? startAt : 0,
        watermark: nextWatermark,
        seen: (() => {
          const entries = [...seen];
          if (entries.length <= 10000) return entries;
          return entries.filter((entry) => entry.split("@")[1] >= nextWatermark).slice(-10000);
        })(),
        last_success_at: this.#now(),
        failure_state: null
      };
      await persist({ cursor: working, items: fresh });
      if (!morePages) break;
    }
    return { items: collected, cursor: working, rescan: false };
  }

  /** Full reconciliation refreshes every mapped item from a clean boundary (§29.6). */
  async fullReconciliation({ persist }) {
    const result = await this.poll({ watermark: "1970-01-01 00:00", startAt: 0, seen: [] }, { persist });
    return { ...result, cursor: { ...result.cursor, last_full_reconciliation_at: this.#now() } };
  }
}

/** Replay transport for recorded sanitized fixtures (§44.4). */
export function recordedTransport(recording) {
  const remaining = [...recording];
  return async ({ method, path, body }) => {
    const index = remaining.findIndex((entry) => entry.method === method && entry.path === path);
    if (index === -1) throw new ConnectorError(`no recorded response for ${method} ${path}`, "provider-capability-unavailable");
    const [entry] = remaining.splice(index, 1);
    if (entry.expectBody) {
      const expected = JSON.stringify(entry.expectBody);
      const actual = JSON.stringify(body ?? null);
      if (expected !== actual) throw new ConnectorError(`recorded request body mismatch for ${method} ${path}`, "validation-failure");
    }
    return entry.response;
  };
}
