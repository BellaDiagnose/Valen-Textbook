// agent-browser CLI 薄封装：所有浏览器操作（open / eval / screenshot / click）都经由它。
// 设计原则：单 daemon 会话复用（不反复 open/close），eval 一律返回 JSON 便于解析。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

// 定位 agent-browser CLI：显式环境变量 > 逐级向上找 node_modules/.bin（npm workspaces 装在仓库根） > PATH
export function resolveAgentBrowserBin() {
  if (process.env.AGENT_BROWSER_BIN) return process.env.AGENT_BROWSER_BIN;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, "node_modules", ".bin", "agent-browser");
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "agent-browser";
}

export class Browser {
  constructor({ bin = resolveAgentBrowserBin(), session = "fbagent", cwd } = {}) {
    this.bin = bin;
    this.session = session;
    this.cwd = cwd;
  }

  async run(args, { timeout = 30000 } = {}) {
    const full = [...args, "--session", this.session];
    const { stdout } = await pexec(this.bin, full, {
      cwd: this.cwd,
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  }

  async open(url) {
    return this.run(["open", url]);
  }

  // 合成画布（1454×2050）必须完整落在视口内，否则 CDP 截图会丢超视口内容
  async setViewport(w, h) {
    return this.run(["set", "viewport", String(w), String(h)]);
  }

  // 在页面里执行 JS。CLI 会把 eval 的返回值再做一次 JSON 编码输出，
  // 所以约定脚本最终返回 JSON.stringify(...)，这里解两层。
  async evalJSON(expr, { timeout = 30000 } = {}) {
    const raw = await this.run(["eval", expr], { timeout });
    const line = raw.split("\n").filter((l) => l.startsWith('"')).join("");
    let v;
    try {
      v = JSON.parse(line);
      if (typeof v === "string") v = JSON.parse(v); // 第二层：脚本自己的 stringify
    } catch {
      throw new Error(`evalJSON 解析失败: ${raw.slice(0, 300)}`);
    }
    return v;
  }

  async screenshot(absPath) {
    await this.run(["screenshot", absPath]);
    return absPath;
  }

  // 翻页方式 B：模拟点击工具栏 "Next page"（不依赖 URL 深链）
  async clickNextPage() {
    return this.evalJSON(
      `JSON.stringify((() => {
        const btn = [...document.querySelectorAll('button,[role=menuitem]')]
          .find(b => /next page/i.test(b.getAttribute('aria-label') || b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })())`
    );
  }

  async close() {
    try {
      await this.run(["close"], { timeout: 10000 });
    } catch {
      /* daemon 可能已退出 */
    }
  }
}

// 等待条件成立（在浏览器里轮询 eval 表达式），避免固定 sleep。
export async function waitFor(browser, expr, { timeoutMs = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let poll = 0;
  while (Date.now() < deadline) {
    const ok = await browser.evalJSON(`JSON.stringify(!!(${expr}))`);
    if (poll++ % 5 === 0) console.log(`    [waitFor #${poll}] ${ok}`);
    if (ok === true) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor 超时: ${expr.slice(0, 120)}`);
}

export function abs(p) {
  return path.resolve(p);
}
