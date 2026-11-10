# folens/ — Folens / 3D Issue v9.2 + v9.5 静态出版物采集

> 目标：给定 3D Issue 出版物的 `index.html`，自动**读取元数据 → 直采完整页图 →
> 可选浏览器翻页存证 → 组装 PDF**。
> 已验证五本，均来自 digital.folens.ie：*Essential Science 2nd Edition*（198 页）、
> *Tout Va Bien ! 4th Edition*（218 页）、*Real World Geography 2nd Edition*（211 页，以上 v9.5）、
> *Starlight 4th Class Combined Reading and Skills Book*（100 页）、
> *Starlight 5th Class Combined Reading and Skills Book*（100 页，以上 v9.2）。
> 另两套引擎见 [`../flippingbook/README.md`](../flippingbook/README.md) 与
> [`../issuu/README.md`](../issuu/README.md)。

## 与 FlippingBook 的本质差异

这套代码**不做签名发现、不做页码偏移、不做图层合成** —— 因为站点资源模型完全不同。

| 维度 | FlippingBook Online | 3D Issue v9.2 / v9.5（本模块） |
|---|---|---|
| 资源分发 | CloudFront 私有分发，需借通配签名 | 站点静态直链，**无签名 / Cookie / Referer 要求** |
| 元数据 | `common/pager.json` | `files/data/bookinfo.json`（`v040` 总页数、`v311c` 标题、`optimumDPI`） |
| 页图 | `html5substrates/page%04d_4.jpg` **不含文字** | `files/pages/large/<N>.jpg` **已是完整页面** |
| 文字层 | `vector/%04d.svg` 必须合成 | `files/pages/svg/<N>.svg` 是文字 + 少量小图的矢量副本，**叠加会重影** |
| 页码 | 标签页 ≠ 物理页（offset=14） | 物理序号 1..N，无偏移、无罗马前置页 |
| 浏览器 | 必需（借签名 + 离屏合成截图） | 非必需，仅用于翻页存证 |
| 驱动 | `agent-browser` CLI daemon | `playwright-core` 直连 Chromium |

**判定依据（隔离渲染实验）**：把 `svg/198.svg` 单独用 Chrome headless 渲染，得到的是
纯文字 + 少量矢量图形，背景、照片、插图全部缺失；而 `large/198.jpg` 文字图形齐全。
后续每本换书都复验一次，结果说明**同引擎不同出版物的 SVG 内容并不一致**：

| 书 | `svg/1.svg` 单独渲染 | `large/1.jpg` |
|---|---|---|
| Tout Va Bien ! 4th Ed | **纯空白** | 含照片、文字、版式的完整封面 |
| Real World Geography 2nd Ed | 仅书名 / 副标题文字（背景照片、出版社 logo、作者名全缺） | 含闪电/北极熊/上海天际线/火山照片、作者名、FOLENS logo 的完整封面 |
| Starlight 4th / 5th Class（v9.2） | 仅 Folens、系列副标题、书名文字（紫色/绿色背景、Starlight logo、四幅插画全缺） | 完整的紫色 / 绿色封面，含年级、书名、插画与 FOLENS logo |

所以**直采 large 图即最终页图**，不合成、不叠 SVG。判定依据是「SVG 缺背景/照片，large 完整」，
不要假设 SVG 一定空白或一定有内容。这一点与 FlippingBook 恰好相反。

## 资源地图

```
files/data/bookinfo.json     v000.v030.v040 = 总页数、v311c = 标题、optimumDPI
files/pages/svg/1.svg        width/height pt → PDF MediaBox
                             v9.5: 595×842pt @232DPI；v9.2: 538×736 / 537×736pt @262DPI
files/pages/large/<N>.jpg    完整页图（v9.5 实测 1918×2713；v9.2 尺寸不统一，见下）
files/pages/svg/<N>.svg      文字层副本（<symbol> 字形 + <use> + data URI 小图，自包含）
files/pages/{tablet,smartphone,thumbs}/<N>.jpg   viewer 用的低档位
```

`lib/plan.mjs` 负责读 `bookinfo.json` + 首页 SVG 的 pt 尺寸，生成 `largeUrl/svgUrl/...` 资源模板；
`lib/capture.mjs` 负责直采、manifest、PDF 重组。

**站点与版本坑**：

- CDN 会偶发返回 S3 `NoSuchKey` 404（同一 `index.html` / `bookinfo.json` 首次 404、立刻重试即 200）。
  `plan.mjs` 的 `get()` 带 2 次重试；页图 `download()` 也带重试并校验 JPEG magic `FF D8`，
  防止 365B 的 404 HTML 被当成页图存盘。
