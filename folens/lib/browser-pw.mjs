// 3D Issue 浏览器存证：真实打开 viewer，用其全局 next() 翻页并逐跨页截图。
// 与 FlippingBook 的 agent-browser 驱动分开实现：这里用 playwright-core 直连本机 Chromium，
// 不依赖 CLI daemon（跨站点/长跑时更可控）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export async function captureShots({ url, outDir, count, settle = 1400, log = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const launch = { headless: true, args: ["--no-sandbox", "--disable-gpu"] };
  const exe = chromePath();
  if (exe) launch.executablePath = exe;
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("img.normal-content", { timeout: 60000 });
    await sleep(3500); // viewer 首屏动画 / 预加载

    const currentPages = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("img.normal-content"))
          .map((i) => i.src.split("/").slice(-2).join("/"))
          .sort()
          .join(",")
      );

    let last = "";
    let stalled = 0;
    for (let i = 1; i <= count; i++) {
      const file = path.join(outDir, `spread-${String(i).padStart(3, "0")}.png`);
      await page.screenshot({ path: file });
      log(`  📸 ${path.basename(file)}`);
      if (i === count) break;

      const before = await currentPages();
      await page.evaluate(() => {
        if (typeof window.next === "function") window.next();
      });
      await sleep(settle);
      const after = await currentPages();
      if (after === before && after === last) stalled++;
      else stalled = 0;
      last = after;
      if (stalled >= 2) { log("  ⚠ viewer 已到末页，停止翻页"); break; }
    }
  } finally {
    await browser.close();
  }
}
