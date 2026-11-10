#!/usr/bin/env node
// folens/agent.mjs — Folens / 3D Issue v9.5 静态出版物专用采集入口。
//
// bookinfo.json 读总页数/尺寸 → 直取 files/pages/large/<N>.jpg（完整页图）
// → 可选浏览器翻页截图存证 → JPEG→PDF
//
// 用法（在 folens/ 目录下执行）：
//   node agent.mjs --pages 1-5
//   node agent.mjs --pages 1-5 --shots 5
//   node agent.mjs --resume --delay 800 --shots all
//   node agent.mjs --vectors
//   node agent.mjs --pages 1-5 --no-pdf
//
// 换书：--url <.../index.html> --title <书名> --slug <文件名前缀> --out <产物目录>

import path from "node:path";
import { arg, flag, log } from "../shared/util.mjs";
import { captureBook } from "./lib/capture.mjs";

const BOOK_URL = arg("url", "https://digital.folens.ie/sites/default/files/bulk_upload/EssentialScience2ndEd/ES_TB_EBOOK/index.html");
const OUT = path.resolve(arg("out", "out-essential-science-2nd"));

await captureBook({
  bookUrl: BOOK_URL,
  out: OUT,
  pages: arg("pages", null),
  physical: arg("physical", null), // 3D Issue 无页码偏移，与 --pages 等价
  title: arg("title", null),
  slug: arg("slug", null),
  resume: flag("resume"),
  wantPdf: !flag("no-pdf"),
  delay: Number(arg("delay", 0)),
  shots: arg("shots", "0"), // 数字或 all
  vectors: flag("vectors"),
  log,
});
