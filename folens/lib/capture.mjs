// capture.mjs — 3D Issue 采集流程：静态直链直采（无签名、无页码偏移、无需合成）→ 页图 → PDF。
import fs from "node:fs";
import path from "node:path";
import { range, sleep } from "../../shared/util.mjs";
import { plan3dIssue } from "./plan.mjs";
import { buildPdf } from "../../shared/pdf.mjs";
import { captureShots } from "./browser-pw.mjs";

async function download(url, dest, { retries = 2, timeoutMs = 45000, jpeg = true } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1024) throw new Error(`响应过小 ${buf.length}B`);
      if (jpeg && !(buf[0] === 0xff && buf[1] === 0xd8)) throw new Error("不是 JPEG（可能拿到 404 页面）");
      fs.writeFileSync(dest, buf);
      return buf.length;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(1200 * (i + 1));
    }
  }
  throw new Error(`${url} → ${lastErr?.message}`);
}

export async function captureBook({
  bookUrl, out, pages, physical, title, slug, resume, wantPdf, delay, shots, vectors, log,
}) {
  const plan = await plan3dIssue(bookUrl, { title, slug });
  log(`✓ 3D Issue 出版物: ${plan.title} / ${plan.total} 页 / ${plan.pageW}×${plan.pageH}pt${plan.dpi ? ` / ${plan.dpi} DPI` : ""}`);
  log(`✓ 资源: files/pages/large/<N>.jpg（完整页图，无需 SVG 合成）`);

  const pagesDir = path.join(out, "pages");
  const shotsDir = path.join(out, "shots");
  const vectorsDir = path.join(out, "vectors");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(shotsDir, { recursive: true });
  if (vectors) fs.mkdirSync(vectorsDir, { recursive: true });

  const pageFile = (n) => path.join(pagesDir, `page-${String(n).padStart(4, "0")}.jpg`);
  const spec = physical || pages;
  const [from, to] = spec ? range(spec) : [1, plan.total];
  if (to > plan.total) throw new Error(`区间上限 ${to} 超过总页数 ${plan.total}`);

  const manifestPath = path.join(out, "pages.json");
  const manifest = {
    book: bookUrl,
    provider: "3dissue",
    engine: "direct",
    title: plan.title,
    total: plan.total,
    bookSize: { width: plan.pageW, height: plan.pageH },
    pages: [],
  };
  if (resume && fs.existsSync(manifestPath)) {
    manifest.pages = JSON.parse(fs.readFileSync(manifestPath, "utf8")).pages ?? [];
    log(`✓ resume: 载入已有 manifest（${manifest.pages.length} 页）`);
  }
  const done = new Set(manifest.pages.map((p) => p.physical));
  const errors = [];

  for (let n = from; n <= to; n++) {
    if (resume && done.has(n) && fs.existsSync(pageFile(n))) {
      log(`⏭ 页 ${n} 已存在，跳过`);
      continue;
    }
    log(`▶ 页 ${n}: 直采 large/${n}.jpg …`);
    try {
      const size = await download(plan.largeUrl(n), pageFile(n));
      if (vectors) {
        try { await download(plan.svgUrl(n), path.join(vectorsDir, `${String(n).padStart(4, "0")}.svg`), { jpeg: false }); }
        catch { /* 部分页无矢量层 */ }
      }
      if (!manifest.pages.some((p) => p.physical === n)) {
        manifest.pages.push({ label: null, physical: n, image: path.relative(out, pageFile(n)), source: `large/${n}.jpg` });
      }
      log(`  🖼 ${(size / 1024).toFixed(0)} KB`);
    } catch (e) {
      log(`  ✗ 页 ${n} 失败: ${e.message}`);
      errors.push(n);
    }
    if (delay) await sleep(delay);
  }

  manifest.pages.sort((a, b) => a.physical - b.physical);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log(`✓ manifest → ${path.relative(out, manifestPath)}（累计 ${manifest.pages.length} 页）`);

  // PDF 按 out/pages 全量重组，增量运行自然合并
  if (wantPdf) {
    const files = fs.readdirSync(pagesDir).filter((f) => /^page-\d{4}\.jpg$/.test(f)).sort();
    if (files.length) {
      const images = files.map((f) => ({ buf: fs.readFileSync(path.join(pagesDir, f)) }));
      const pdf = buildPdf(images, { pageW: plan.pageW, pageH: plan.pageH, title: plan.title });
      const span = [files[0].match(/\d+/)[0], files.at(-1).match(/\d+/)[0]].map(Number);
      const pdfPath = path.join(out, `${plan.slug}_p${span[0]}-p${span[1]}.pdf`);
      for (const f of fs.readdirSync(out)) {
        if (f.startsWith(`${plan.slug}_p`) && f.endsWith(".pdf") && path.join(out, f) !== pdfPath) {
          fs.rmSync(path.join(out, f));
        }
      }
      fs.writeFileSync(pdfPath, pdf);
      log(`✓ PDF → ${path.relative(out, pdfPath)}（${(pdf.length / 1024 / 1024).toFixed(2)} MB, ${images.length} 页）`);
    }
  }

  // 浏览器翻页存证（可选）：真实打开 viewer，调用其全局 next() 翻页并截图
  if (shots && shots !== "0") {
    const count = shots === "all" ? Math.ceil(plan.total / 2) + 1 : Number(shots);
    if (Number.isFinite(count) && count > 0) {
      log(`▶ 浏览器翻页截图（${count} 张跨页）…`);
      try {
        await captureShots({ url: bookUrl, outDir: shotsDir, count, log });
        log(`✓ 浏览器存证 → ${path.relative(out, shotsDir)}`);
      } catch (e) {
        log(`  ⚠ 浏览器存证失败（不影响 PDF）: ${e.message.slice(0, 120)}`);
      }
    }
  }

  log(`✔ 完成${errors.length ? `，失败页: ${errors.join(",")}` : ""}`);
  if (errors.length) process.exitCode = 1;
  return { plan, errors };
}
