# Valen-Textbook

两套**独立**的在线翻页电子书采集 agent：自动翻页 → 截图存证 → 保存高清页图 → 组装 PDF。
已完整采集并复验四本书：

| 出版物 | 引擎 | 模块 |
|---|---|---|
| *Linking Thinking 1 Textbook*（322 物理页 / 308 标签页） | FlippingBook Online 4.36 | [`flippingbook/`](flippingbook/README.md) |
| *Essential Science 2nd Edition*（198 页） | 3D Issue v9.5（digital.folens.ie） | [`folens/`](folens/README.md) |
| *Tout Va Bien ! 4th Edition*（218 页） | 3D Issue v9.5（digital.folens.ie） | [`folens/`](folens/README.md) |
| *Real World Geography 2nd Edition*（211 页） | 3D Issue v9.5（digital.folens.ie） | [`folens/`](folens/README.md) |

> **四份 PDF 都是图像型**：页面由 JPEG 直嵌，矢量文字层已光栅化进页图，因此文字清晰但
> **不可选中 / 不可搜索 / 不可复制**。本项目不叠加 OCR 文本层。

## 目录结构

```
Valen-Textbook/
├── README.md                 本文件：两套引擎对照 + 快速开始 + 命令迁移
├── package.json              npm workspaces 根（一次 install 装齐两个模块）
├── shared/                   两套共用的零依赖能力
│   ├── pdf.mjs               JPEG → PDF（DCTDecode 直嵌，不重编码）
│   ├── util.mjs              CLI 参数 / 区间 / 节流 / 日志
│   └── verify.py             成品复验：真实渲染 + 墨迹密度扫描 + 总览页
├── flippingbook/             引擎 A：CloudFront 签名 + substrate/vector 合成
│   ├── agent.mjs             独立入口
│   ├── README.md             完整机制与踩坑记录
│   ├── lib/                  browser / discover / fetcher
│   └── scripts/              batch-run.sh / verify.sh
└── folens/                   引擎 B：3D Issue 静态 large 页图直采
    ├── agent.mjs             独立入口
    ├── README.md             完整机制与踩坑记录
    ├── lib/                  plan / capture / browser-pw
    └── scripts/              batch-run.sh / verify.sh
```

产物落在各自的 `out/`：`flippingbook/out/`（609 MB）、`folens/out/`（304 MB）；
同引擎的第二、三本分别放 `folens/out-tout-va-bien/`（114 MB）、
`folens/out-real-world-geography/`（122 MB）。
**每本书必须独立 `--out`** —— PDF 按该目录 `pages/` 全量重组，共用一个 out 会把两本页图混进同一本 PDF。
这些目录由 `.gitignore` 的 `**/out/` / `**/out-*/` 忽略，**不入库**；代码仓库只提交 agent、脚本与文档。

## 两套引擎对照

两套资源模型完全相反，**不要互相照搬采集策略**。

| 维度 | `flippingbook/` | `folens/` |
|---|---|---|
| 站点 | `online.flippingbook.com/view/<hid>/` | 任意 `.../index.html` 的 3D Issue v9.5 出版物 |
| 资源分发 | CloudFront 私有分发，需从 viewer 借通配签名 | 站点静态直链，无签名 / Cookie / Referer 要求 |
| 元数据 | `common/pager.json`（bookSize pt） | `files/data/bookinfo.json`（`v040` 页数、`v311c` 标题、`optimumDPI`） |
| 页图 | `html5substrates/page%04d_4.jpg` **不含文字** | `files/pages/large/<N>.jpg` **已是完整页面** |
| 文字层 | `vector/%04d.svg` **必须合成**，否则无字 | `files/pages/svg/<N>.svg` 是文字副本，**叠加会重影** |
| 页码 | 标签页 ≠ 物理页（本书 offset=14，含罗马前置页） | 物理序号 1..N，无偏移 |
| 浏览器 | **必需**（借签名 + 离屏合成截图） | 非必需，仅用于翻页存证 |
| 驱动 | `agent-browser` CLI daemon | `playwright-core` 直连 Chromium |
| 分批脚本 | `scripts/batch-run.sh`（每批重借签名） | `scripts/batch-run.sh`（纯 HTTP 直采） |

