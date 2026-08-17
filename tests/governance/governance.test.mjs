import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  protectedHarnessFiles,
  protectedHarnessScripts,
  readJson,
  validateAgainstSchema,
  validateEvidencePaths,
  validateHarnessIntegrity
} from "../../scripts/governance-validation.mjs";
import { validateIssueBody, validatePullRequest } from "../../scripts/verify-pr-traceability.mjs";

test("FEAT-001: traceability index validates against its schema", async () => {
  const [document, schema] = await Promise.all([
    readJson("docs/traceability.json"),
    readJson("docs/traceability.schema.json")
  ]);
  assert.deepEqual(validateAgainstSchema(document, schema), []);
  assert.equal(document.specification.name, "R-DLC");
  assert.equal(document.specification.version, "0.2.0");
});

test("FEAT-001: every traceability evidence path is a tracked repository file", async () => {
  const traceability = await readJson("docs/traceability.json");
  assert.deepEqual(await validateEvidencePaths(traceability), []);
});

test("FEAT-001: agent workflow declares the five ordered gates", async () => {
  const workflow = await readJson("development/agent-workflow.json");
  assert.deepEqual(
    workflow.gates.map(({ id }) => id),
    ["feature-definition", "plan-review", "development", "testing", "final-review"]
  );
});

test("FEAT-001: protected harness files exist and are tracked", async () => {
  assert.ok(protectedHarnessFiles.includes("scripts/governance-validation.mjs"));
  assert.ok(protectedHarnessScripts.includes("test"));
  for (const path of protectedHarnessFiles) {
    await readFile(path, "utf8");
  }
});

test("FEAT-001: harness integrity passes against itself and fails on drift", async () => {
  assert.deepEqual(await validateHarnessIntegrity(process.cwd(), process.cwd()), []);
});

test("FEAT-001: specification baseline hash matches the committed specification", async () => {
  const { createHash } = await import("node:crypto");
  const spec = await readFile("docs/requirements-development-lifecycle-specification.md");
  const baseline = await readFile("docs/specification-baseline.md", "utf8");
  const digest = createHash("sha256").update(spec).digest("hex");
  assert.ok(baseline.includes(digest), `baseline must record spec SHA-256 ${digest}`);
});

test("FEAT-001: pull request validation enforces branch, closes, ids, and commits", () => {
  const traceability = {
    requirements: [{ id: "FEAT-001", issue: 1 }]
  };
  const good = validatePullRequest({
    body: "Closes #1\n- Requirement IDs: FEAT-001\nSee §12 for details.\nCommands and results:\n```text\nnpm test -> pass\n```",
    head: "chore/1-governance-bootstrap",
    traceability,
    commitSubjects: ["chore: bootstrap governance harness (#1) [FEAT-001]"]
  });
  assert.deepEqual(good.failures, []);

  const bad = validatePullRequest({
    body: "no closing reference",
    head: "main",
    traceability,
    commitSubjects: []
  });
  assert.ok(bad.failures.length >= 3);
});

test("FEAT-001: issue body validation requires the three governed sections", () => {
  const failures = validateIssueBody(
    {
      number: 1,
      body: "## Requirement\nx\n## Specification trace\n§12\n## Acceptance criteria\n- [ ] one"
    },
    1
  );
  assert.deepEqual(failures, []);
  assert.ok(validateIssueBody({ number: 1, body: "" }, 1).length >= 3);
});

test("FEAT-027: npx can determine the executable — a bin matches the package name (#62)", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  // With multiple bins, npx github:<repo> only works when one bin matches
  // the package name; this locks the documented zero-install path.
  assert.equal(pkg.bin[pkg.name], "./scripts/setup.mjs");
});
