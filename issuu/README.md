# issuu/ — Issuu 出版物采集（浏览器逐页翻页 + 截图）

> 目标：给定 Issuu 出版物 URL，自动**翻页 → 元素截图 → 保存页图 → 组装 PDF**。
> 已验证五本 Edco Ireland 出版物：*Touchstones*（288 页）、*Touchstones Activity Book*（160 页）、
> *En Avant! Mon Dossier*（208 页）、*Maths and Me 4th Class Pupil Book*（170 页）、
> *Maths and Me 5th Class Pupil Book*（186 页）。
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
     （状态常作为转义字符串内嵌，如 \"pageCount\":160）

https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_<N>.jpg              完整页图（约 2117×2999）
https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_1_thumb_large.jpg   缩略图
https://image.isu.pub/<revisionId>-<publicationId>/jpg/page_1_social_preview.jpg 社交预览图
```

`<N>` 从 1 开始、无偏移；`page_<total+1>.jpg` 返回 403，五本的边界全部与 `pageCount` 吻合
（288/289、160/161、208/209、170/171、186/187）。
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
  五本实测 595×843 / 843 / 843 / 848 / 842pt；
- **页图尺寸会逐页波动**：2026 年的 Maths and Me 两本实测同一本内
  2101×2993 / 2117×2992 / 2113×2994 之类几像素裁边差异。每页 `show(n)` 拿到尺寸若超出
  当前视口，就只增不减地 `setViewportSize()` 再截图，否则宽页会被裁；
  PDF 端 `shared/pdf.mjs` 对每张 JPEG 逐页等比居中适配，尺寸差异不影响成册；
- 单页加载失败重试 2 次，重试时给 URL 加时间戳绕过缓存；
- `--resume` 按 manifest + 页图文件跳过，PDF 每次按 `pages/` 全量重组并自动清理旧 PDF。

## 元数据：自动解析与降级

`lib/plan.mjs` 优先 GET 出版物页面，先 `html.replace(/\\"/g, '"')` 把内嵌状态还原成普通 JSON，
再解析 `og:title` / `publicationId` / `revisionId` / `pageCount` / `isDocumentGated`。
**主站可达时 `--url` 即可零参数开跑**（五本全部自动解析成功）。
读到 `isDocumentGated: true` 会直接报错退出。

若主站不可达（本机环境里 `issuu.com`、`static.issuu.com`、`reader.issuu.com` 曾被代理持续返回
`CONNECT tunnel 502`，但 `image.isu.pub` 可达），可把四项显式传给 CLI，此时 `plan.mjs`
**零网络请求**直接开跑：

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
node agent.mjs --pages 1-5                  # 第一本 Touchstones 试点 5 页
node agent.mjs --resume --delay 800         # 全书 288 页
node agent.mjs --pages 1-5 --no-pdf         # 只存页图
```

换书用 `--url` + **独立 `--out`**（每本书一个目录，否则两本页图会混进同一本 PDF）：

```bash
URL=https://issuu.com/edcoireland/docs/touchstones_activity_book
OUT=out-touchstones-activity-book
node agent.mjs --url "$URL" --out "$OUT" --slug touchstones-activity-book --pages 1-3   # 试点
node agent.mjs --url "$URL" --out "$OUT" --slug touchstones-activity-book --resume --delay 800
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out "$OUT"
```

已验证的另外三本 URL：

```bash
https://issuu.com/edcoireland/docs/en_avant_mon_dossier            # OUT=out-en-avant-mon-dossier
https://issuu.com/edcoireland/docs/maths_and_me_4th_class_pupil_book # OUT=out-maths-and-me-4th-class
https://issuu.com/edcoireland/docs/maths_and_me_5th_class_pupil_book # OUT=out-maths-and-me-5th-class
```

参数：`--url` / `--out` / `--pages` / `--resume` / `--delay` / `--quality` / `--no-pdf` /
`--publication-id` / `--revision-id` / `--total` / `--title` / `--slug`。
`--pages` 省略时采 `1..total` 全书。

## 完成态校验

| 出版物 | 页数 / PDF | 采集 | 真实渲染 |
|---|---|---|---|
| Touchstones | 288 页 / 595×843pt / 199.76 MB | 16m41s / exit 0 / 零失败零告警 | std min 19.8 / median 34.2 / max 85.0，低密度页 0 |
| Touchstones Activity Book | 160 页 / 595×843pt / 61.42 MB | 5m53s / exit 0 / 零失败 | std min 9.9 / median 23.7 / max 88.9，低密度页 0 |
| En Avant! Mon Dossier | 208 页 / 595×843pt / 92.75 MB | 7m42s / exit 0 / 零失败 | std min 18.5 / median 41.7 / max 59.6，低密度页 0 |
| Maths and Me 4th Class | 170 页 / 595×848pt / 108.43 MB | 7m33s / exit 0 / 零失败 | std min 20.6 / median 39.2 / max 69.4，低密度页 0 |
| Maths and Me 5th Class | 186 页 / 595×842pt / 120.61 MB | 8m19s / exit 0 / 零失败 | std min 16.0 / median 38.0 / max 55.5，低密度页 0 |

五本均：PyMuPDF 逐页打开全部含图像对象且渲染成功、manifest 条数与页数一致、无缺页、
`page_<total+1>.jpg` 返回 403。抽查 *Maths and Me 4th Class* 第 2 页与 *Touchstones* 第 144 页，
彩色插图、表格、题号、水印都完整清晰。

## 产出结构（每本书一个目录）

```
out/                                      # Touchstones
out-touchstones-activity-book/            # Touchstones Activity Book
out-en-avant-mon-dossier/                 # En Avant! Mon Dossier
out-maths-and-me-4th-class/               # Maths and Me 4th Class
out-maths-and-me-5th-class/               # Maths and Me 5th Class
└── <slug>_p1-p<N>.pdf                   图像型 PDF
    pages.json / quality.json / index.html    manifest / 质量报告 / 全书总览
    preview/render-*.png                  PDF 首/中/末页真实渲染存证
    pages/page-0001.jpg …                 浏览器元素截图（约 2117×2999）
    capture.log
```

## 复验

```bash
python3 -m pip install pymupdf
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh                                  # 第一本
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out out-touchstones-activity-book
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out out-en-avant-mon-dossier
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out out-maths-and-me-4th-class
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out out-maths-and-me-5th-class
```

`shared/verify.py` 识别 `provider=issuu`（与 `3dissue` 一样用 `sequence` 页码标签、offset 0），
从各目录的 `pages.json` 自动推断，零参数即可。

## 边界

- 只处理**公开、无登录 / 门控**的出版物：`plan.mjs` 读到 `isDocumentGated: true` 会直接报错退出；
- 不伪造凭据、不复用他人会话、不探测私有 API、不关闭前端鉴权；
- 成品是图像型 PDF：文字清晰但**不可选中 / 搜索 / 复制**，不叠加 OCR 文本层；
- Edco Ireland 的 Issuu 版本页面带 `© The Educational Company of Ireland` 水印，版权页声明复制需
  出版方许可 —— 请仅在已获授权或个人使用范围内保存。
