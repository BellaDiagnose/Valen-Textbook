#!/usr/bin/env node
// issuu/agent.mjs — Issuu 出版物专用采集入口。
//
// 出版物页面 → publicationId / revisionId / pageCount → 浏览器内逐页翻页渲染
// → 元素截图保存页图 → JPEG→PDF。
//
// 用法（在 issuu/ 目录下执行）：
//   node agent.mjs --pages 1-5
//   node agent.mjs --resume --delay 800
//   node agent.mjs --pages 1-5 --no-pdf
//
// 主站不可达时，可显式给元数据（从出版物页面源码读 publicationId / revisionId / pageCount）：
//   node agent.mjs --publication-id <id> --revision-id <rev> --total <N> --title <书名>
//
// 换书：--url <.../docs/<slug>> --out <产物目录> --title / --slug 均可覆盖。

import path from "node:path";
import { arg, flag, log } from "../shared/util.mjs";
import { captureBook } from "./lib/capture.mjs";

await captureBook({
  bookUrl: arg("url", "https://issuu.com/edcoireland/docs/touchstones"),
  out: path.resolve(arg("out", "out")),
  pages: arg("pages", null),
  title: arg("title", null),
  slug: arg("slug", null),
  total: arg("total", null),
  publicationId: arg("publication-id", null),
  revisionId: arg("revision-id", null),
  resume: flag("resume"),
  wantPdf: !flag("no-pdf"),
  delay: Number(arg("delay", 0)),
  quality: Number(arg("quality", 92)),
  log,
});
