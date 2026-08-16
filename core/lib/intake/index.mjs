/**
 * Bounded scope-document intake (spec §16.2, §16.2.1, §16.2.2).
 *
 * Staged contract: detect -> probe -> list-structure -> extract-selection ->
 * list-embedded -> report-coverage. Active content, macros, formulas, and
 * external links are never executed. Every extraction reports its configured
 * limits, processed units, and omissions — a bounded scan is never described
 * as full-file analysis.
 */

import { createHash } from "node:crypto";

import { parse as csvParseSync } from "csv-parse/sync";
import { unzipSync, inflateSync } from "fflate";
import { SaxesParser } from "saxes";

import { ADAPTER_VERSION, detect } from "./detect.mjs";

export { detect, ADAPTER_VERSION };

export class IntakeError extends Error {
  constructor(message, category = "validation-failure") {
    super(message);
    this.name = "IntakeError";
    this.category = category;
  }
}

/** §16.2.1 default bounded-scan profile. */
export const DEFAULT_SCAN_PROFILE = Object.freeze({
  maxBytes: 50 * 1024 * 1024,
  maxMillis: 60_000,
  maxPagesOrSlides: 40,
  maxWorksheets: 10,
  maxRowsPerSheet: 200,
  maxDiagramPages: 10,
  maxShapes: 2000,
  maxAnimationFrames: 20
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fragment(source, { path, locator, kind, text = null, metadata = null, warnings = [] }) {
  const body = text ?? JSON.stringify(metadata);
  return {
    source_id: source.id,
    source_hash: source.hash,
    adapter_version: ADAPTER_VERSION,
    media_type: source.mediaType,
    structural_path: path,
    locator,
    kind,
    text,
    metadata,
    extraction_hash: sha256(Buffer.from(body ?? "", "utf8")),
    warnings
  };
}

function secureXml(text, onElement, onText, onClose) {
  const parser = new SaxesParser({ xmlns: false });
  // saxes performs no DTD processing, entity expansion, or network access.
  let failure = null;
  parser.on("error", (error) => { failure = error; });
  if (onElement) parser.on("opentag", onElement);
  if (onText) parser.on("text", onText);
  if (onClose) parser.on("closetag", onClose);
  parser.write(text).close();
  if (failure) throw new IntakeError(`XML cannot be parsed safely: ${failure.message}`);
}

function unzipSafely(bytes) {
  try {
    return unzipSync(new Uint8Array(bytes));
  } catch (error) {
    throw new IntakeError(`container is corrupted or truncated: ${error.message}`, "corrupted");
  }
}

function xmlText(xml) {
  let out = "";
  secureXml(xml, null, (text) => { out += text; });
  return out;
}

/* ---------------------------------------------------------------- formats */

function extractText(source, text, profile, units) {
  const lines = text.split(/\r?\n/);
  const fragments = [];
  let heading = null;
  let block = [];
  let blockStart = 1;
  const flush = (end) => {
    const body = block.join("\n").trim();
    if (body) {
      fragments.push(fragment(source, {
        path: heading ? `section:${heading}` : "body",
        locator: `lines ${blockStart}-${end}`,
        kind: "text-block",
        text: body
      }));
    }
    block = [];
  };
  lines.forEach((line, index) => {
    const headingMatch = source.format === "markdown" ? line.match(/^#{1,6}\s+(.*)$/) : null;
    if (headingMatch) {
      flush(index);
      heading = headingMatch[1].trim();
      blockStart = index + 2;
      units.processed.push(`heading:${heading}`);
    } else {
      block.push(line);
    }
  });
  flush(lines.length);
  units.discovered.push(`lines:${lines.length}`);
  return fragments;
}

const ACTIVE_HTML = Object.freeze(["script", "iframe", "object", "embed", "style"]);

function extractHtml(source, text, profile, units) {
  const fragments = [];
  let buffer = "";
  let anchor = "html";
  let suppressed = 0;
  const flush = () => {
    if (buffer.trim()) {
      fragments.push(fragment(source, { path: anchor, locator: anchor, kind: "text-block", text: buffer.trim() }));
    }
    buffer = "";
  };
  secureXml(wrapHtml(text), (tag) => {
    const name = tag.name.toLowerCase();
    if (ACTIVE_HTML.includes(name)) {
      // Active or non-content elements are reported, never extracted or executed.
      flush();
      suppressed += 1;
      if (name !== "style") units.unsupported.push(`active-content:${name}`);
      return;
    }
    if (/^h[1-6]$/.test(name) || ["p", "li", "td", "th", "title"].includes(name)) {
      flush();
      anchor = `${name}[${fragments.length}]`;
    }
  }, (text_) => { if (suppressed === 0) buffer += text_; }, (tag) => {
    if (ACTIVE_HTML.includes(tag.name.toLowerCase())) suppressed = Math.max(0, suppressed - 1);
  });
  flush();
  units.discovered.push(`elements:${fragments.length}`);
  return fragments;
}

function wrapHtml(text) {
  // Minimal normalization so saxes can treat lenient HTML as XML for our
  // structure-only purposes; real-world HTML robustness is a later profile.
  return text
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<(br|hr|img|meta|link|input)([^>]*?)\/?>(?!<\/\1>)/gi, "<$1$2/>")
    .replace(/&(?![a-z]+;|#\d+;)/gi, "&amp;");
}

function extractCsv(source, bytes, profile, units) {
  const text = Buffer.from(bytes).toString("utf8");
  const delimiter = (text.split("\n")[0]?.match(/\t/g)?.length ?? 0) > 0 ? "\t" : ",";
  let records;
  const warnings = [];
  try {
    records = csvParseSync(text, { delimiter, relax_column_count: true, skip_empty_lines: true, to: profile.maxRowsPerSheet + 1 });
  } catch (error) {
    throw new IntakeError(`CSV cannot be parsed: ${error.message}`, "corrupted");
  }
  const totalLines = text.split(/\r?\n/).filter((line) => line.trim()).length;
  units.discovered.push(`rows:${totalLines}`);
  if (totalLines > records.length) units.omitted.push(`rows ${records.length + 1}-${totalLines}`);
  const fragments = records.map((row, index) => fragment(source, {
    path: `row:${index + 1}`,
    locator: `row ${index + 1}`,
    kind: index === 0 ? "header-row" : "data-row",
    text: row.join(delimiter === "\t" ? "\t" : ","),
    warnings
  }));
  units.processed.push(`rows:${records.length}`);
  return fragments;
}

function entriesByPrefix(entries, prefix) {
  return Object.keys(entries).filter((name) => name.startsWith(prefix)).sort();
}

function extractDocx(source, entries, profile, units) {
  const document = entries["word/document.xml"];
  if (!document) throw new IntakeError("DOCX is missing word/document.xml", "corrupted");
  const xml = Buffer.from(document).toString("utf8");
  const fragments = [];
  let paragraph = [];
  let paragraphIndex = 0;
  let inParagraph = false;
  const parser = new SaxesParser();
  parser.on("opentag", (tag) => { if (tag.name === "w:p") { inParagraph = true; paragraph = []; } });
  parser.on("text", (text) => { if (inParagraph) paragraph.push(text); });
  parser.on("closetag", (tag) => {
    if (tag.name === "w:p") {
      inParagraph = false;
      paragraphIndex += 1;
      const text = paragraph.join("").trim();
      if (text) {
        fragments.push(fragment(source, {
          path: `paragraph:${paragraphIndex}`, locator: `paragraph ${paragraphIndex}`, kind: "paragraph", text
        }));
      }
    }
  });
  parser.write(xml).close();
  units.discovered.push(`paragraphs:${paragraphIndex}`);
  units.processed.push(`paragraphs:${paragraphIndex}`);
  return fragments;
}

function sharedStrings(entries) {
  const shared = entries["xl/sharedStrings.xml"];
  if (!shared) return [];
  const strings = [];
  let current = null;
  const parser = new SaxesParser();
  parser.on("opentag", (tag) => { if (tag.name === "si") current = []; });
  parser.on("text", (text) => { if (current) current.push(text); });
  parser.on("closetag", (tag) => { if (tag.name === "si") { strings.push(current.join("")); current = null; } });
  parser.write(Buffer.from(shared).toString("utf8")).close();
  return strings;
}

function extractXlsx(source, entries, profile, units) {
  if (Object.keys(entries).some((name) => name.toLowerCase().includes("vbaproject"))) {
    throw new IntakeError("macro-enabled workbook fails closed by default policy (§16.2)", "macro-enabled");
  }
  const strings = sharedStrings(entries);
  const sheets = entriesByPrefix(entries, "xl/worksheets/sheet");
  units.discovered.push(`sheets:${sheets.length}`);
  const fragments = [];
  const usedSheets = sheets.slice(0, profile.maxWorksheets);
  if (sheets.length > usedSheets.length) units.omitted.push(`sheets ${usedSheets.length + 1}-${sheets.length}`);
  for (const sheetName of usedSheets) {
    const xml = Buffer.from(entries[sheetName]).toString("utf8");
    let rows = 0;
    let cell = null;
    let value = "";
    let rowCells = [];
    let rowNumber = 0;
    let formulas = 0;
    const parser = new SaxesParser();
    parser.on("opentag", (tag) => {
      if (tag.name === "row") { rowNumber = Number(tag.attributes.r ?? rowNumber + 1); rowCells = []; }
      if (tag.name === "c") cell = { type: tag.attributes.t ?? "n", ref: tag.attributes.r };
      if (tag.name === "f" && cell) { formulas += 1; cell.formula = true; }
      if (tag.name === "v" || tag.name === "t") value = "";
    });
    parser.on("text", (text) => { value += text; });
    parser.on("closetag", (tag) => {
      if (tag.name === "v" && cell) {
        rowCells.push(cell.type === "s" ? strings[Number(value)] ?? "" : value);
      }
      if (tag.name === "row") {
        rows += 1;
        if (rows <= profile.maxRowsPerSheet && rowCells.length) {
          fragments.push(fragment(source, {
            path: `${sheetName}:row:${rowNumber}`,
            locator: `${sheetName} row ${rowNumber}`,
            kind: "sheet-row",
            text: rowCells.join(",")
          }));
        }
      }
    });
    parser.write(xml).close();
    units.processed.push(`${sheetName}:rows:${Math.min(rows, profile.maxRowsPerSheet)}`);
    if (rows > profile.maxRowsPerSheet) units.omitted.push(`${sheetName} rows ${profile.maxRowsPerSheet + 1}-${rows}`);
    if (formulas > 0) units.warnings.push(`${sheetName}: ${formulas} formulas identified, never evaluated (§16.2)`);
  }
  return fragments;
}

function extractPptx(source, entries, profile, units) {
  const slides = entriesByPrefix(entries, "ppt/slides/slide").filter((name) => !name.includes("rels"));
  const notes = entriesByPrefix(entries, "ppt/notesSlides/notesSlide").filter((name) => !name.includes("rels"));
  units.discovered.push(`slides:${slides.length}`);
  const used = slides.slice(0, profile.maxPagesOrSlides);
  if (slides.length > used.length) units.omitted.push(`slides ${used.length + 1}-${slides.length}`);
  const fragments = [];
  used.forEach((name, index) => {
    const text = xmlText(Buffer.from(entries[name]).toString("utf8")).trim();
    if (text) fragments.push(fragment(source, { path: `slide:${index + 1}`, locator: `slide ${index + 1}`, kind: "slide", text }));
  });
  notes.forEach((name, index) => {
    const text = xmlText(Buffer.from(entries[name]).toString("utf8")).trim();
    if (text) fragments.push(fragment(source, { path: `notes:${index + 1}`, locator: `speaker notes ${index + 1}`, kind: "speaker-notes", text }));
  });
  units.processed.push(`slides:${used.length}`, `notes:${notes.length}`);
  return fragments;
}

function extractDrawio(source, text, profile, units) {
  const fragments = [];
  let pages = 0;
  let shapes = 0;
  const diagrams = [];
  let currentDiagram = null;
  secureXml(text, (tag) => {
    if (tag.name === "diagram") {
      pages += 1;
      currentDiagram = { name: tag.attributes.name ?? `page-${pages}`, index: pages };
      diagrams.push(currentDiagram);
    }
    if (tag.name === "mxCell" && pages <= profile.maxDiagramPages && shapes < profile.maxShapes) {
      const label = tag.attributes.value;
      shapes += 1;
      if (label) {
        fragments.push(fragment(source, {
          path: `page:${currentDiagram?.name ?? "1"}/cell:${tag.attributes.id}`,
          locator: `mxCell ${tag.attributes.id}`,
          kind: tag.attributes.edge === "1" ? "edge" : "vertex",
          text: label,
          metadata: { vertex: tag.attributes.vertex === "1", edge: tag.attributes.edge === "1" }
        }));
      }
    }
  });
  // Compressed diagram bodies are base64+raw-deflate; §16.2.3 requires safe decompression.
  if (pages > 0 && shapes === 0 && /<diagram[^>]*>[A-Za-z0-9+/=\s]+<\/diagram>/.test(text)) {
    const encoded = text.match(/<diagram[^>]*>([A-Za-z0-9+/=\s]+)<\/diagram>/)?.[1]?.replace(/\s+/g, "");
    try {
      const inflated = Buffer.from(inflateSync(new Uint8Array(Buffer.from(encoded, "base64")), { raw: true })).toString("utf8");
      const decoded = decodeURIComponent(inflated);
      return extractDrawio(source, `<mxfile><diagram name="page-1">${decoded}</diagram></mxfile>`, profile, units);
    } catch {
      units.unsupported.push("compressed diagram body could not be safely decompressed");
    }
  }
  units.discovered.push(`pages:${pages}`, `shapes:${shapes}`);
  units.processed.push(`pages:${Math.min(pages, profile.maxDiagramPages)}`);
  return fragments;
}

function extractVsdx(source, entries, profile, units) {
  const pages = entriesByPrefix(entries, "visio/pages/page").filter((name) => /page\d+\.xml$/.test(name));
  units.discovered.push(`pages:${pages.length}`);
  const fragments = [];
  pages.slice(0, profile.maxDiagramPages).forEach((name, index) => {
    let shapes = 0;
    const parser = new SaxesParser();
    let inText = false;
    let buffer = "";
    let shapeId = null;
    parser.on("opentag", (tag) => {
      if (tag.name === "Shape") { shapes += 1; shapeId = tag.attributes.ID ?? String(shapes); }
      if (tag.name === "Text") { inText = true; buffer = ""; }
    });
    parser.on("text", (text) => { if (inText) buffer += text; });
    parser.on("closetag", (tag) => {
      if (tag.name === "Text") {
        inText = false;
        if (buffer.trim()) {
          fragments.push(fragment(source, {
            path: `page:${index + 1}/shape:${shapeId}`,
            locator: `page ${index + 1} shape ${shapeId}`,
            kind: "shape",
            text: buffer.trim()
          }));
        }
      }
    });
    parser.write(Buffer.from(entries[name]).toString("utf8")).close();
    units.processed.push(`page:${index + 1}:shapes:${shapes}`);
  });
  return fragments;
}

async function extractPdf(source, bytes, profile, units) {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 2048))).toString("latin1");
  if (head.includes("/Encrypt")) {
    throw new IntakeError("encrypted PDF fails closed (§16.2)", "encrypted");
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).href;
  let pdf;
  let loadingTask;
  try {
    loadingTask = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl });
    pdf = await loadingTask.promise;
  } catch (error) {
    throw new IntakeError(`PDF cannot be parsed: ${error.message}`, "corrupted");
  }
  units.discovered.push(`pages:${pdf.numPages}`);
  const used = Math.min(pdf.numPages, profile.maxPagesOrSlides);
  if (pdf.numPages > used) units.omitted.push(`pages ${used + 1}-${pdf.numPages}`);
  const fragments = [];
  for (let pageNumber = 1; pageNumber <= used; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ").trim();
    if (text) {
      fragments.push(fragment(source, { path: `page:${pageNumber}`, locator: `page ${pageNumber}`, kind: "page-text", text }));
    }
  }
  units.processed.push(`pages:${used}`);
  await loadingTask.destroy();
  return fragments;
}

