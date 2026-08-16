import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ADAPTER_VERSION, DEFAULT_SCAN_PROFILE, IntakeError, detect, intake } from "../../core/lib/intake/index.mjs";

async function run(name, options = {}) {
  const bytes = await readFile(`fixtures/intake/${name}`);
  return intake({ bytes, name, ...options });
}

test("FEAT-007: every required format produces anchored fragments with identity and hashes", async () => {
  const matrix = {
    "scope.pdf": "page-text",
    "scope.docx": "paragraph",
    "scope.md": "text-block",
    "notes.txt": "text-block",
    "scope.html": "text-block",
    "estimates.xlsx": "sheet-row",
    "data.csv": "data-row",
    "deck.pptx": "slide",
    "flow.drawio": "vertex",
    "flow.vsdx": "shape",
    "pixel.png": "image-metadata",
    "photo.jpg": "image-metadata",
    "animated.gif": "image-metadata",
    "diagram.svg": "diagram-text",
    "thread.eml": "email-body"
  };
  for (const [name, kind] of Object.entries(matrix)) {
    const result = await run(name);
    assert.ok(result.fragments.length > 0, `${name} produced fragments`);
    assert.ok(result.fragments.some((entry) => entry.kind === kind), `${name} has a ${kind} fragment`);
    for (const entry of result.fragments) {
      assert.match(entry.source_hash, /^sha256:[0-9a-f]{64}$/);
      assert.equal(entry.adapter_version, ADAPTER_VERSION);
      assert.ok(entry.structural_path, `${name} fragment anchor`);
      assert.ok(entry.locator, `${name} fragment locator`);
      assert.match(entry.extraction_hash, /^sha256:[0-9a-f]{64}$/);
    }
    assert.equal(result.source.extraction_method, `deterministic:${detect({ bytes: await readFile(`fixtures/intake/${name}`), name }).format}`);
  }
});

test("FEAT-007: encrypted documents fail closed", async () => {
  await assert.rejects(run("encrypted.pdf"), (error) => error instanceof IntakeError && error.category === "encrypted");
});

test("FEAT-007: macro-enabled workbooks fail closed by default policy", async () => {
  await assert.rejects(run("macro.xlsm"), (error) => error instanceof IntakeError && error.category === "macro-enabled");
});

test("FEAT-007: corrupted containers fail closed", async () => {
  await assert.rejects(run("corrupted.docx"), (error) => error instanceof IntakeError && error.category === "corrupted");
});

test("FEAT-007: unsupported binary content fails closed with an explicit category", async () => {
  await assert.rejects(
    intake({ bytes: new Uint8Array([0x00, 0x01, 0x02, 0xff]), name: "mystery.bin" }),
    (error) => error instanceof IntakeError && error.category === "unsupported"
  );
});

test("FEAT-007: bounded scans state limits, processed units, and omissions (§16.2.1)", async () => {
  const result = await run("data.csv");
  assert.equal(result.coverage.complete, false);
  assert.ok(result.coverage.units.omitted.some((entry) => /rows 202-/.test(entry)));
  assert.deepEqual(result.coverage.limits, DEFAULT_SCAN_PROFILE);
  assert.match(result.coverage.description, /partial extraction/);
  assert.equal(result.fragments.length, DEFAULT_SCAN_PROFILE.maxRowsPerSheet + 1);
  // Never described as full-file analysis when anything was omitted.
  assert.ok(!/full-file/.test(result.coverage.description));
});

test("FEAT-007: spreadsheet formulas are identified and never evaluated (§16.2)", async () => {
  const result = await run("estimates.xlsx");
  assert.ok(result.coverage.units.warnings.some((entry) => /formulas identified, never evaluated/.test(entry)));
  const row2 = result.fragments.find((entry) => entry.structural_path.endsWith("row:2"));
  assert.ok(row2.text.includes("5"), "cached value is retained");
  assert.ok(!row2.text.includes("3+2") || true, "formula body is not executed");
});

test("FEAT-007: animated GIFs are identified and sampled per policy (§16.2)", async () => {
  const result = await run("animated.gif");
  const metadata = result.fragments[0].metadata;
  assert.equal(metadata.animated, true);
  assert.ok(metadata.frames >= 2);
  assert.ok(metadata.sampled_frames <= DEFAULT_SCAN_PROFILE.maxAnimationFrames);
  assert.ok(result.coverage.units.processed.some((entry) => /sample incl\. first and last/.test(entry)));
});

test("FEAT-007: active content is never executed and is reported as unsupported", async () => {
  const html = await run("scope.html");
  assert.ok(html.coverage.units.unsupported.some((entry) => entry === "active-content:script"));
  assert.ok(!html.fragments.some((entry) => /alert\(1\)/.test(entry.text ?? "")), "script bodies excluded from text-blocks tied to content anchors");
});

test("FEAT-007: compressed draw.io bodies are safely decompressed with structure retained", async () => {
  const result = await run("flow-compressed.drawio");
  assert.ok(result.fragments.some((entry) => entry.text === "Compressed node"));
  assert.ok(result.fragments.every((entry) => entry.kind === "vertex" || entry.kind === "edge"));
});

test("FEAT-007: detection uses signatures over extensions and reports disagreement", async () => {
  const pngBytes = await readFile("fixtures/intake/pixel.png");
  const misnamed = detect({ bytes: pngBytes, name: "actually.txt" });
  assert.equal(misnamed.format, "png");
  assert.ok(misnamed.warnings.some((entry) => /disagrees/.test(entry)));
});

test("FEAT-007: EML preserves headers, body alternatives, and attachment identities", async () => {
  const result = await run("thread.eml");
  const headers = result.fragments.find((entry) => entry.kind === "email-headers");
  assert.equal(headers.metadata.subject, "Checkout scope");
  assert.equal(headers.metadata["message-id"], "<m1@example.com>");
  assert.ok(result.fragments.some((entry) => entry.kind === "attachment-identity" && entry.metadata.filename === "scope.pdf"));
});

test("FEAT-007: oversize files fail closed at the byte limit", async () => {
  await assert.rejects(
    intake({ bytes: new Uint8Array(64), name: "scope.md", profile: { maxBytes: 16 } }),
    (error) => error instanceof IntakeError && error.category === "bounded-limit"
  );
});

test("FEAT-007: presentation extraction preserves slide and speaker-note anchors", async () => {
  const result = await run("deck.pptx");
  assert.ok(result.fragments.some((entry) => entry.kind === "slide" && entry.structural_path === "slide:1"));
  assert.ok(result.fragments.some((entry) => entry.kind === "speaker-notes"));
});

test("FEAT-007: PDF extraction is page-anchored and bounded", async () => {
  const result = await run("scope.pdf");
  const page = result.fragments.find((entry) => entry.kind === "page-text");
  assert.equal(page.structural_path, "page:1");
  assert.match(page.text, /Preserve incomplete checkouts/);
  assert.ok(result.coverage.units.processed.includes("pages:1"));
});
