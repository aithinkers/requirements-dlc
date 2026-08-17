import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const READ_ONLY = ["requirements-reviewer", "compliance-reviewer", "traceability-auditor"];

test("FEAT-025: kiro agent manifests carry agent-v1 confinement and resources (#58)", async () => {
  for (const host of ["kiro", "kiro-ide"]) {
    const directory = `distribution/${host}/.kiro/agents`;
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json"))) {
      const manifest = JSON.parse(await readFile(join(directory, file), "utf8"));
      assert.match(manifest.$schema ?? "", /agent-v1\.json$/, `${host}/${file} declares the schema`);
      assert.match(manifest.prompt, /^file:\/\//, `${host}/${file} prompt is file://`);
      assert.ok(Array.isArray(manifest.resources) && manifest.resources.length > 0, `${host}/${file} loads resources`);
      const readOnly = READ_ONLY.some((id) => manifest.name === `rdlc-${id}`);
      if (readOnly) {
        assert.deepEqual(manifest.tools, ["fs_read", "thinking"], `${manifest.name} is read-only`);
        assert.equal(manifest.toolsSettings, undefined);
      } else {
        assert.deepEqual(manifest.toolsSettings.fs_write.allowedPaths, ["rdlc/**", "config/**"], `${manifest.name} confines writes`);
        const denied = manifest.toolsSettings.execute_bash.deniedCommands;
        assert.ok(denied.some((rule) => new RegExp(`^(?:${rule})$`).test("rm subdir --recursive")), `${manifest.name} denies long-form recursive delete`);
        assert.ok(denied.some((rule) => new RegExp(`^(?:${rule})$`).test("git push origin main")), `${manifest.name} denies git push`);
      }
    }
    // The front door exists and carries the start procedure.
    const door = JSON.parse(await readFile(join(directory, "rdlc.json"), "utf8"));
    assert.equal(door.name, "rdlc");
    assert.match(await readFile(join(directory, "rdlc.md"), "utf8"), /start/i);
  }
});

test("FEAT-025: kiro-ide hooks are dual-registered for both IDE generations (#58)", async () => {
  const hooks = "distribution/kiro-ide/.kiro/hooks";
  for (const name of ["rdlc-orient", "rdlc-guard"]) {
    const legacy = JSON.parse(await readFile(join(hooks, `${name}.kiro.hook`), "utf8"));
    assert.equal(legacy.enabled, true);
    assert.equal(legacy.then.command, `node .kiro/hooks/${name}.mjs`);
    const modern = JSON.parse(await readFile(join(hooks, `${name}.json`), "utf8"));
    assert.equal(modern.version, "v1");
    assert.equal(modern.hooks[0].action.command, `node .kiro/hooks/${name}.mjs`);
  }
  assert.equal(JSON.parse(await readFile(join(hooks, "rdlc-guard.json"), "utf8")).hooks[0].trigger, "PreToolUse");
  assert.equal(JSON.parse(await readFile(join(hooks, "rdlc-orient.json"), "utf8")).hooks[0].trigger, "UserPromptSubmit");
});

test("FEAT-025: the kiro-ide guard blocks governed paths on both payload channels and fails open otherwise (#58)", async () => {
  const guard = join(process.cwd(), "distribution/kiro-ide/.kiro/hooks/rdlc-guard.mjs");
  const run = (payload, env = {}) => {
    try {
      execFileSync("node", [guard], { input: payload, stdio: ["pipe", "pipe", "pipe"], timeout: 10_000, env: { ...process.env, ...env } });
      return { code: 0, stderr: "" };
    } catch (error) {
      return { code: error.status, stderr: String(error.stderr) };
    }
  };
  // 1.x channel: snake_case stdin JSON.
  const modern = run(JSON.stringify({ tool_name: "fs_write", tool_input: { file_path: "rdlc/spaces/main/engagements/e1/approvals/pkg.yaml" } }));
  assert.equal(modern.code, 2);
  assert.match(modern.stderr, /audit trail/);
  // 0.12 channel: USER_PROMPT camelCase, stdin never written (empty here).
  const legacy = run("", { USER_PROMPT: JSON.stringify({ toolName: "fs_write", toolArgs: { path: "rdlc/reference/stage-protocol.md" } }) });
  assert.equal(legacy.code, 2);
  assert.match(legacy.stderr, /shared playbook/);
  // Path smuggling normalizes before matching.
  assert.equal(run(JSON.stringify({ tool_name: "fs_write", tool_input: { file_path: "rdlc//spaces/x/engagements/y/baselines/b.yaml" } })).code, 2);
  // Ungoverned paths and unknown payloads fail open.
  assert.equal(run(JSON.stringify({ tool_name: "fs_write", tool_input: { file_path: "src/app.mjs" } })).code, 0);
  assert.equal(run("not json").code, 0);
});