function extractGif(source, bytes, profile, units) {
  // Frame counting via image-descriptor scan (0x2C introducers preceded by block structure).
  const buffer = Buffer.from(bytes);
  let frames = 0;
  for (let index = 13; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9) frames += 1;
  }
  if (frames === 0) frames = 1;
  const animated = frames > 1;
  units.discovered.push(`frames:${frames}`);
  const sampled = animated ? Math.min(frames, profile.maxAnimationFrames) : 1;
  units.processed.push(`frames:${sampled}${animated ? " (uniform sample incl. first and last)" : ""}`);
  if (frames > sampled) units.omitted.push(`frames beyond uniform sample of ${sampled}`);
  return [fragment(source, {
    path: "image",
    locator: "gif",
    kind: "image-metadata",
    metadata: { animated, frames, sampled_frames: sampled, width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  })];
}

function extractImage(source, bytes, format, units) {
  const buffer = Buffer.from(bytes);
  const metadata = { format };
  if (format === "png" && buffer.length >= 24) {
    metadata.width = buffer.readUInt32BE(16);
    metadata.height = buffer.readUInt32BE(20);
  }
  units.discovered.push("image:1");
  units.processed.push("image:1");
  return [fragment(source, { path: "image", locator: format, kind: "image-metadata", metadata })];
}

