// fetcher.mjs — 带重试与并发上限的签名资源下载器
export async function download(url, { retries = 2, timeoutMs = 30000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

// 优先 level 4 jpg（2050px 高），404/403 时降级到 webp 档位
export async function downloadSubstrate(cred, substrateUrlFn, physical, log = console) {
  const tries = [
    substrateUrlFn(cred, physical, 4, "jpg"),
    substrateUrlFn(cred, physical, 3, "webp"),
    substrateUrlFn(cred, physical, 1, "webp"),
  ];
  for (const url of tries) {
    try {
      const buf = await download(url);
      log(`    ✓ ${buf.length} bytes ← ${url.split("?")[0].split("/").slice(-1)[0]}`);
      return buf;
    } catch {
      /* 试下一档 */
    }
  }
  throw new Error(`page ${physical}: 所有分辨率档位均下载失败`);
}
