import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runSensors } from "../../core/lib/sensors.mjs";
import { runSetup } from "../../scripts/setup.mjs";
import { checkpoint, createEngagement } from "../../core/lib/engagement.mjs";
import { mintIdentity } from "../../core/lib/identity.mjs";

const quiet = () => {};
const actor = mintIdentity();

async function installedProject() {
  const target = await mkdtemp(join(tmpdir(), "rdlc-hr-"));
  await runSetup({ target, log: quiet });
  return target;
}

test("FEAT-020: sensors speak human — headlines, next commands, no rule codes at the surface", async () => {
  const target = await installedProject();
  const { results, summary, ok } = await runSensors(target);
  assert.equal(ok, true);
  for (const entry of results) {
    assert.ok(entry.headline.length > 15, entry.sensor);
    assert.ok(!/RDLC-[A-Z]+-\d+/.test(entry.headline), `${entry.sensor} headline has no rule codes`);
    assert.ok(!/Error:|stack/i.test(entry.headline), entry.sensor);
  }
  assert.match(summary, /Everything checks out/);

  // A broken artifact produces a plain-language failure with a next step.
  const artifactDir = join(target, "rdlc", "spaces", "main", "engagements", "e1", "artifacts", "requirements");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "req-1.yaml"), "schema_version: rdlc.artifact/v0.2\nid: not-a-urn\n", "utf8");
  await writeFile(join(artifactDir, "story-1.yaml"), "type: story\nstatement: incomplete\n", "utf8");
  const broken = await runSensors(target);
  assert.equal(broken.ok, false);
  const schema = broken.results.find((entry) => entry.sensor === "schema");
  assert.equal(schema.ok, false);
  assert.match(schema.headline, /can't be used reliably/);
  assert.equal(schema.next_command, "/rdlc-doctor");
  const template = broken.results.find((entry) => entry.sensor === "template-catalog");
  assert.equal(template.ok, false);
  assert.match(template.headline, /missing expected content/);
  assert.ok(!/required field missing:/.test(template.headline), "raw failure text stays in details");
});

test("FEAT-020: the state sensor reports interruption and uncertain writes in plain language", async () => {
  const target = await installedProject();
  const directory = join(target, "rdlc", "spaces", "main", "engagements", "e1");
  await mkdir(directory, { recursive: true });
  let state = createEngagement({ project: "p", space: "main", scope: "standard", host: "claude-code", session: "s", actor, at: "2026-08-16T10:00:00.000Z" });
  state = { ...state, uncertain_writes: [{ changeset: "c1", operation_id: "op-1" }] };
  await checkpoint(state, directory, { at: "2026-08-16T10:00:00.000Z" });
  const withUncertain = await runSensors(target, { names: ["state"] });
  assert.match(withUncertain.results[0].headline, /unknown outcome/);
  assert.equal(withUncertain.results[0].next_command, "/rdlc-sync");

  // Tamper -> interruption message, no stack trace.
  const statePath = join(directory, "rdlc-state.yaml");
  await writeFile(statePath, (await readFile(statePath, "utf8")).replace("standard", "tampered"), "utf8");
  const interrupted = await runSensors(target, { names: ["state"] });
  assert.equal(interrupted.results[0].ok, false);
  assert.match(interrupted.results[0].headline, /interrupted mid-save/);
});

test("FEAT-020: the rdlc-sensors bin prints friendly output and exits by health", async () => {
  const target = await installedProject();
  const output = execFileSync("node", ["scripts/run-sensors.mjs", "--target", target], { encoding: "utf8" });
  assert.match(output, /✓ .*well-formed/);
  assert.match(output, /Everything checks out/);
});