- `baseDir()` 返回值**已带尾斜杠**，资源路径必须写 `${base}files/...`。
  手工探测时若拼成 `${base}/files/...`（双斜杠），CloudFront 一律回 404，
  很容易误判成"资源已下线" —— 先对照单/双斜杠两种请求再下结论。
- **v9.2（Starlight）标题是占位符**：`index.html` 的 `<title>` 与 `v311c` 都是 `PUBLICATION`，
  不显式给 `--title / --slug`，两本会撞同一个 `publication` slug、PDF 互相覆盖。
- **v9.2 页图尺寸不统一**：同一本内 1119×1533（低分辨率封面）到 1959×2680 都有。
  `shared/pdf.mjs` 对每张 JPEG 解析 SOF 尺寸后等比居中适配统一 MediaBox，所以不影响成册；
  `quality.json` 的 `page_image_size` 只记录第一张页图的尺寸。
- v9.2 两本的 `large/2.jpg` 都是同一张 31541B 纯白页（原书封面背面空白，非采集失败），
  `verify.py` 的低密度页会列出第 2 页。

## 使用

在 `folens/` 目录下执行（依赖由仓库根 `npm install` 装齐）：

```bash
npm install                    # 仓库根，workspaces

cd folens
node agent.mjs --pages 1-5                       # 试点 5 页 + 拼 PDF
node agent.mjs --pages 1-5 --shots 5             # 附带浏览器翻页存证
node agent.mjs --resume --delay 800 --shots all  # 全书 198 页（一次直采跑完的配置）
node agent.mjs --vectors                         # 额外存档 SVG 矢量副本到 out-essential-science-2nd/vectors/
node agent.mjs --pages 1-5 --no-pdf              # 只存图
```

换书用 `--url <.../index.html> --title <书名> --slug <PDF 文件名前缀> --out <产物目录>`；
`--out` 默认 `out-essential-science-2nd`（第一本的成品目录），v9.2 必须显式给 `--title / --slug`。
`--physical` 与 `--pages` 等价（3D Issue 无页码偏移）。不指定区间时默认采 `1..bookinfo.v040` 全书。

直采链路：`fetch` + 45s 超时 + 2 次重试 + 校验 JPEG magic `FF D8`（防 404 HTML 混进页图），
`--resume` 跳过已有页图，PDF 每次按该 `--out` 下的 `pages/` 全量重组，并自动清理同名旧 PDF。

### 多本书：每本独立 `--out`

PDF 按 `--out` 目录的 `pages/` 全量重组，**两本书共用一个 out 会把页图混进同一本 PDF**。
五本各用独立目录（仓库 `.gitignore` 用 `**/out-*/` 忽略），第一本也不再用裸 `out/`：

```bash
# 任选一行赋给 URL / OUT（默认第一本；其余四本用注释中的值）
URL=https://digital.folens.ie/sites/default/files/bulk_upload/EssentialScience2ndEd/ES_TB_EBOOK/index.html   OUT=out-essential-science-2nd
# URL=https://digital.folens.ie/sites/default/files/bulk_upload/ToutVaBien4thEd/TVB_TB_FLIPBOOK/index.html   OUT=out-tout-va-bien
# URL=https://digital.folens.ie/sites/default/files/bulk_upload/RealWorldGeography2ndEd/RWG2_TB_Flipbook/index.html  OUT=out-real-world-geography
# URL=https://digital.folens.ie/sites/default/files/bulk_upload/Starlight/SL_04_EBOOK/index.html              OUT=out-starlight-4th-class
# URL=https://digital.folens.ie/sites/default/files/bulk_upload/Starlight/SL_05_EBOOK/index.html              OUT=out-starlight-5th-class

node agent.mjs --url "$URL" --out "$OUT" --pages 1-3                       # 试点
node agent.mjs --url "$URL" --out "$OUT" --resume --delay 800 --shots all   # 全书
PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out "$OUT"
```

Starlight 两本还要补 `--title "Starlight 4th Class Combined Reading and Skills Book"`
/ `--slug starlight-4th-class`（5th 同理），否则标题与文件名都会变成 `PUBLICATION` / `publication`。

换书前先确认三件事：`bookinfo.json` 的 `v040` 与 `large/<v040+1>.jpg` 的 404 边界一致
（198/199、218/219、211/212、100/101 四组已核对）；首页 SVG 单独渲染不含完整页面内容；
`large/1.jpg` 是完整封面。

