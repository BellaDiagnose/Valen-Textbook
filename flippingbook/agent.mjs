#!/usr/bin/env node
// flippingbook/agent.mjs — FlippingBook Online 专用采集入口。
//
// discover（借 viewer 拿 CloudFront 通配签名）→ plan（pager.json + 页码偏移）
// → 逐页 flip → 浏览器视图截图 → 合成 substrate + 矢量文字层 → JPEG→PDF
//
// 用法（在 flippingbook/ 目录下执行）：
//   node agent.mjs --pages 1-5
//   node agent.mjs --pages 1-5 --mode click
//   node agent.mjs --pages 10 --engine cdn
//   node agent.mjs --physical 1-14
//   node agent.mjs --pages 1-10 --resume --delay 1200
//   node agent.mjs --pages 1-5 --no-pdf
//
// 换书：--url <viewer 深链> --title <书名> --slug <文件名前缀> --out <产物目录>

import fs from "node:fs";
import path from "node:path";
import { arg, flag, range, sleep, log } from "../shared/util.mjs";
import { Browser, waitFor } from "./lib/browser.mjs";
import { discoverCredentials, fetchPager, readPageLabels, inferOffset, substrateUrl, vectorUrl } from "./lib/discover.mjs";
import { downloadSubstrate } from "./lib/fetcher.mjs";
import { buildPdf } from "../shared/pdf.mjs";

// ---------- CLI ----------
const BOOK_URL = arg("url", "https://online.flippingbook.com/view/871445034/x/");
const hid = BOOK_URL.match(/view\/(\d+)/)?.[1];
if (!hid) throw new Error(`URL 不是 FlippingBook viewer 深链: ${BOOK_URL}`);
const VIEWER = `${new URL(BOOK_URL).origin}/view/${hid}`;

const OUT = path.resolve(arg("out", "out"));
const TITLE = arg("title", "Linking Thinking 1 Textbook");
const SLUG = arg("slug", "linking-thinking-1");
const MODE = arg("mode", "url"); // url=深链翻页 | click=按钮翻页
const ENGINE = arg("engine", "composite"); // composite=底图+矢量文字层 | cdn=仅 substrate
const PHYSICAL = arg("physical", null); // 物理页区间（封面/前置页）
const RESUME = flag("resume");
const WANT_PDF = !flag("no-pdf");
const DELAY = Number(arg("delay", 0)); // 页间节流（ms）
const PAGES = arg("pages", null);
const [from, to] = PAGES ? range(PAGES) : [null, null];
if (!PHYSICAL && (!Number.isFinite(from) || !Number.isFinite(to))) {
  throw new Error("请指定 --pages <区间> 或 --physical <区间>");
}

fs.mkdirSync(path.join(OUT, "pages"), { recursive: true });
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

const browser = new Browser({ session: "fbagent", cwd: OUT });
const pageFile = (physical) => path.join(OUT, "pages", `page-${String(physical).padStart(4, "0")}.jpg`);

// 跨页定位信号：状态栏 "Pages: 6 - 7 out of 308"。
// 大视口下 viewer 会把当前跨页画到 canvas 上，img 可能不存在 → 不能用 img 可见性判定。
async function atLabel(n) {
  try {
    const l = await readPageLabels(browser);
    return parseInt(l.left, 10) === n || parseInt(l.right, 10) === n;
  } catch {
    return false; // 状态栏尚未渲染
  }
}
async function waitAtLabel(n, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await atLabel(n)) return true;
    await sleep(600);
  }
  throw new Error(`等待跨页含标签 ${n} 超时`);
}

