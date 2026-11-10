# issuu/ — Issuu 出版物采集（浏览器逐页翻页 + 截图）

> 目标：给定 Issuu 出版物 URL，自动**翻页 → 元素截图 → 保存页图 → 组装 PDF**。
> 已验证：*Touchstones*（The Educational Company of Ireland，288 页）。
> 另外两套引擎见 [`../flippingbook/README.md`](../flippingbook/README.md) 与
> [`../folens/README.md`](../folens/README.md)。

## 三套引擎对比

| 维度 | `flippingbook/` | `folens/` | `issuu/` |
|---|---|---|---|
| 页图来源 | substrate 底图 + vector 文字层 | `files/pages/large/<N>.jpg` 静态直链 | `image.isu.pub/.../page_<N>.jpg` 完整页图 |
| 采集方式 | 浏览器离屏合成 + 元素截图 | Node `fetch` 直采 | **浏览器内逐页翻页渲染 + 元素截图** |
| 浏览器 | 必需（借签名 + 合成） | 仅翻页存证时可选 | **必需** |
| 元数据 | `common/pager.json` | `files/data/bookinfo.json` | 出版物页面内嵌 `publicationId` / `revisionId` / `pageCount` |
| 页码 | 标签页 ≠ 物理页（offset 14） | 物理序号，无偏移 | 物理序号，无偏移 |
| 驱动 | `agent-browser` CLI | `playwright-core` | `playwright-core` |

## 资源模型

```
https://issuu.com/<publisher>/docs/<slug>
  └─ 页面内嵌: publicationId / revisionId / pageCount / title / isDocumentGated

https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_<N>.jpg              完整页图（实测 2117×2999）
https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_1_thumb_large.jpg   缩略图
https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_1_social_preview.jpg 社交预览图
```

`<N>` 从 1 开始、无偏移；`page_289.jpg` 返回 403，与 `pageCount=288` 边界吻合。
注意前缀是 **`revisionId-publicationId`**，只拼 publicationId 会得到 403。

## 采集链路：截图 + 翻页

`lib/capture.mjs` 用 `playwright-core` 启动本机 Chromium，先 `setContent()` 一个本地 viewer：

```js
window.__show = (n, retry) => new Promise((resolve) => {
  const img = document.getElementById('p');
  img.onload  = () => { window.__cur = n; resolve([img.naturalWidth, img.naturalHeight]); };
  img.onerror = () => resolve(null);
  img.src = BASE + '/page_' + n + '.jpg' + (retry ? '?r=' + Date.now() : '');
});
window.next = () => window.__show(window.__cur + 1, 0);
```

每页流程：`__show(n)`（翻页）→ 等 `onload` 拿真实尺寸 →
`page.locator('#p').screenshot({ type: 'jpeg', quality: 92 })` → 校验 JPEG magic →
写 manifest → `shared/pdf.mjs` 直嵌组装 PDF。

要点：

- 首页真实尺寸决定视口（`naturalW+60 × naturalH+60`），否则 CDP 元素截图会丢视口外内容
  （FlippingBook 那套踩过同一个坑）；
- MediaBox 高度按首页像素比例算（595 × 2999/2117 = **843pt**），不写死 A4；
- 单页加载失败重试 2 次，重试时给 URL 加时间戳绕过缓存；
- `--resume` 按 manifest + 页图文件跳过，PDF 每次按 `pages/` 全量重组并自动清理旧 PDF。

## 元数据与主站不可达

`lib/plan.mjs` 优先 GET 出版物页面，解析 `og:title` / `publicationId` / `revisionId` /
`pageCount` / `isDocumentGated`。若主站不可达（本机环境里 `issuu.com`、`static.issuu.com`、
`reader.issuu.com` 被代理持续返回 `CONNECT tunnel 502`，但 `image.isu.pub` 可达），
可把四项显式传给 CLI，此时 `plan.mjs` **零网络请求**直接开跑：

```bash
--publication-id 1a0bd6245b7e993d47444a3053f65fd5 \
--revision-id 220311100731 --total 288 --title "Touchstones"
```

浏览器若检测到 `HTTPS_PROXY` / `https_proxy` 会自动走该代理加载页图。

## 使用

在 `issuu/` 目录下执行（依赖由仓库根 `npm install` 装齐）：

```bash
npm install                                # 仓库根，workspaces
cd issuu
node agent.mjs --pages 1-5                  # 试点 5 页
node agent.mjs --resume --delay 800         # 全书 288 页
node agent.mjs --pages 1-5 --no-pdf         # 只存页图
```

主站被挡时的完整命令（本模块实测配置）：

```bash
node agent.mjs \
  --url "https://issuu.com/edcoireland/docs/touchstones" \
  --out out --resume --delay 800 \
  --publication-id 1a0bd6245b7e993d47444a3053f65fd5 \
  --revision-id 220311100731 --total 288 --title "Touchstones"
```

参数：`--url` / `--out` / `--pages` / `--resume` / `--delay` / `--quality` / `--no-pdf` /
`--publication-id` / `--revision-id` / `--total` / `--title` / `--slug`。
`--pages` 省略时采 `1..total` 全书。

## 完成态校验

| 项 | 结果 |
|---|---|
| 采集 | 试点 3 页后全书 `--resume --delay 800`，16m41s / exit 0 / **零失败、零告警** |
| 页图 | 288 张 2117×2999 浏览器元素截图、无缺页；manifest 288 条；JPEG magic 逐页校验 |
| 元数据 | `pageCount=288` 与 `page_289.jpg` 返回 403 的边界一致；前缀 `220311100731-1a0bd6245b7e993d47444a3053f65fd5` |
| PDF | 595×843pt，199.76 MB / 288 页；PyMuPDF 逐页打开全部含图像对象且渲染成功 |
| 真实渲染 | 墨迹密度 std min 19.8 / p10 23.2 / median 34.2 / max 85.0，**低密度页 0** |
| 抽查 | 第 2 页（版权页）、第 144 页（Script It 正文 / 表格 / 页眉）、末页渲染存证均清晰完整；页面带出版社水印 |

## 产出结构

```
out/
├── touchstones_p1-p288.pdf          图像型 PDF
├── pages.json / quality.json / index.html    manifest / 质量报告 / 全书总览
├── preview/render-*.png             PDF 首/中/末页真实渲染存证
├── pages/page-0001.jpg …            浏览器元素截图（2117×2999）
└── capture.log
```

## 复验

```bash
python3 -m pip install pymupdf
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh
```

`shared/verify.py` 现在识别 `provider=issuu`（与 `3dissue` 一样用 `sequence` 页码标签、offset 0）。

## 边界

- 只处理**公开、无登录 / 门控**的出版物：`plan.mjs` 读到 `isDocumentGated: true` 会直接报错退出；
- 不伪造凭据、不复用他人会话、不探测私有 API、不关闭前端鉴权；
- 成品是图像型 PDF：文字清晰但**不可选中 / 搜索 / 复制**，不叠加 OCR 文本层；
- 这本 Issuu 版本页面带 `© The Educational Company of Ireland` 水印，版权页声明复制需出版方许可
  —— 请仅在已获授权或个人使用范围内保存。