## 快速开始

```bash
# 仓库根：workspaces 一次装齐 agent-browser + playwright-core
npm install
npx agent-browser install        # 仅 FlippingBook 需要：下载 Chrome for Testing

# 引擎 A（在 flippingbook/ 下）
cd flippingbook
node agent.mjs --pages 1-5                     # 试点 5 页
node agent.mjs --physical 1-14 --resume       # 封面 / 罗马前置页
FROM=1 TO=308 BATCH=10 DELAY=1200 GAP=6 ./scripts/batch-run.sh

# 引擎 B（在 folens/ 下）
cd ../folens
node agent.mjs --pages 1-5 --shots 5          # 试点 + 浏览器翻页存证
node agent.mjs --resume --delay 800 --shots all

# 引擎 B 换书：指定 URL + 独立 out（三本已验证 URL 见 folens/README.md）
URL=https://digital.folens.ie/sites/default/files/bulk_upload/RealWorldGeography2ndEd/RWG2_TB_Flipbook/index.html
OUT=out-real-world-geography
node agent.mjs --url "$URL" --out "$OUT" --pages 1-3           # 试点
node agent.mjs --url "$URL" --out "$OUT" --resume --delay 800 --shots all
./scripts/verify.sh --out "$OUT"

# 成品复验（需 python3 + pymupdf）
python3 -m pip install pymupdf
cd ../flippingbook && ./scripts/verify.sh
cd ../folens && ./scripts/verify.sh
```

在仓库根也可以直接复验：`npm run verify:flippingbook` / `npm run verify:folens`。

## 命令迁移（旧单入口 → 两个独立入口）

原先两套逻辑共用一个 `agent.mjs` 按 URL 自动分派 provider，现已拆成两个目录、各自独立入口。
`--provider` 参数与自动分派一并移除 —— **按目录选引擎**，其余参数保持兼容。

| 旧命令（`flippingbook-agent/` 单入口） | 新命令 |
|---|---|
| `node agent.mjs --pages 1-5` | `cd flippingbook && node agent.mjs --pages 1-5` |
| `node agent.mjs --physical 1-14` | `cd flippingbook && node agent.mjs --physical 1-14` |
| `node agent.mjs --url <.../index.html> --pages 1-5` | `cd folens && node agent.mjs --url <...> --pages 1-5` |
| `node agent.mjs --url <...> --shots all` | `cd folens && node agent.mjs --shots all` |
| `./scripts/batch-run.sh` | `cd flippingbook && FROM=... TO=... ./scripts/batch-run.sh` |
| `./scripts/batch-3dissue.sh` | `cd folens && FROM=... TO=... ./scripts/batch-run.sh` |
| `python scripts/verify.py` | `cd flippingbook && ./scripts/verify.sh` |
| `python scripts/verify.py --out out-folens` | `cd folens && ./scripts/verify.sh` |
| `out/` / `out-folens/` | `flippingbook/out/` / `folens/out/` |

新增的可移植性改动（不再绑定某台机器）：

- `NODE` / `PYTHON` / `OUT` / `URL` / `SLUG` / `OFFSET` 均可由环境变量覆盖，脚本不再写死
  `/Users/...` 绝对路径，`NODE` 默认取 PATH 里的 `node`；
- `agent-browser` CLI 由 `lib/browser.mjs` 逐级向上查找 `node_modules/.bin`（适配 workspaces 装在仓库根），
  也可用 `AGENT_BROWSER_BIN` 显式指定；Chromium 路径可用 `CHROME_PATH` 指定；
- `shared/verify.py` 的 `--out` 相对当前工作目录，默认 `out`，并新增 `--provider` 显式覆盖；
- `folens/lib/plan.mjs` 的元数据请求带重试（folens CDN 会偶发 S3 `NoSuchKey` 404，重试即 200）。

## 已验证成品

