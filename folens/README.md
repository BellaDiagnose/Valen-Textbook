# folens/ — Folens / 3D Issue v9.5 静态出版物采集

> 目标：给定 3D Issue v9.5 出版物的 `index.html`，自动**读取元数据 → 直采完整页图 →
> 可选浏览器翻页存证 → 组装 PDF**。
> 已验证：*Essential Science 2nd Edition*（digital.folens.ie），198 页。
> 另一套引擎（FlippingBook）见 [`../flippingbook/README.md`](../flippingbook/README.md)。

## 与 FlippingBook 的本质差异

这套代码**不做签名发现、不做页码偏移、不做图层合成** —— 因为站点资源模型完全不同。

| 维度 | FlippingBook Online | 3D Issue v9.5（本模块） |
|---|---|---|
| 资源分发 | CloudFront 私有分发，需借通配签名 | 站点静态直链，**无签名 / Cookie / Referer 要求** |
| 元数据 | `common/pager.json` | `files/data/bookinfo.json`（`v040` 总页数、`v311c` 标题、`optimumDPI`） |
| 页图 | `html5substrates/page%04d_4.jpg` **不含文字** | `files/pages/large/<N>.jpg` **已是完整页面**（1918×2713） |
| 文字层 | `vector/%04d.svg` 必须合成 | `files/pages/svg/<N>.svg` 是文字 + 少量小图的矢量副本，**叠加会重影** |
| 页码 | 标签页 ≠ 物理页（offset=14） | 物理序号 1..N，无偏移、无罗马前置页 |
| 浏览器 | 必需（借签名 + 离屏合成截图） | 非必需，仅用于翻页存证 |
| 驱动 | `agent-browser` CLI daemon | `playwright-core` 直连 Chromium |

**判定依据（隔离渲染实验）**：把 `svg/198.svg` 单独用 Chrome headless 渲染，得到的是
纯文字 + 少量矢量图形，背景、照片、插图全部缺失；而 `large/198.jpg` 文字图形齐全。
所以**直采 large 图即最终页图**，不合成、不叠 SVG。这一点与 FlippingBook 恰好相反。

## 资源地图

```
files/data/bookinfo.json     v000.v030.v040 = 总页数、v311c = 标题、optimumDPI
files/pages/svg/1.svg        width="595pt" height="842pt" → PDF MediaBox
files/pages/large/<N>.jpg    完整页图（实测 1918×2713 @232DPI）
files/pages/svg/<N>.svg      文字层副本（<symbol> 字形 + <use> + data URI 小图，自包含）
files/pages/{tablet,smartphone,thumbs}/<N>.jpg   viewer 用的低档位
```

`lib/plan.mjs` 负责读 `bookinfo.json` + 首页 SVG 的 pt 尺寸，生成 `largeUrl/svgUrl/...` 资源模板；
`lib/capture.mjs` 负责直采、manifest、PDF 重组。

## 使用

在 `folens/` 目录下执行（依赖由仓库根 `npm install` 装齐）：

```bash
npm install                    # 仓库根，workspaces

cd folens
node agent.mjs --pages 1-5                       # 试点 5 页 + 拼 PDF
node agent.mjs --pages 1-5 --shots 5             # 附带浏览器翻页存证
node agent.mjs --resume --delay 800 --shots all  # 全书 198 页（一次直采跑完的配置）
node agent.mjs --vectors                         # 额外存档 SVG 矢量副本到 out/vectors/
node agent.mjs --pages 1-5 --no-pdf              # 只存图
```

换书用 `--url <.../index.html> --title <书名> --slug <PDF 文件名前缀> --out <产物目录>`；
`--out` 默认 `out`。`--physical` 与 `--pages` 等价（3D Issue 无页码偏移）。
不指定区间时默认采 `1..bookinfo.v040` 全书。

直采链路：`fetch` + 45s 超时 + 2 次重试 + 校验 JPEG magic `FF D8`（防 404 HTML 混进页图），
`--resume` 跳过已有页图，PDF 每次按 `out/pages/` 全量重组，并自动清理同名旧 PDF。

### 分批慢速采集

```bash
FROM=1 TO=198 BATCH=20 DELAY=800 GAP=3 ./scripts/batch-run.sh
```

每批单独起一次 agent，整批失败冷却 12s 重跑一次（`--resume` 幂等）；环境变量
`URL / OUT / FROM / TO / BATCH / DELAY / GAP / NODE` 均可覆盖，日志写 `out/batch.log`。

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
out/
├── essential-science-2nd-edition_p1-p198.pdf   # 图像型 PDF
├── pages.json / quality.json / index.html       # manifest / 质量报告 / 全书总览
├── preview/render-001.png …                    # PDF 首/中/末页真实渲染存证
├── pages/page-0001.jpg … page-0198.jpg          # 198 张 1918×2713 完整页图
├── shots/spread-001.png … spread-100.png        # 浏览器翻页跨页截图
├── vectors/                                     # 仅 --vectors 时生成
└── capture.log / batch.log                      # 采集日志
```

## 完成态校验（198 页已跑完）

| 项 | 结果 |
|---|---|
| 采集 | 一次直采 198 页，`--delay 800` + `--shots all`，11m27s，**零失败** |
| 页图 | 198 张 1918×2713、无缺页；manifest 198 条；浏览器跨页截图 100 张无缺号（末页为单页跨页） |
| PDF | 595×842pt，101.92 MB，198 个 Page 对象 / `Count 198` / xref + EOF 正常 |
| 真实渲染 | PyMuPDF 逐页打开 198 页，每页都含图像对象且渲染成功；墨迹密度 std min 10.1 / median 36.5 / max 82.2，**低密度页 0**（无空白页、无丢内容页） |
| 抽查 | 封面、书内页 186（物理 198）、末页跨页截图、PDF 首/中/末渲染存证均清晰完整 |

## 复验

```bash
python3 -m pip install pymupdf
./scripts/verify.sh                # 等价于 python3 ../shared/verify.py --out out
```

`shared/verify.py` 从 `pages.json` 自动推断 `provider=3dissue` / `offset=0` / `sequence`
页码标签，零参数即可；`--pdf / --title / --provider / --offset / --page-label` 可显式覆盖。
也可用 `PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh`。

## 代码结构

```
agent.mjs               独立入口：CLI → captureBook
lib/plan.mjs            bookinfo.json / SVG pt 尺寸 → 资源地图
lib/capture.mjs         直采、manifest、PDF 重组、可选 SVG 存档与浏览器存证
lib/browser-pw.mjs      Playwright 驱动 viewer 的 next() 翻页截图
scripts/batch-run.sh    分批直采驱动
scripts/verify.sh       成品复验 wrapper
../shared/pdf.mjs       JPEG→PDF 直嵌（两套引擎共用）
../shared/util.mjs      CLI / 区间 / 节流（两套引擎共用）
../shared/verify.py     成品复验（两套引擎共用）
```

> **PDF 仍是图像型**：页面由 JPEG 直嵌，文字清晰但**不可选中 / 搜索 / 复制**。
> 本项目到此为止，不叠加 OCR 文本层。
