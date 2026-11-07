// plan.mjs — 3D Issue v9.5 静态出版物的资源地图与元数据。
//
// 与 FlippingBook（CloudFront 私有分发 / 签名 / substrate+vector 合成）完全不同：
// 这里全部是静态直链，large/<N>.jpg 已是完整页面，浏览器仅用于翻页存证。
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function baseDir(url) {
  return url.replace(/\/index\.html?([?#].*)?$/i, "/");
}

async function get(url, asJson = false, timeoutMs = 30000) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return asJson ? r.json() : r.text();
}

/**
 * 3D Issue v9.5 静态出版物：
 *   files/data/bookinfo.json  → v040 总页数、v311c 标题、optimumDPI
 *   files/pages/svg/1.svg     → 页面 pt 尺寸（viewBox）
 *   files/pages/large/<N>.jpg → 完整页图（背景 + 图形 + 文字，无需合成）
 *   files/pages/svg/<N>.svg   → 矢量文字副本（字形轮廓；叠加会与位图重影）
 */
export async function plan3dIssue(bookUrl, { title: titleOverride, slug: slugOverride } = {}) {
  const base = baseDir(bookUrl);
  const info = await get(base + "files/data/bookinfo.json", true);
  const v = info?.v000?.v030 ?? {};
  const total = Number(v.v040);
  if (!Number.isFinite(total) || total < 1) throw new Error("bookinfo.json 读不到总页数 v040");

  let title = titleOverride || v.v311c || "";
  if (!title) {
    try {
      const html = await get(base + "index.html");
      title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
    } catch { /* 用路径兜底 */ }
  }
  title = title.trim() || slugify(base);

  let pageW = 595, pageH = 842; // A4 pt 兜底
  try {
    const svg = await get(base + "files/pages/svg/1.svg");
    const m = svg.match(/width="([\d.]+)pt"\s+height="([\d.]+)pt"/);
    if (m) { pageW = Number(m[1]); pageH = Number(m[2]); }
  } catch { /* 用 A4 */ }

  return {
    kind: "3dissue",
    base,
    title,
    slug: slugOverride || slugify(title),
    total,
    pageW,
    pageH,
    dpi: Number(v.optimumDPI) || null,
    largeUrl: (n) => `${base}files/pages/large/${n}.jpg`,
    svgUrl: (n) => `${base}files/pages/svg/${n}.svg`,
    thumbUrl: (n) => `${base}files/pages/thumbs/${n}.jpg`,
    tabletUrl: (n) => `${base}files/pages/tablet/${n}.jpg`,
  };
}