function extractSvg(source, text, profile, units) {
  const fragments = [];
  secureXml(text, (tag) => {
    if (["script", "foreignObject"].includes(tag.name)) units.unsupported.push(`active-content:${tag.name}`);
  }, (body) => {
    if (body.trim()) fragments.push(fragment(source, { path: "svg/text", locator: "svg text", kind: "diagram-text", text: body.trim() }));
  });
  units.discovered.push("svg:1");
  units.processed.push("svg:1");
  return fragments;
}

function extractEml(source, text, profile, units) {
  const [rawHeaders, ...bodyParts] = text.split(/\r?\n\r?\n/);
  const headers = {};
  let lastKey = null;
  for (const line of rawHeaders.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (match) { headers[match[1].toLowerCase()] = match[2]; lastKey = match[1].toLowerCase(); }
    else if (lastKey && /^\s/.test(line)) headers[lastKey] += ` ${line.trim()}`;
  }
  const fragments = [
    fragment(source, {
      path: "headers",
      locator: "message headers",
      kind: "email-headers",
      metadata: {
        from: headers.from ?? null, to: headers.to ?? null, subject: headers.subject ?? null,
        date: headers.date ?? null, "message-id": headers["message-id"] ?? null
      }
    })
  ];
  const boundary = headers["content-type"]?.match(/boundary="?([^";]+)"?/)?.[1];
  const body = bodyParts.join("\n\n");
  if (boundary) {
    const parts = body.split(`--${boundary}`).filter((part) => part.trim() && part.trim() !== "--");
    parts.forEach((part, index) => {
      const [partHeaders, ...partBody] = part.split(/\r?\n\r?\n/);
      const disposition = partHeaders.match(/filename="?([^";\r\n]+)"?/)?.[1];
      if (disposition) {
        fragments.push(fragment(source, {
          path: `attachment:${index}`, locator: `attachment ${disposition}`, kind: "attachment-identity",
          metadata: { filename: disposition }
        }));
        units.discovered.push(`attachment:${disposition}`);
      } else if (partBody.join("").trim()) {
        fragments.push(fragment(source, {
          path: `body:${index}`, locator: `body part ${index}`, kind: "email-body",
          text: partBody.join("\n\n").trim()
        }));
      }
    });
  } else if (body.trim()) {
    fragments.push(fragment(source, { path: "body", locator: "body", kind: "email-body", text: body.trim() }));
  }
  units.processed.push("message:1");
  return fragments;
}