// 浏览器内搭离屏画布：substrate 底图 + 矢量 SVG（字体已内嵌）叠加，元素级高清截图。
// 资源交给浏览器 <img> 直载带签名 CDN URL，不经命令行参数：
// 个别页矢量层很大，base64 注入 eval 会触发 spawn E2BIG。
async function captureComposite(cred, physical) {
  await browser.evalJSON(
    `JSON.stringify((() => {
      document.getElementById('fb-capture')?.remove();
      const w = document.createElement('div');
      w.id = 'fb-capture';
      w.style.cssText = 'position:fixed;left:0;top:0;width:1454px;height:2050px;background:#fff;z-index:2147483000';
      const s = document.createElement('img');
      s.id = 'fb-sub';
      s.src = ${JSON.stringify(substrateUrl(cred, physical, 4, "jpg"))};
      s.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
      w.appendChild(s);
      const v = document.createElement('img');
      v.id = 'fb-vector';
      v.src = ${JSON.stringify(vectorUrl(cred, physical))};
      v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
      v.onerror = function () { this.style.display = 'none'; }; // 该页无矢量文字层
      w.appendChild(v);
      document.body.appendChild(w);
      return 1;
    })())`,
    { timeout: 60000 }
  );
  await waitFor(
    browser,
    `[...document.querySelectorAll('#fb-capture img')].every(i => i.complete) && document.querySelector('#fb-sub').naturalWidth > 0`,
    { timeoutMs: 30000 }
  );
  await sleep(600); // 再等一帧光栅化，避免大图未完成绘制

  const out = pageFile(physical);
  await browser.run(["screenshot", "#fb-capture", out, "--screenshot-format", "jpeg", "--screenshot-quality", "92"]);
  await browser.evalJSON(`JSON.stringify((document.getElementById('fb-capture')?.remove(), 1))`);
  return out;
}

// 单页采集（composite/cdn 引擎），带一次重试
async function harvest(cred, physical) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (ENGINE === "composite") return await captureComposite(cred, physical);
      const jpg = await downloadSubstrate(cred, substrateUrl, physical, log);
      fs.writeFileSync(pageFile(physical), jpg);
      return pageFile(physical);
    } catch (e) {
      if (attempt >= 2) throw e;
      log(`  ⚠ 页 ${physical} 第 ${attempt} 次失败（${e.message.slice(0, 60)}），重试…`);
      await sleep(1500);
    }
  }
}

