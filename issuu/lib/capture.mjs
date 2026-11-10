// issuu/lib/capture.mjs — 浏览器内逐页翻页渲染 + 元素截图 → 页图 → PDF。
//
// 与 Folens 的「直采静态页图」不同，这里按用户要求走浏览器链路：
// 在本地 viewer 里把公开页图逐页加载（window.next() / __show(n) 即翻页），
// 等 onload 拿到真实尺寸后对 <img> 做元素截图，再交给 shared/pdf.mjs 直嵌。
// 不碰任何登录态、不伪造凭据、不读取门控出版物。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import { range, sleep } from "../../shared/util.mjs";
import { buildPdf } from "../../shared/pdf.mjs";
import { planIssuu } from "./plan.mjs";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), ".agent-browser/browsers");
  try {
    const rev = fs.readdirSync(root).find((d) => d.startsWith("chrome-"));
    if (rev) {
      const p = path.join(root, rev, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 交给 playwright 默认查找 */ }
  return undefined;
}

function viewerHtml(base) {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#fff">
<img id="p" style="display:block;max-width:none">
<script>
const BASE = ${JSON.stringify(base)};
window.__cur = 0;
window.__show = (n, retry) => new Promise((resolve) => {
  const img = document.getElementById('p');
  if (!retry && window.__cur === n && img.complete && img.naturalWidth > 0) {
    resolve([img.naturalWidth, img.naturalHeight]);
    return;
  }
  img.onload = () => { window.__cur = n; resolve([img.naturalWidth, img.naturalHeight]); };
  img.onerror = () => resolve(null);
  img.src = BASE + '/page_' + n + '.jpg' + (retry ? '?r=' + Date.now() : '');
});
window.next = () => window.__show(window.__cur + 1, 0);
</script>
</body></html>`;
}

export async function captureBook({
  bookUrl, out, pages, title, slug, total, publicationId, revisionId,
  resume, wantPdf, delay, quality, log,
}) {
  const plan = await planIssuu(bookUrl, { title, slug, total, publicationId, revisionId });
  log(`✓ Issuu 出版物: ${plan.title} / ${plan.total} 页（元数据来源 ${plan.source}）`);
  log(`✓ 资源: ${plan.base}/page_<N>.jpg（浏览器逐页渲染 + 元素截图）`);

  const pagesDir = path.join(out, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  const pageFile = (n) => path.join(pagesDir, `page-${String(n).padStart(4, "0")}.jpg`);
  const [from, to] = pages ? range(pages) : [1, plan.total];
  if (to > plan.total) throw new Error(`区间上限 ${to} 超过总页数 ${plan.total}`);

  const manifestPath = path.join(out, "pages.json");
  const manifest = {
    book: bookUrl,
    provider: "issuu",
    engine: "browser-screenshot",
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

  const launch = {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-blink-features=AutomationControlled"],
  };
  const exe = chromePath();
  if (exe) launch.executablePath = exe;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) launch.proxy = { server: proxy };

  const browser = await chromium.launch(launch);
  let pageH = plan.pageH;
  try {
    const ctx = await browser.newContext({ viewport: { width: 2400, height: 3400 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("requestfailed", (r) => log(`  ⚠ 资源失败: ${r.url().slice(-60)} ${r.failure()?.errorText ?? ""}`));
    await page.setContent(viewerHtml(plan.base), { waitUntil: "domcontentloaded" });

    const show = async (n) => {
      for (let attempt = 0; attempt <= 2; attempt++) {
        const dims = await page.evaluate(([k, r]) => window.__show(k, r), [n, attempt]);
        if (dims) return dims;
        await sleep(1200 * (attempt + 1));
      }
      throw new Error(`页图加载失败 ${plan.pageUrl(n)}`);
    };

    // 首页真实尺寸决定视口（元素截图必须整体落在视口内）与 PDF MediaBox 比例
    const baseDims = await show(from);
    await page.setViewportSize({ width: baseDims[0] + 60, height: baseDims[1] + 60 });
    pageH = Math.round(plan.pageW * baseDims[1] / baseDims[0]);
    log(`✓ 页图 ${baseDims[0]}×${baseDims[1]} → 视口 ${baseDims[0] + 60}×${baseDims[1] + 60} / MediaBox ${plan.pageW}×${pageH}pt`);

    for (let n = from; n <= to; n++) {
      if (resume && done.has(n) && fs.existsSync(pageFile(n))) {
        log(`⏭ 页 ${n} 已存在，跳过`);
        continue;
      }
      log(`▶ 翻页 → 页 ${n} …`);
      try {
        const dims = await show(n);
        if (dims[0] !== baseDims[0] || dims[1] !== baseDims[1]) {
          log(`  ⚠ 页图尺寸变化 ${dims[0]}×${dims[1]}`);
        }
        await page.locator("#p").screenshot({ path: pageFile(n), type: "jpeg", quality });
        const buf = fs.readFileSync(pageFile(n));
        if (buf.length < 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) {
          throw new Error("截图不是有效 JPEG");
        }
        if (!manifest.pages.some((p) => p.physical === n)) {
          manifest.pages.push({
            label: null,
            physical: n,
            image: path.relative(out, pageFile(n)),
            source: `page_${n}.jpg`,
          });
        }
        log(`  📸 ${(buf.length / 1024).toFixed(0)} KB`);
      } catch (e) {
        log(`  ✗ 页 ${n} 失败: ${e.message}`);
        errors.push(n);
      }
      if (delay) await sleep(delay);
    }
  } finally {
    await browser.close();
  }

  manifest.bookSize = { width: plan.pageW, height: pageH };
  manifest.pages.sort((a, b) => a.physical - b.physical);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log(`✓ manifest → ${path.relative(out, manifestPath)}（累计 ${manifest.pages.length} 页）`);

  // PDF 按 out/pages 全量重组，增量运行自然合并
  if (wantPdf) {
    const files = fs.readdirSync(pagesDir).filter((f) => /^page-\d{4}\.jpg$/.test(f)).sort();
    if (files.length) {
      const images = files.map((f) => ({ buf: fs.readFileSync(path.join(pagesDir, f)) }));
      const pdf = buildPdf(images, { pageW: plan.pageW, pageH, title: plan.title });
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

  log(`✔ 完成${errors.length ? `，失败页: ${errors.join(",")}` : ""}`);
  if (errors.length) process.exitCode = 1;
  return { plan, errors };
}