/* ------------------------------------------------------------ orchestrator */

const OOXML_FORMATS = Object.freeze(["docx", "xlsx", "pptx", "vsdx"]);

/**
 * Run the bounded intake pipeline over one file. Returns fragments plus the
 * §16.2.2 coverage record. Fails closed on encrypted, macro-enabled, and
 * corrupted inputs.
 */
export async function intake({ bytes, name, declaredMediaType, profile: overrides = {} }, { now = () => new Date().toISOString() } = {}) {
  if (!(bytes instanceof Uint8Array || Buffer.isBuffer(bytes))) throw new IntakeError("file bytes are required");
  const profile = { ...DEFAULT_SCAN_PROFILE, ...overrides };
  if (bytes.length > profile.maxBytes) {
    throw new IntakeError(`file exceeds the bounded-scan byte limit (${bytes.length} > ${profile.maxBytes})`, "bounded-limit");
  }
  const started = Date.now();
  const detection = detect({ bytes, name, declaredMediaType });
  const source = {
    id: name ?? "unnamed",
    hash: sha256(bytes),
    mediaType: declaredMediaType ?? null,
    format: detection.format,
    size: bytes.length
  };
  const units = { discovered: [], processed: [], partially_processed: [], unsupported: [], omitted: [], warnings: [...detection.warnings] };

  if (detection.format === "encrypted-ooxml") {
    throw new IntakeError("encrypted or password-protected document fails closed (§16.2)", "encrypted");
  }
  if (detection.format === "unsupported" || detection.format === "zip") {
    throw new IntakeError(`unsupported format: ${detection.format}`, "unsupported");
  }

  let fragments;
  const text = () => Buffer.from(bytes).toString("utf8");
  if (OOXML_FORMATS.includes(detection.format)) {
    const entries = unzipSafely(bytes);
    if (detection.format === "docx") fragments = extractDocx(source, entries, profile, units);
    else if (detection.format === "xlsx") fragments = extractXlsx(source, entries, profile, units);
    else if (detection.format === "pptx") fragments = extractPptx(source, entries, profile, units);
    else fragments = extractVsdx(source, entries, profile, units);
  } else if (detection.format === "pdf") fragments = await extractPdf(source, bytes, profile, units);
  else if (detection.format === "csv") fragments = extractCsv(source, bytes, profile, units);
  else if (detection.format === "html") fragments = extractHtml(source, text(), profile, units);
  else if (detection.format === "drawio") fragments = extractDrawio(source, text(), profile, units);
  else if (detection.format === "svg") fragments = extractSvg(source, text(), profile, units);
  else if (detection.format === "gif") fragments = extractGif(source, bytes, profile, units);
  else if (["png", "jpeg"].includes(detection.format)) fragments = extractImage(source, bytes, detection.format, units);
  else if (detection.format === "eml") fragments = extractEml(source, text(), profile, units);
  else fragments = extractText(source, text(), profile, units);

  const elapsed = Date.now() - started;
  if (elapsed > profile.maxMillis) {
    units.warnings.push(`extraction exceeded the bounded time budget (${elapsed}ms)`);
  }

  const complete = units.omitted.length === 0 && units.unsupported.length === 0;
  return {
    source: { ...source, retrieved_at: now(), extraction_method: `deterministic:${detection.format}`, adapter_version: ADAPTER_VERSION },
    fragments,
    coverage: {
      schema_version: "rdlc.extraction-coverage/v0.2",
      limits: profile,
      units,
      selection_method: "deterministic head-first bounded scan (§16.2.1)",
      complete,
      // §16.2.1: never describe a bounded scan as full-file analysis.
      description: complete
        ? "all discovered units processed within configured limits"
        : "partial extraction; omitted and unsupported units listed"
    }
  };
}
