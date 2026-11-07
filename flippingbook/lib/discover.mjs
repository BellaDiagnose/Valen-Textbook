// discover.mjs — 从运行中的 viewer 里提取签名 CDN 凭据与出版物元数据。
//
// 关键事实（实测 flippingbook online 4.36）：
// 1. 页面位图走 CloudFront 私有分发，URL 带 Key-Pair-Id/Policy/Signature，
//    Policy 是 `.../<publicationId>/*` 的通配授权 → 一条签名可复用到该出版物全部资源。
// 2. 资源模板：
//    <prefix>/<pubId>/common/pages/html5substrates/page%04d_<level>.<jpg|webp>
//      level 1=650px, 2=960px, 3=1350px 高, 4=2050px 高（jpg 才有）
//    <prefix>/<pubId>/common/pages/vector/%04d.svg      （矢量/文字层，可选）
//    <prefix>/<pubId>/common/pager.json                 （页尺寸、每页元数据）
// 3. 深链 /view/<hid>/<N>/ 直达含标签页 N 的跨页；状态栏文本给出标签区间。

const SUBSTRATE = (prefix, pubId, page, level, ext) =>
  `${prefix}/${pubId}/common/pages/html5substrates/page${String(page).padStart(4, "0")}_${level}.${ext}`;
const PAGER = (prefix, pubId) => `${prefix}/${pubId}/common/pager.json`;

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanToInt(s) {
  const t = s.toLowerCase();
  let sum = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN[t[i]];
    const next = ROMAN[t[i + 1]] ?? 0;
    sum += v < next ? -v : v;
  }
  return sum;
}

// 从已加载的 <img> 里抓一条带签名的 URL，拆出 prefix / pubId / query
export async function discoverCredentials(browser) {
  const cred = await browser.evalJSON(
    `JSON.stringify((() => {
      const img = [...document.images].find(i => i.src.includes('html5substrates'));
      if (!img) return null;
      const u = new URL(img.src);
      const m = u.pathname.match(/^(\\/[0-9A-F/]+)\\/([0-9]+)\\//);
      return { prefix: 'https://' + u.hostname + m[1], pubId: m[2], query: u.search };
    })())`
  );
  if (!cred) throw new Error("未找到带签名的页面图片 —— viewer 可能还没渲染完");
  return cred;
}

// 抓 pager.json：bookSize（pt）、每页 substrateSizes / vectorText 等
export async function fetchPager(cred) {
  const res = await fetch(PAGER(cred.prefix, cred.pubId) + cred.query);
  if (!res.ok) throw new Error(`pager.json ${res.status}`);
  return res.json();
}

// 状态栏文本 "Pages: xiv -‎ 1 out of 308" → [left, right, total]
// 注意文本里混着 U+200E 方向控制符，需先剔除。
export async function readPageLabels(browser) {
  const txt = await browser.evalJSON(
    `JSON.stringify((() => {
      const strip = s => s.replace(/[\\u2000-\\u202F\\u00A0]/g, ' ');
      const el = [...document.querySelectorAll('[role=status]')]
        .map(e => strip(e.textContent)).find(t => /out of/i.test(t || ''));
      const t = el || '';
      // 双页跨页："Pages: xiv - 1 out of 308"
      const spread = t.match(/Pages:\\s*([\\w xvlc-]+?)\\s*-\\s*([\\w xvlc-]+?)\\s+out of\\s*(\\d+)/i);
      if (spread) return [spread[1].trim(), spread[2].trim(), +spread[3]];
      // 单页（全书末页）："Pages: 308 out of 308" → left/right 同标签
      const single = t.match(/Pages:\\s*([\\w xvlc-]+?)\\s+out of\\s*(\\d+)/i);
      return single ? [single[1].trim(), single[1].trim(), +single[2]] : null;
    })())`
  );
  if (!txt) throw new Error("读不到页码状态栏");
  return { left: txt[0], right: txt[1], total: txt[2] };
}

// 标签页 N → 物理 substrate 序号（page%04d 的 N）。
// 推导：进入 /1/ 后，若左页标签是罗马数字 → offset = romanVal(left)；
//       否则 offset = left - 1。之后 physical = label + offset。
// 本例 /1/ 显示 "xiv - 1" → offset = 14 → 标签 5 = 物理 19（已实测验证）。
export function inferOffset(labels) {
  const { left, right } = labels;
  if (/^[ivxlcdm]+$/i.test(left)) return romanToInt(left);
  const n = parseInt(left, 10);
  if (Number.isFinite(n) && parseInt(right, 10) === 1) return n - 1;
  throw new Error(`无法从状态栏推断页码偏移: "${left} - ${right}"`);
}

export function substrateUrl(cred, physical, level = 4, ext = "jpg") {
  return SUBSTRATE(cred.prefix, cred.pubId, physical, level, ext) + cred.query;
}

export function vectorUrl(cred, physical) {
  return `${cred.prefix}/${cred.pubId}/common/pages/vector/${String(physical).padStart(4, "0")}.svg` + cred.query;
}
