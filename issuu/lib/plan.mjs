// issuu/lib/plan.mjs — Issuu 出版物元数据 → 页图 CDN 资源模板。
//
// 出版物页面内嵌 revisionId / publicationId / pageCount / title，页图格式为
//   https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_<N>.jpg
// 主站不可达时可用 --publication-id / --revision-id / --total / --title 显式提供。
import { sleep } from "../../shared/util.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function getText(url, { retries = 2, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": UA },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

const slugify = (s) => String(s)
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

export async function planIssuu(bookUrl, opts = {}) {
  let meta = {};
  let source = "cli";
  // 元数据齐备时零网络请求：issuu.com 主站在部分网络环境下会被代理拒绝，
  // 而页图 CDN（image.isu.pub）仍可达，此时用 --publication-id / --revision-id / --total 即可开跑。
  if (!(opts.publicationId && opts.revisionId && opts.total)) {
    try {
      const html = await getText(bookUrl);
      // 出版物状态常作为转义字符串内嵌（\"pageCount\":160），先还原引号再提取字段
      const text = html.replace(/\\"/g, '"');
      const pick = (re) => { const m = text.match(re); return m ? m[1] : null; };
      meta = {
        title: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/)
          || pick(/"title":"([^"]+)"/),
        publicationId: pick(/"publicationId":"([^"]+)"/),
        revisionId: pick(/"revisionId":"([^"]+)"/),
        total: Number(pick(/"pageCount":(\d+)/) || 0),
        gated: pick(/"isDocumentGated":(true|false)/) === "true",
      };
      source = "page";
    } catch {
      // 落到 CLI 显式元数据
    }
  }

  if (meta.gated) {
    throw new Error("该出版物设有访问门控（isDocumentGated=true），需自行取得授权后再处理");
  }

  const title = String(opts.title || meta.title || "Issuu Publication").trim();
  const publicationId = opts.publicationId || meta.publicationId;
  const revisionId = opts.revisionId || meta.revisionId;
  const total = Number(opts.total || meta.total || 0);
  if (!publicationId || !revisionId) {
    throw new Error(`缺少 publicationId / revisionId（元数据来源 ${source}）：请用 --publication-id / --revision-id 显式指定`);
  }
  if (!total) {
    throw new Error(`缺少总页数（元数据来源 ${source}）：请用 --total 显式指定`);
  }

  const base = `https://image.isu.pub/${revisionId}-${publicationId}/jpg`;
  return {
    kind: "issuu",
    bookUrl,
    title,
    slug: opts.slug || slugify(title),
    total,
    publicationId,
    revisionId,
    source,
    pageW: 595, // A4 宽；高度按首页像素比例在 capture 阶段算出
    pageH: 842,
    base,
    pageUrl: (n) => `${base}/page_${n}.jpg`,
    thumbUrl: (n) => `${base}/page_${n}_thumb_large.jpg`,
  };
}