### 分批慢速采集

```bash
FROM=1 TO=198 BATCH=20 DELAY=800 GAP=3 ./scripts/batch-run.sh
```

每批单独起一次 agent，整批失败冷却 12s 重跑一次（`--resume` 幂等）；环境变量
`URL / OUT / FROM / TO / BATCH / DELAY / GAP / NODE` 均可覆盖，日志写 `out-essential-science-2nd/batch.log`。

### 浏览器翻页存证（可选）

`--shots N` 用 `playwright-core` 直连本机 Chromium 打开 viewer，读取 `img.normal-content`
确认当前页，再调用 viewer 全局 `window.next()` 翻页并逐跨页截图；`--shots all` 覆盖全书
（约 N/2 张）。翻到末页后页图 src 不再变化，检测连续 2 次停滞即停止。

- Chromium 路径：`CHROME_PATH` 显式指定，或自动取 `~/.agent-browser/browsers/chrome-*` 下的
  Chrome for Testing，再退到 playwright 默认查找；
- `a.next` 用 Playwright `click()` 会因元素被遮挡 / 坐标问题超时，必须走 `page.evaluate(() => window.next())`；
- 该链路与采集主流程解耦，**失败只告警、不影响 PDF**；
- 环境坑：`agent-browser` CLI daemon 在某些沙箱下 `open` 会静默挂死（连 `about:blank` 也卡），
  所以本模块完全不用它。

## 产出结构（全书完成态）

```
out-essential-science-2nd/                  # Essential Science 2nd Edition
├── essential-science-2nd-edition_p1-p198.pdf
├── pages.json / quality.json / index.html
├── preview/render-001.png / -099 / -198
├── pages/page-0001.jpg … page-0198.jpg      # 198 张 1918×2713
├── shots/spread-001.png … spread-100.png
└── capture.log / batch.log

out-tout-va-bien/                           # Tout Va Bien ! 4th Edition（同结构）
├── tout-va-bien-4th-edition_p1-p218.pdf
├── pages/ 218 张、shots/ 110 张、preview/render-001/-109/-218

out-real-world-geography/                   # Real World Geography 2nd Edition（同结构）
├── real-world-geography-2nd-edition_p1-p211.pdf
├── pages/ 211 张、shots/ 107 张、preview/render-001/-106/-211

out-starlight-4th-class/                    # Starlight 4th Class（v9.2）
├── starlight-4th-class_p1-p100.pdf
├── pages.json / quality.json / index.html
├── preview/render-001.png / -050 / -100
├── pages/page-0001.jpg … page-0100.jpg      # 100 张，尺寸不统一
├── shots/spread-001.png … spread-051.png
└── capture.log

out-starlight-5th-class/                    # Starlight 5th Class（v9.2，同结构）
├── starlight-5th-class_p1-p100.pdf
├── pages/ 100 张、shots/ 51 张、preview/render-001/-050/-100
```

## 完成态校验

**Essential Science 2nd Edition（198 页）**

| 项 | 结果 |
|---|---|
| 采集 | 一次直采 198 页，`--delay 800` + `--shots all`，11m27s，**零失败** |
| 页图 | 198 张 1918×2713、无缺页；manifest 198 条；浏览器跨页截图 100 张无缺号 |
| PDF | 595×842pt，101.92 MB，198 个 Page 对象 / `Count 198` / xref + EOF 正常 |
| 真实渲染 | PyMuPDF 逐页打开 198 页，每页都含图像对象且渲染成功；墨迹密度 std min 10.1 / median 36.5 / max 82.2，**低密度页 0** |
| 抽查 | 封面、书内页 186、末页跨页截图、PDF 首/中/末渲染存证均清晰完整 |

**Tout Va Bien ! 4th Edition（218 页）**

| 项 | 结果 |
|---|---|
| 采集 | 试点 3 页后全书直采，`--delay 800` + `--shots all`，13m00s，exit 0，**零失败** |
| 页图 | 218 张 1918×2713、无缺页；manifest 218 条；浏览器跨页截图 110 张无缺号 |
| 元数据 | `v040=218` 与 `large/219.jpg` 返回 404 的边界一致；595×842pt / 232 DPI |
| PDF | 595×842pt，113.97 MB，218 页；PyMuPDF 逐页打开全部含图像对象且渲染成功 |
| 真实渲染 | 墨迹密度 std min 0.0 / p10 27.5 / median 39.1 / max 87.1，**低密度页仅第 2 页**（原书空白页） |
| 抽查 | 封面、第 109 页（法文正文 / 表格）、末页渲染存证均正常 |