// ---------- 主流程 ----------
async function run() {
  // Step 1: 进入 viewer，等渲染
  const entry = from ?? 1; // physical 模式也借 /1/ 拿凭据
  log(`▶ 打开 viewer（定位第 ${entry} 页）`);
  await browser.setViewport(1470, 2070); // 容纳 1454×2050 合成画布
  await browser.open(`${VIEWER}/${entry}/`);
  await waitFor(browser, `[...document.images].some(i => i.src.includes('html5substrates'))`, { timeoutMs: 30000 });

  // Step 2: discover —— 签名凭据 + 出版物元数据
  const cred = await discoverCredentials(browser);
  log(`✓ 凭据: pubId=${cred.pubId}, prefix=${cred.prefix.split(".cloudfront.net")[0]}.cloudfront.net`);
  const pager = await fetchPager(cred);
  const bookSize = pager.bookSize; // {width:597, height:842} pt
  log(`✓ pager.json: ${bookSize.width}×${bookSize.height}pt`);

  // 页码偏移必须以 /1/ 为锚点推断（任意入口页的标签无法自证），锚定后再跳回目标页
  if (from !== 1 || PHYSICAL) {
    await browser.open(`${VIEWER}/1/`);
    await waitFor(browser, `[...document.images].some(i => i.src.includes('html5substrates'))`, { timeoutMs: 30000 });
  }
  const labels = await readPageLabels(browser);
  const offset = inferOffset(labels);
  log(`✓ 页码偏移: 标签 N → 物理页 N+${offset}（状态栏 "${labels.left} - ${labels.right}" / 共 ${labels.total} 页）`);

  const manifest = { book: BOOK_URL, provider: "flippingbook", title: TITLE, offset, bookSize, engine: ENGINE, pages: [] };
  const pagePath = path.join(OUT, "pages.json");
  if (RESUME && fs.existsSync(pagePath)) {
    manifest.pages = JSON.parse(fs.readFileSync(pagePath, "utf8")).pages ?? [];
    log(`✓ resume: 载入已有 manifest（${manifest.pages.length} 页）`);
  }
  const donePhysical = new Set(manifest.pages.map((p) => p.physical));

  // Step 3: 采集
  const errors = [];

  if (PHYSICAL) {
    // 物理页模式：封面 / 罗马前置页 / 越过标签映射的区间；无跨页截图
    const [p1, p2] = range(PHYSICAL);
    for (let p = p1; p <= p2; p++) {
      if (RESUME && donePhysical.has(p) && fs.existsSync(pageFile(p))) {
        log(`⏭ 物理页 ${p} 已存在，跳过`);
        continue;
      }
      log(`▶ 物理页 ${p}: 采集…`);
      try {
        const f = await harvest(cred, p);
        log(`  🖼 ${path.relative(OUT, f)}`);
        manifest.pages.push({ label: null, physical: p, substrate: `page${String(p).padStart(4, "0")}`, image: path.relative(OUT, f) });
      } catch (e) {
        log(`  ✗ 物理页 ${p} 失败: ${e.message}`);
        errors.push(p);
      }
      if (DELAY) await sleep(DELAY);
    }
  } else {
    for (let n = from; n <= to; n++) {
      const physical = n + offset;
      if (RESUME && donePhysical.has(physical) && fs.existsSync(pageFile(physical))) {
        log(`⏭ 页 ${n}（物理 ${physical}）已存在，跳过`);
        continue;
      }
      log(`▶ 页 ${n}（物理 ${physical}）: 定位…`);

      if (MODE === "click" && n > from) {
        // 跨页含左右两个标签（如 6-7）：目标已在当前跨页则免翻页，否则点一次 Next
        if (!(await atLabel(n))) {
          const ok = await browser.clickNextPage();
          if (!ok) throw new Error("找不到 Next page 按钮");
          await waitAtLabel(n);
        }
      } else {
        await browser.open(`${VIEWER}/${n}/`);
        await waitAtLabel(n);
      }
      await sleep(1500); // 等翻页动画结束，避免截图抓到动画中途

      // 3a. 浏览器视图截图（用户所见，含双页跨页）
      const shot = path.join(OUT, "shots", `spread-${String(n).padStart(3, "0")}.png`);
      await browser.screenshot(shot);
      log(`  📸 ${path.relative(OUT, shot)}`);

      // 3b. 采集高清页图
      try {
        const f = await harvest(cred, physical);
        log(`  🖼 ${path.relative(OUT, f)}${ENGINE === "composite" ? "（substrate+矢量文字层合成）" : ""}`);
        manifest.pages.push({ label: n, physical, substrate: `page${String(physical).padStart(4, "0")}`, screenshot: path.relative(OUT, shot), image: path.relative(OUT, f) });
      } catch (e) {
        log(`  ✗ 页 ${n} 采集失败: ${e.message}`);
        errors.push(n);
      }
      if (DELAY) await sleep(DELAY);
    }
  }

  fs.writeFileSync(pagePath, JSON.stringify(manifest, null, 2));
  log(`✓ manifest → ${path.relative(OUT, pagePath)}（累计 ${manifest.pages.length} 页）`);

  // Step 4: 按 out/pages 全量重组 PDF（增量运行自然合并）
  if (WANT_PDF) {
    const files = fs.readdirSync(path.join(OUT, "pages"))
      .filter((f) => /^page-\d{4}\.jpg$/.test(f))
      .sort();
    const images = files.map((f) => ({ buf: fs.readFileSync(path.join(OUT, "pages", f)) }));
    if (images.length) {
      const pdf = buildPdf(images, { pageW: bookSize.width, pageH: bookSize.height, title: manifest.title });
      const span = [files[0].match(/\d+/)[0], files.at(-1).match(/\d+/)[0]].map(Number);
      const pdfPath = path.join(OUT, `${SLUG}_ph${span[0]}-ph${span[1]}.pdf`);
      fs.writeFileSync(pdfPath, pdf);
      log(`✓ PDF → ${path.relative(OUT, pdfPath)}（${(pdf.length / 1024 / 1024).toFixed(2)} MB, ${images.length} 页）`);
    }
  }

  log(`✔ 完成${errors.length ? `，失败页: ${errors.join(",")}` : ""}`);
  if (errors.length) process.exitCode = 1;
}

try {
  await run();
} finally {
  await browser.close();
}
