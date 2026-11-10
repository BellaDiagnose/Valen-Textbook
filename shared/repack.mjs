// shared/repack.mjs — 用 pages-clean/ 重组图像型 PDF。
// 复用 buildPdf：JPEG DCTDecode 直嵌，不重编码、不加文本层。
import fs from "node:fs";
import path from "node:path";
import { buildPdf } from "./pdf.mjs";

const out = process.argv[2];
if (!out) throw new Error("usage: node shared/repack.mjs <book-out-dir>");

const manifest = JSON.parse(fs.readFileSync(path.join(out, "pages.json"), "utf8"));
const cleanDir = path.join(out, "pages-clean");
const files = fs.readdirSync(cleanDir).filter((f) => /^page-\d{4}\.jpg$/.test(f)).sort();
if (files.length !== manifest.total) {
  throw new Error(`page count mismatch: ${files.length} images vs ${manifest.total} in manifest`);
}

const original = fs.readdirSync(out).find((f) => f.endsWith(".pdf") && !f.includes("_clean_"));
if (!original) throw new Error("cannot find the original PDF to derive the slug");
const slug = original.replace(/_p\d+-p\d+\.pdf$/, "");

const images = files.map((f) => ({ buf: fs.readFileSync(path.join(cleanDir, f)) }));
const { width, height } = manifest.bookSize;
const pdf = buildPdf(images, { pageW: width, pageH: height, title: manifest.title });
const span = [files[0], files.at(-1)].map((f) => Number(f.match(/\d+/)[0]));
const dest = path.join(out, `${slug}_clean_p${span[0]}-p${span[1]}.pdf`);
fs.writeFileSync(dest, pdf);
console.log(`${dest}  ${(pdf.length / 1024 / 1024).toFixed(2)} MB  ${images.length} pages  ${width}x${height}pt`);