**Real World Geography 2nd Edition（211 页）**

| 项 | 结果 |
|---|---|
| 采集 | 试点 3 页后全书直采，`--delay 800` + `--shots all`，11m23s，exit 0，**零失败** |
| 页图 | 211 张 1918×2713、无缺页；manifest 211 条；浏览器跨页截图 107 张 |
| 元数据 | `v040=211` 与 `large/212.jpg` 返回 404 的边界一致；595×842pt / 232 DPI |
| PDF | 595×842pt，122.11 MB，211 页；PyMuPDF 逐页打开全部含图像对象且渲染成功 |
| 真实渲染 | 墨迹密度 std min 10.6 / p10 25.3 / median 45.1 / max 91.5，**低密度页 0** |
| 抽查 | 第 106 页（彩色地图与表格）、末页均清晰完整 |

**Starlight 4th Class Combined Reading and Skills Book（100 页，v9.2）**

| 项 | 结果 |
|---|---|
| 采集 | 试点 3 页后全书直采，`--delay 800` + `--shots all`，5m02s，exit 0，**零失败** |
| 页图 | 100 张（1959×2680 起，尺寸不统一）、无缺页；manifest 100 条；浏览器跨页截图 51 张 |
| 元数据 | `v040=100` 与 `large/101.jpg` 404 一致；538×736pt / 262 DPI；`v311c` 为占位符 `PUBLICATION`，用 `--title / --slug` 覆盖 |
| PDF | 538×736pt，57.90 MB，100 页；PyMuPDF 逐页打开全部含图像对象且渲染成功 |
| 真实渲染 | 墨迹密度 std min 0.0 / p10 35.1 / median 44.8 / max 89.5，**低密度页仅第 2 页**（原书空白页，已核对原图） |
| 抽查 | 第 50 页（Keeping Pace 课文、彩色插图）清晰完整 |

**Starlight 5th Class Combined Reading and Skills Book（100 页，v9.2）**

| 项 | 结果 |
|---|---|
| 采集 | 试点 3 页后全书直采，`--delay 800` + `--shots all`，5m01s，exit 0，**零失败** |
| 页图 | 100 张（1119×1533 起，尺寸不统一）、无缺页；manifest 100 条；浏览器跨页截图 51 张 |
| 元数据 | `v040=100` 与 `large/101.jpg` 404 一致；537×736pt / 262 DPI；同样需 `--title / --slug` 覆盖占位符 |
| PDF | 537×736pt，46.45 MB，100 页；PyMuPDF 逐页打开全部含图像对象且渲染成功 |
| 真实渲染 | 墨迹密度 std min 0.0 / p10 34.7 / median 44.6 / max 80.2，**低密度页仅第 2 页**（原书空白页） |

## 复验

```bash
python3 -m pip install pymupdf
./scripts/verify.sh                                   # 第一本（默认 --out out-essential-science-2nd）
./scripts/verify.sh --out out-tout-va-bien           # 第二本
./scripts/verify.sh --out out-real-world-geography   # 第三本
./scripts/verify.sh --out out-starlight-4th-class    # 第四本（v9.2）
./scripts/verify.sh --out out-starlight-5th-class    # 第五本（v9.2）
```

`shared/verify.py` 从 `pages.json` 自动推断 `provider=3dissue` / `offset=0` / `sequence`
页码标签，零参数即可；`--pdf / --title / --provider / --offset / --page-label` 可显式覆盖。
也可用 `PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh --out <目录>`。

## 代码结构

```
agent.mjs               独立入口：CLI → captureBook
lib/plan.mjs            bookinfo.json / SVG pt 尺寸 → 资源地图（元数据请求带重试）
lib/capture.mjs         直采、manifest、PDF 重组、可选 SVG 存档与浏览器存证
lib/browser-pw.mjs      Playwright 驱动 viewer 的 next() 翻页截图
scripts/batch-run.sh    分批直采驱动
scripts/verify.sh       成品复验 wrapper（--out 可覆盖）
../shared/pdf.mjs       JPEG→PDF 直嵌（三套引擎共用）
../shared/util.mjs      CLI / 区间 / 节流（三套引擎共用）
../shared/verify.py     成品复验（三套引擎共用）
```

> **PDF 仍是图像型**：页面由 JPEG 直嵌，文字清晰但**不可选中 / 搜索 / 复制**。
> 本项目到此为止，不叠加 OCR 文本层。