test("FEAT-020: the write guard blocks evidence edits with a plain explanation; orient prints the one-liner", async () => {
  const target = await installedProject();
  const guard = (path) => {
    try {
      execFileSync("node", [join(target, "rdlc", "hooks", "guard.mjs")], { input: JSON.stringify({ tool_input: { file_path: path } }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return { blocked: false };
    } catch (error) {
      return { blocked: true, message: String(error.stderr) };
    }
  };
  const blocked = guard(join(target, "rdlc", "spaces", "main", "engagements", "e1", "approvals", "pkg.yaml"));
  assert.equal(blocked.blocked, true);
  assert.match(blocked.message, /audit trail/);
  assert.match(blocked.message, /\/rdlc-approve/);
  assert.equal(guard(join(target, "rdlc", "reference", "stage-protocol.md")).blocked, true);
  assert.equal(guard(join(target, "docs", "notes.md")).blocked, false);

  // Orient: silent outside R-DLC projects, informative inside.
  const directory = join(target, "rdlc", "spaces", "main", "engagements", "e1");
  await mkdir(directory, { recursive: true });
  await checkpoint({ ...createEngagement({ project: "p", space: "main", scope: "quick", host: "claude-code", session: "s", actor, at: "t" }), next_action: "answer the open question" }, directory, { at: "t" });
  const oriented = execFileSync("node", [join(target, "rdlc", "hooks", "orient.mjs")], { cwd: target, encoding: "utf8" });
  assert.match(oriented, /quick scope/);
  assert.match(oriented, /answer the open question/);
  const outside = execFileSync("node", [join(target, "rdlc", "hooks", "orient.mjs")], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(outside.trim(), "");
});

test("FEAT-020: settings merge adds our hooks once and never disturbs foreign hooks", async () => {
  const target = await mkdtemp(join(tmpdir(), "rdlc-hooks-"));
  await mkdir(join(target, ".claude"), { recursive: true });
  await writeFile(join(target, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-own-guard.sh" }] }] }
  }, null, 2), "utf8");
  await runSetup({ target, log: quiet });
  const settings = JSON.parse(await readFile(join(target, ".claude", "settings.json"), "utf8"));
  assert.ok(JSON.stringify(settings).includes("my-own-guard.sh"), "foreign hooks preserved");
  assert.ok(JSON.stringify(settings).includes("rdlc/hooks/guard.mjs"));
  assert.ok(JSON.stringify(settings).includes("rdlc/hooks/orient.mjs"));
  // Idempotent: second run adds nothing.
  await runSetup({ target, log: quiet });
  const again = JSON.parse(await readFile(join(target, ".claude", "settings.json"), "utf8"));
  assert.equal(JSON.stringify(again).split("rdlc/hooks/guard.mjs").length, 2, "exactly one guard entry");
});

test("FEAT-020: memory templates scaffold once and user edits survive re-runs", async () => {
  const target = await installedProject();
  const memory = join(target, "rdlc", "spaces", "main", "memory", "team.md");
  assert.match(await readFile(memory, "utf8"), /Estimation culture/);
  await writeFile(memory, "# Team memory\nWe are night owls.\n", "utf8");
  await runSetup({ target, log: quiet });
  assert.match(await readFile(memory, "utf8"), /night owls/, "memory is user content after scaffold");
});

test("FEAT-020: upgrades apply cleanly to untouched files; user edits stay protected (install manifest)", async () => {
  const target = await installedProject();
  const manifest = JSON.parse(await readFile(join(target, "rdlc", ".install-manifest.json"), "utf8"));
  assert.ok(Object.keys(manifest.files).length > 40);

  // Simulate an older install of one file: content differs from the new
  // version but matches what the manifest says was installed.
  const protocolPath = join(target, "rdlc", "reference", "stage-protocol.md");
  const old = "# R-DLC stage protocol (older release)\n";
  await writeFile(protocolPath, old, "utf8");
  const { createHash } = await import("node:crypto");
  manifest.files["rdlc/reference/stage-protocol.md"] = createHash("sha256").update(Buffer.from(old)).digest("hex");
  await writeFile(join(target, "rdlc", ".install-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const upgrade = await runSetup({ target, log: quiet });
  assert.ok((upgrade.upgraded ?? []).includes(join("rdlc", "reference", "stage-protocol.md")), "untouched old version upgraded without --force");
  assert.match(await readFile(protocolPath, "utf8"), /R-DLC stage protocol\n/, "new content applied");

  // A genuine user edit is still protected.
  await writeFile(protocolPath, "my custom protocol", "utf8");
  const protectedRun = await runSetup({ target, log: quiet });
  assert.ok(protectedRun.protected.includes(join("rdlc", "reference", "stage-protocol.md")));
  assert.equal(await readFile(protocolPath, "utf8"), "my custom protocol");
});

test("FEAT-020: stage guides ship for every ALWAYS stage in plain language", async () => {
  const target = await installedProject();
  const graph = JSON.parse(await readFile(join(target, "rdlc", "reference", "stages.json"), "utf8"));
  for (const stage of graph.stages.filter((entry) => entry.condition === "ALWAYS")) {
    const guide = await readFile(join(target, "rdlc", "reference", "stages", `${stage.slug}.md`), "utf8");
    assert.match(guide, /Why this stage exists/, stage.slug);
    assert.match(guide, /Done when/, stage.slug);
    assert.ok(!/SHALL|MUST NOT|§\d/.test(guide), `${stage.slug} guide avoids spec legalese`);
  }
});

test("FEAT-020: review fixes — guard normalization, graceful settings shapes, exact-command idempotence, neutral orient", async () => {
  const target = await installedProject();
  const guard = (path) => {
    try {
      execFileSync("node", [join(target, "rdlc", "hooks", "guard.mjs")], { input: JSON.stringify({ tool_input: { file_path: path } }), stdio: ["pipe", "pipe", "pipe"] });
      return false;
    } catch { return true; }
  };
  assert.equal(guard("rdlc/./spaces/main/engagements/e1/approvals/a.yaml"), true, "dot-hop blocked");
  assert.equal(guard("rdlc//spaces//main//engagements//e1//baselines//b.yaml"), true, "double-slash blocked");
  assert.equal(guard("rdlc\\reference\\stage-protocol.md"), true, "backslash blocked");

  // Wrong-shaped hooks degrade with an actionable note, no crash.
  const weird = await mkdtemp(join(tmpdir(), "rdlc-weird-"));
  await mkdir(join(weird, ".claude"), { recursive: true });
  await writeFile(join(weird, ".claude", "settings.json"), JSON.stringify({ hooks: "oops" }), "utf8");
  const degraded = await runSetup({ target: weird, log: quiet });
  assert.match(degraded.hooks_skipped, /couldn't be updated automatically/);
  assert.equal(JSON.parse(await readFile(join(weird, ".claude", "settings.json"), "utf8")).hooks, "oops", "untouched");

  // A user hook merely MENTIONING our command doesn't suppress the real merge.
  const mention = await mkdtemp(join(tmpdir(), "rdlc-mention-"));
  await mkdir(join(mention, ".claude"), { recursive: true });
  await writeFile(join(mention, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo node rdlc/hooks/guard.mjs" }] }] }
  }), "utf8");
  await runSetup({ target: mention, log: quiet });
  const merged = JSON.parse(await readFile(join(mention, ".claude", "settings.json"), "utf8"));
  const commands = merged.hooks.PreToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command));
  assert.ok(commands.includes("node rdlc/hooks/guard.mjs"), "real guard installed despite the mention");

  // Orient falls back to a neutral line on garbled state.
  const directory = join(target, "rdlc", "spaces", "main", "engagements", "weird");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "rdlc-state.yaml"), "active_stage: '{{{'\nupdated_at: 2026-08-16T12:00:00Z\n", "utf8");
  const oriented = execFileSync("node", [join(target, "rdlc", "hooks", "orient.mjs")], { cwd: target, encoding: "utf8" });
  assert.ok(!oriented.includes("{{{"), "garbage never reaches the session line");
  assert.ok(!/\bnull\b/.test(oriented), "no literal null");
});
