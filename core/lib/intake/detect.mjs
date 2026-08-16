/**
 * Format detection for bounded document intake (spec §16.2).
 * Detection uses file signatures and declared media types in addition to
 * extensions; disagreements surface as warnings rather than silent trust.
 */

export const ADAPTER_VERSION = "rdlc-intake/0.1.0";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const SIGNATURES = [
  { format: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { format: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { format: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { format: "zip", bytes: ZIP_SIGNATURE }
];

const EXTENSION_FORMATS = Object.freeze({
  pdf: "pdf", docx: "docx", xlsx: "xlsx", xlsm: "xlsx", pptx: "pptx", vsdx: "vsdx",
  md: "markdown", markdown: "markdown", txt: "text", text: "text",
  html: "html", htm: "html", csv: "csv", tsv: "csv",
  drawio: "drawio", xml: "drawio", svg: "svg",
  png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", eml: "eml"
});

/** OOXML/OPC content markers inside the zip container. */
const ZIP_MARKERS = [
  { format: "docx", marker: "word/document.xml" },
  { format: "xlsx", marker: "xl/workbook.xml" },
  { format: "pptx", marker: "ppt/presentation.xml" },
  { format: "vsdx", marker: "visio/document.xml" },
  { format: "encrypted-ooxml", marker: "EncryptedPackage" }
];

function startsWith(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function looksTextual(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return sample.length === 0 || control / sample.length < 0.05;
}

/**
 * detect: identify the format from signature bytes, the declared media type,
 * and the file name. Returns { format, container, warnings } and never
 * executes or renders content.
 */
export function detect({ bytes, name = "", declaredMediaType = null }) {
  const warnings = [];
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? null;
  const extensionFormat = extension ? EXTENSION_FORMATS[extension] ?? null : null;

  let signatureFormat = null;
  for (const { format, bytes: signature } of SIGNATURES) {
    if (startsWith(bytes, signature)) {
      signatureFormat = format;
      break;
    }
  }

  let format = signatureFormat;
  if (signatureFormat === "zip") {
    const text = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 65536))).toString("latin1");
    const marker = ZIP_MARKERS.find((entry) => text.includes(entry.marker));
    format = marker?.format ?? extensionFormat ?? "zip";
    if (!marker && extensionFormat) warnings.push(`zip container without a recognizable marker; trusting extension .${extension}`);
  } else if (!signatureFormat) {
    if (!looksTextual(bytes)) {
      return { format: "unsupported", container: null, warnings: ["unrecognized binary signature"] };
    }
    const text = Buffer.from(bytes.subarray(0, 4096)).toString("utf8");
    if (/^\s*<\?xml[^>]*>\s*<svg|^\s*<svg[\s>]/.test(text)) format = "svg";
    else if (/^\s*<mxfile|^\s*<mxGraphModel/.test(text)) format = "drawio";
    else if (/^(From|Received|Return-Path|Message-ID|MIME-Version|Subject):/im.test(text.slice(0, 1024)) && /^(To|From):/im.test(text)) format = "eml";
    else if (/^\s*<(!doctype\s+html|html)/i.test(text)) format = "html";
    else format = extensionFormat ?? "text";
  }

  if (extensionFormat && format && extensionFormat !== format && format !== "encrypted-ooxml") {
    warnings.push(`extension .${extension} disagrees with detected format ${format}`);
  }
  if (declaredMediaType && format === "unsupported") {
    warnings.push(`declared media type ${declaredMediaType} could not be confirmed by signature`);
  }
  return { format, container: signatureFormat === "zip" ? "zip" : null, warnings };
}