| 书 | 模块 / 产物 | 页数 | PDF | 页图 | 校验结论 |
|---|---|---|---|---|---|
| Linking Thinking 1 | `flippingbook/out/linking-thinking-1_ph1-ph322.pdf` | 322 | 597×842pt / 131.51 MB | 322 张 1454×2050 | PyMuPDF 逐页渲染通过；仅物理页 2 为原书空白 |
| Essential Science 2nd Ed | `folens/out/essential-science-2nd-edition_p1-p198.pdf` | 198 | 595×842pt / 101.92 MB | 198 张 1918×2713 | PyMuPDF 逐页渲染通过；低密度页 0 |
| Tout Va Bien ! 4th Ed | `folens/out-tout-va-bien/tout-va-bien-4th-edition_p1-p218.pdf` | 218 | 595×842pt / 113.97 MB | 218 张 1918×2713 | PyMuPDF 逐页渲染通过；仅第 2 页为原书空白 |
| Real World Geography 2nd Ed | `folens/out-real-world-geography/real-world-geography-2nd-edition_p1-p211.pdf` | 211 | 595×842pt / 122.11 MB | 211 张 1918×2713 | PyMuPDF 逐页渲染通过；低密度页 0 |

四本都附 `pages.json`（manifest）、`quality.json`、`index.html` 全书总览、`preview/render-*.png`
首/中/末页真实渲染存证。`quality.json` 现含 `provider` 字段，标明由哪套引擎产出。

## 共用件

- `shared/pdf.mjs`：零依赖 JPEG→PDF，解析 SOF 拿像素尺寸，`/DCTDecode` 直嵌原图，手工写 xref。
  两套引擎只是传入不同的 `pageW/pageH`（来自各自元数据）和 `title`。
- `shared/util.mjs`：CLI 参数、区间解析、节流、带时间戳日志。
- `shared/verify.py`：从 `pages.json` 推断 `provider` / `offset` / 页码标签，逐页真实渲染并扫描墨迹密度
  （灰度 0.16× 后的像素标准差，空白页/静默丢文字层会塌到 ≈0），再生成懒加载缩略图总览页。
  老 manifest 无 `provider` 字段时按 `flippingbook` 处理；`--provider` / `--offset` / `--page-label`
  / `--pdf` / `--title` 可显式覆盖。

## 边界

只做图像型 PDF：不做 OCR、不加可搜索文本层、不做压缩分享版。
需要可搜索文本时，须对页图另跑 OCR 并叠加文本层（当前未做，也不在仓库范围内）。

### 已评估但不纳入自动采集的平台

| 平台 | 只读探测结论 | 不纳入原因 | 合规替代 |
|---|---|---|---|
| Issuu — `issuu.com/edcoireland/docs/touchstones`（*Touchstones*，288 页，2022-03-11，publisher `edcoireland`） | 匿名 GET 200、无登录页、内嵌 `isDocumentGated:false`；但页面 `download` / `print` / `save` 入口均为 0，`robots.txt` 被平台边缘层拒绝 | 发布者只开放「在线阅读」，未开放下载；批量抓阅读器页图重组整本 PDF，等于把只读内容变成离线整本复制，改变了发布方设定的分发方式；平台也未给出允许自动抓取的信号 | 用自有 Issuu 账号登录后在授权范围内使用平台官方下载；权利方/机构从 Issuu 后台导出原始 PDF；或向 Edco Ireland 申请授权电子版 |
| Yudu — `content.yudu.com/.../Artefact/html/index.html` | 匿名 GET 200、S3 + CloudFront 静态外壳，页面内 `login`/`password` 标记 19/5 次，鉴权在前端账号体系 | 出版方主动设置了登录/授权层；不做伪造凭据、复用他人会话、关闭前端鉴权等规避 | 合法账号 / 机构 SSO 登录后在授权范围内使用平台导出；或向出版方申请授权 |

**判断标准**：站点把页图作为无鉴权静态资源公开、且没有任何「限制下载」的表达
（FlippingBook、`digital.folens.ie` 属于此类）→ 可采集；
平台明确区分「在线阅读」与「下载」、或设登录 / 订阅门控（Issuu、Yudu）→ 不采集。

拿到**官方渠道的授权 PDF** 之后，本仓库仍可直接用：`shared/verify.py` 逐页真实渲染复验、
生成 `index.html` 全书总览，产物按 `out-<slug>/` 归档（由 `.gitignore` 忽略，不入库）。
