#!/usr/bin/env node
/** Generate synthetic intake fixtures for every required §16.2 format. */

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { zipSync } from "fflate";

const dir = "fixtures/intake";
mkdirSync(dir, { recursive: true });
const write = (name, data) => writeFileSync(`${dir}/${name}`, data);
const enc = (text) => new TextEncoder().encode(text);

/* Text-family */
write("scope.md", "# Checkout Modernization\n\nPreserve incomplete checkouts.\n\n## Outcomes\n\nReduce abandonment by 10%.\n");
write("notes.txt", "Interview with operations.\nCarts vanish after timeout.\n");
write("scope.html", "<html><head><title>Scope</title></head><body><h1>Checkout</h1><p>Preserve incomplete checkouts.</p><script>alert(1)</script></body></html>");
write("data.csv", "requirement,priority\nPreserve checkout,high\nExpire after 30 days,medium\n" + Array.from({ length: 250 }, (_, i) => `row ${i + 3},low`).join("\n") + "\n");

/* OOXML */
const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
write("scope.docx", zipSync({
  "[Content_Types].xml": enc(contentTypes),
  "word/document.xml": enc(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>The checkout service shall preserve an incomplete checkout.</w:t></w:r></w:p><w:p><w:r><w:t>Retention follows the configured policy.</w:t></w:r></w:p></w:body></w:document>`)
}));
const sheet = (rows) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
write("estimates.xlsx", zipSync({
  "[Content_Types].xml": enc(contentTypes),
  "xl/workbook.xml": enc(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Estimates" sheetId="1"/></sheets></workbook>`),
  "xl/sharedStrings.xml": enc(`<?xml version="1.0"?><sst><si><t>story</t></si><si><t>points</t></si><si><t>Preserve checkout</t></si></sst>`),
  "xl/worksheets/sheet1.xml": enc(sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>3+2</f><v>5</v></c></row>`))
}));
write("macro.xlsm", zipSync({
  "[Content_Types].xml": enc(contentTypes),
  "xl/workbook.xml": enc(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`),
  "xl/vbaProject.bin": new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]),
  "xl/worksheets/sheet1.xml": enc(sheet(""))
}));
write("deck.pptx", zipSync({
  "[Content_Types].xml": enc(contentTypes),
  "ppt/presentation.xml": enc(`<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`),
  "ppt/slides/slide1.xml": enc(`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:t>Checkout modernization goals</a:t></p:spTree></p:cSld></p:sld>`),
  "ppt/notesSlides/notesSlide1.xml": enc(`<?xml version="1.0"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Mention retention policy.</a:t></p:notes>`)
}));
write("flow.vsdx", zipSync({
  "[Content_Types].xml": enc(contentTypes),
  "visio/document.xml": enc(`<?xml version="1.0"?><VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main"/>`),
  "visio/pages/page1.xml": enc(`<?xml version="1.0"?><PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes><Shape ID="1"><Text>Start checkout</Text></Shape><Shape ID="2"><Text>Persist cart</Text></Shape></Shapes></PageContents>`)
}));
/* Corrupted container: truncated zip */
write("corrupted.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]));

/* draw.io — plain and compressed */
write("flow.drawio", `<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="Start checkout" vertex="1"/><mxCell id="3" value="persists to" edge="1"/></root></mxGraphModel></diagram></mxfile>`);
const inner = encodeURIComponent(`<mxGraphModel><root><mxCell id="0"/><mxCell id="5" value="Compressed node" vertex="1"/></root></mxGraphModel>`);
write("flow-compressed.drawio", `<mxfile><diagram name="Page-1">${Buffer.from(deflateRawSync(Buffer.from(inner))).toString("base64")}</diagram></mxfile>`);

/* Images */
write("pixel.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
write("photo.jpg", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]));
/* Animated GIF: header + two graphic-control extensions */
const gif = Buffer.concat([
  Buffer.from("GIF89a"), Buffer.from([0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]),
  Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00]),
  Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]),
  Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00]),
  Buffer.from([0x3b])
]);
write("animated.gif", gif);
write("diagram.svg", `<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1">Checkout flow</text></svg>`);

/* Email */
write("thread.eml", [
  "From: alex@example.com", "To: sam@example.com", "Subject: Checkout scope", "Date: Fri, 15 Aug 2026 10:00:00 +0000",
  "Message-ID: <m1@example.com>", 'Content-Type: multipart/mixed; boundary="B1"', "MIME-Version: 1.0", "",
  "--B1", "Content-Type: text/plain", "", "Please preserve incomplete checkouts.", "",
  "--B1", 'Content-Disposition: attachment; filename="scope.pdf"', "Content-Type: application/pdf", "", "JVBERi0=", "--B1--", ""
].join("\r\n"));

/* Minimal one-page PDF with text */
const pdfObjects = [];
const pdf = (() => {
  const chunks = [];
  let offset = 0;
  const push = (text) => { chunks.push(text); pdfObjects.push(offset); offset += Buffer.byteLength(text); };
  const header = "%PDF-1.4\n";
  offset = Buffer.byteLength(header);
  const stream = "BT /F1 12 Tf 72 720 Td (Preserve incomplete checkouts) Tj ET";
  push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n`);
  push(`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n`);
  push(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n`);
  push(`4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`);
  push(`5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);
  const body = chunks.join("");
  const xrefStart = Buffer.byteLength(header) + Buffer.byteLength(body);
  const xref = `xref\n0 6\n0000000000 65535 f \n${pdfObjects.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  const trailer = `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return header + body + xref + trailer;
})();
write("scope.pdf", pdf);
write("encrypted.pdf", "%PDF-1.4\n1 0 obj << /Encrypt 2 0 R >> endobj\ntrailer << /Encrypt 2 0 R >>\n%%EOF");

console.log("intake fixtures generated");
