# Valen-Textbook

三套**独立**的在线翻页电子书采集 agent：自动翻页 → 截图存证 → 保存高清页图 → 组装 PDF。
已完整采集并复验十一本书：

| 出版物 | 引擎 | 模块 |
|---|---|---|
| *Linking Thinking 1 Textbook*（322 物理页 / 308 标签页） | FlippingBook Online 4.36 | [`flippingbook/`](flippingbook/README.md) |
| *Essential Science 2nd Edition*（198 页） | 3D Issue v9.5（digital.folens.ie） | [`folens/`](folens/README.md) |
| *Tout Va Bien ! 4th Edition*（218 页） | 3D Issue v9.5（digital.folens.ie） | [`folens/`](folens/README.md) |
| *Real World Geography 2nd Edition*（211 页） | 3D Issue v9.5（digital.folens.ie） | [`folens/`](folens/README.md) |
| *Starlight 4th Class Combined Reading and Skills Book*（100 页） | 3D Issue **v9.2** | [`folens/`](folens/README.md) |
| *Starlight 5th Class Combined Reading and Skills Book*（100 页） | 3D Issue **v9.2** | [`folens/`](folens/README.md) |
| *Touchstones*（288 页） | Issuu（image.isu.pub 页图 + 浏览器截图） | [`issuu/`](issuu/README.md) |
| *Touchstones Activity Book*（160 页） | Issuu | [`issuu/`](issuu/README.md) |
| *En Avant! Mon Dossier*（208 页） | Issuu | [`issuu/`](issuu/README.md) |
| *Maths and Me 4th Class Pupil Book*（170 页） | Issuu | [`issuu/`](issuu/README.md) |
| *Maths and Me 5th Class Pupil Book*（186 页） | Issuu | [`issuu/`](issuu/README.md) |

> **十一份 PDF 都是图像型**：页面由 JPEG 直嵌，矢量文字层已光栅化进页图，因此文字清晰但
> **不可选中 / 不可搜索 / 不可复制**。本项目不叠加 OCR 文本层。

## 目录结构

```
Valen-Textbook/
├── README.md                 本文件：三套引擎对照 + 快速开始 + 命令迁移
├── package.json              npm workspaces 根（一次 install 装齐三个模块）
├── shared/                   三套共用的零依赖能力
│   ├── pdf.mjs               JPEG → PDF（DCTDecode 直嵌，不重编码）
│   ├── util.mjs              CLI 参数 / 区间 / 节流 / 日志
│   └── verify.py             成品复验：真实渲染 + 墨迹密度扫描 + 总览页
├── flippingbook/             引擎 A：CloudFront 签名 + substrate/vector 合成
│   ├── agent.mjs             独立入口
│   ├── README.md             完整机制与踩坑记录
│   ├── lib/                  browser / discover / fetcher
│   └── scripts/              batch-run.sh / verify.sh
├── folens/                   引擎 B：3D Issue 静态 large 页图直采
│   ├── agent.mjs             独立入口
│   ├── README.md             完整机制与踩坑记录
│   ├── lib/                  plan / capture / browser-pw
│   └── scripts/              batch-run.sh / verify.sh
└── issuu/                    引擎 C：Issuu 浏览器逐页翻页 + 元素截图
    ├── agent.mjs             独立入口
    ├── README.md             完整机制与踩坑记录
    ├── lib/                  plan / capture
    └── scripts/              verify.sh
```

产物落在各自的 `out*` 目录：`flippingbook/out/`（609 MB）、
`folens/out-essential-science-2nd/`（304 MB）、`folens/out-tout-va-bien/`（114 MB）、
`folens/out-real-world-geography/`（122 MB）、
`folens/out-starlight-4th-class/`、`folens/out-starlight-5th-class/`、
`issuu/out/`（约 200 MB + 288 张页图）、`issuu/out-touchstones-activity-book/`、
`issuu/out-en-avant-mon-dossier/`、`issuu/out-maths-and-me-4th-class/`、
`issuu/out-maths-and-me-5th-class/`。
**每本书必须独立 `--out`** —— PDF 按该目录 `pages/` 全量重组，共用一个 out 会把两本页图混进同一本 PDF。
这些目录由 `.gitignore` 的 `**/out/` / `**/out-*/` 忽略，**不入库**；代码仓库只提交 agent、脚本与文档。

## 三套引擎对照

三套资源模型不同，**不要互相照搬采集策略**。

| 维度 | `flippingbook/` | `folens/` | `issuu/` |
|---|---|---|---|
| 站点 | `online.flippingbook.com/view/<hid>/` | `.../index.html` 的 3D Issue **v9.2 / v9.5** | `issuu.com/<publisher>/docs/<slug>` |
| 资源分发 | CloudFront 私有分发，需借通配签名 | 站点静态直链，无签名 | `image.isu.pub` 静态直链，无鉴权 |
| 元数据 | `common/pager.json` | `files/data/bookinfo.json`（`v040` / `v311c`） | 页面内嵌 `publicationId` / `revisionId` / `pageCount`（常为转义 JSON） |
| 页图 | `html5substrates/page%04d_4.jpg` **不含文字** | `large/<N>.jpg` **已是完整页面** | `page_<N>.jpg` **已是完整页面**（约 2117×2999） |
| 文字层 | `vector/%04d.svg` **必须合成** | SVG 是文字副本，**叠加会重影** | 无独立文字层，页图已含 |
| 采集方式 | 浏览器离屏合成 + 元素截图 | Node `fetch` 直采 | **浏览器逐页翻页渲染 + 元素截图** |
| 页码 | 标签页 ≠ 物理页（offset=14） | 物理序号，无偏移 | 物理序号，无偏移 |
| 浏览器 | **必需**（借签名 + 合成） | 非必需，仅翻页存证 | **必需** |
| 驱动 | `agent-browser` CLI daemon | `playwright-core`（仅存证） | `playwright-core` |
| 分批脚本 | `scripts/batch-run.sh`（每批重借签名） | `scripts/batch-run.sh`（纯 HTTP） | 单进程 `--resume` |

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

# 引擎 B 换书：指定 URL + 独立 out（五本已验证 URL 见 folens/README.md）
URL=https://digital.folens.ie/sites/default/files/bulk_upload/RealWorldGeography2ndEd/RWG2_TB_Flipbook/index.html
OUT=out-real-world-geography
node agent.mjs --url "$URL" --out "$OUT" --pages 1-3
node agent.mjs --url "$URL" --out "$OUT" --resume --delay 800 --shots all
./scripts/verify.sh --out "$OUT"
# v9.2（Starlight）的 bookinfo 标题是占位符 PUBLICATION，必须补 --title / --slug

# 引擎 C（在 issuu/ 下）
cd ../issuu
node agent.mjs --pages 1-5                    # 第一本 Touchstones 试点
node agent.mjs --resume --delay 800            # 全书 288 页

# 引擎 C 换书：主站可达时 --url 自动解析全部元数据，无需手抄 ID
URL=https://issuu.com/edcoireland/docs/touchstones_activity_book
OUT=out-touchstones-activity-book
node agent.mjs --url "$URL" --out "$OUT" --slug touchstones-activity-book --pages 1-3
node agent.mjs --url "$URL" --out "$OUT" --slug touchstones-activity-book --resume --delay 800
./scripts/verify.sh --out "$OUT"

# 成品复验（需 python3 + pymupdf）
python3 -m pip install pymupdf
cd ../flippingbook && ./scripts/verify.sh
cd ../folens && ./scripts/verify.sh
cd ../issuu && ./scripts/verify.sh
```

在仓库根也可以直接复验：`npm run verify:flippingbook` / `npm run verify:folens` / `npm run verify:issuu`
（三者分别指向各模块第一本的成品目录；其余书用 `./scripts/verify.sh --out <目录>`）。

## 命令迁移（旧单入口 → 三个独立入口）

原先 FlippingBook 与 3D Issue 两套逻辑共用一个 `agent.mjs` 按 URL 自动分派 provider，现已拆成三个目录、各自独立入口。
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
| `out/` / `out-folens/` | `flippingbook/out/` / `folens/out-essential-science-2nd/` |

新增的可移植性改动（不再绑定某台机器）：

- `NODE` / `PYTHON` / `OUT` / `URL` / `SLUG` / `OFFSET` 均可由环境变量覆盖，脚本不再写死
  `/Users/...` 绝对路径，`NODE` 默认取 PATH 里的 `node`；
- `agent-browser` CLI 由 `lib/browser.mjs` 逐级向上查找 `node_modules/.bin`（适配 workspaces 装在仓库根），
  也可用 `AGENT_BROWSER_BIN` 显式指定；Chromium 路径可用 `CHROME_PATH` 指定；
- `shared/verify.py` 的 `--out` 相对当前工作目录，默认 `out`，`--provider` 支持
  `flippingbook` / `3dissue` / `issuu`；
- `folens/lib/plan.mjs` 的元数据请求带重试（folens CDN 会偶发 S3 `NoSuchKey` 404，重试即 200）；
- `issuu/lib/plan.mjs` 先还原页面里的转义 JSON 再提取元数据，主站可达时零参数自动解析；
  主站被代理挡住时可用 `--publication-id / --revision-id / --total / --title` 显式传入（零网络请求），
  `issuu/lib/capture.mjs` 自动走 `HTTPS_PROXY`，页图尺寸逐页波动时按需扩张视口。

## 已验证成品

| 书 | 模块 / 产物 | 页数 | PDF | 页图 | 校验结论 |
|---|---|---|---|---|---|
| Linking Thinking 1 | `flippingbook/out/linking-thinking-1_ph1-ph322.pdf` | 322 | 597×842pt / 131.51 MB | 322 张 1454×2050 | PyMuPDF 逐页渲染通过；仅物理页 2 为原书空白 |
| Essential Science 2nd Ed | `folens/out-essential-science-2nd/essential-science-2nd-edition_p1-p198.pdf` | 198 | 595×842pt / 101.92 MB | 198 张 1918×2713 | PyMuPDF 逐页渲染通过；低密度页 0 |
| Tout Va Bien ! 4th Ed | `folens/out-tout-va-bien/tout-va-bien-4th-edition_p1-p218.pdf` | 218 | 595×842pt / 113.97 MB | 218 张 1918×2713 | PyMuPDF 逐页渲染通过；仅第 2 页为原书空白 |
| Real World Geography 2nd Ed | `folens/out-real-world-geography/real-world-geography-2nd-edition_p1-p211.pdf` | 211 | 595×842pt / 122.11 MB | 211 张 1918×2713 | PyMuPDF 逐页渲染通过；低密度页 0 |
| Starlight 4th Class | `folens/out-starlight-4th-class/starlight-4th-class_p1-p100.pdf` | 100 | 538×736pt / 57.90 MB | 100 张（1959×2680 起，尺寸不统一） | PyMuPDF 逐页渲染通过；仅第 2 页为原书空白；51 张翻页存证 |
| Starlight 5th Class | `folens/out-starlight-5th-class/starlight-5th-class_p1-p100.pdf` | 100 | 537×736pt / 46.45 MB | 100 张（1119×1533 起，尺寸不统一） | PyMuPDF 逐页渲染通过；仅第 2 页为原书空白；51 张翻页存证 |
| Touchstones | `issuu/out/touchstones_p1-p288.pdf` | 288 | 595×843pt / 199.76 MB | 288 张 2117×2999 浏览器截图 | PyMuPDF 逐页渲染通过；低密度页 0，零失败页 |
| Touchstones Activity Book | `issuu/out-touchstones-activity-book/touchstones-activity-book_p1-p160.pdf` | 160 | 595×843pt / 61.42 MB | 160 张 2117×2999 浏览器截图 | PyMuPDF 逐页渲染通过；低密度页 0，零失败页 |
| En Avant! Mon Dossier | `issuu/out-en-avant-mon-dossier/en-avant-mon-dossier_p1-p208.pdf` | 208 | 595×843pt / 92.75 MB | 208 张 2117×2999 浏览器截图 | PyMuPDF 逐页渲染通过；低密度页 0，零失败页 |
| Maths and Me 4th Class | `issuu/out-maths-and-me-4th-class/maths-and-me-4th-class_p1-p170.pdf` | 170 | 595×848pt / 108.43 MB | 170 张（2101×2993 起，尺寸波动） | PyMuPDF 逐页渲染通过；低密度页 0，零失败页 |
| Maths and Me 5th Class | `issuu/out-maths-and-me-5th-class/maths-and-me-5th-class_p1-p186.pdf` | 186 | 595×842pt / 120.61 MB | 186 张（2115×2993 起，尺寸波动） | PyMuPDF 逐页渲染通过；低密度页 0，零失败页 |

十一本都附 `pages.json`（manifest）、`quality.json`、`index.html` 全书总览、`preview/render-*.png`
首/中/末页真实渲染存证。`quality.json` 含 `provider` 字段，标明由哪套引擎产出。

## 共用件

- `shared/pdf.mjs`：零依赖 JPEG→PDF，解析 SOF 拿像素尺寸，`/DCTDecode` 直嵌原图，手工写 xref。
  三套引擎只是传入不同的 `pageW/pageH`（来自各自元数据）和 `title`；每页按自身像素尺寸等比居中适配，
  所以 v9.2 与 2026 年 Issuu 出版物那种「页图尺寸不统一」也能正常成册。
- `shared/util.mjs`：CLI 参数、区间解析、节流、带时间戳日志。
- `shared/verify.py`：从 `pages.json` 推断 `provider` / `offset` / 页码标签，逐页真实渲染并扫描墨迹密度
  （灰度 0.16× 后的像素标准差，空白页/静默丢文字层会塌到 ≈0），再生成懒加载缩略图总览页。
  老 manifest 无 `provider` 字段时按 `flippingbook` 处理；`--provider` / `--offset` / `--page-label`
  / `--pdf` / `--title` 可显式覆盖。

### 去除页间恒定叠加水印

- `shared/dewatermark.py`：面向**每一页位置与形状都相同**的半透明叠加水印。
  跨页高分位图把逐页变化的正文投掉、只留恒定水印；形态学闭运算估计无水印背景，
  两者差值即局部暗化场 `D(x,y)`（以白纸 B=255 标定）。
  水印是半透明深色层，成像为乘性衰减 `I = B·(1−k)`，暗化量 `k·B` 正比于底色；
  因此补偿必须按底色缩放：`B ≈ clip(I + gain·D·f)`，`f = bg_local / 255`。
  `bg_local` 由当前页灰度的大核闭运算求得（填掉暗笔画、保留版式底色）。
  白纸上 `f≈1`，等价于纯加性；深色/彩色版式上 `f<1`，避免把灰水印**过补偿成白色亮痕**
  （`En Avant` 的深蓝标题栏、粉框、灰框就是这种情形）。
  底层像素只是被衰减、并未丢失，所以不做 inpainting、不做生成式补字；
  也不走 `B = I/(1−k)` 的除法反解 —— `k→1` 时会把 JPEG 噪声放大 `1/(1−k)` 倍。
  - `analyze`：采样 48 页建场，产出 `dewatermark/field.npz`、`field-preview.png`、`analyze.json`。
    自动闸门用 split-half 相关性、对角带能量、高强度像素占比判断「是否真存在页间恒定水印」；
    判定为无水印时 `apply` 直接拒绝，避免把页眉页脚版式误当水印抹掉。
  - `apply`：写入 `pages-clean/`，原 `pages/` 保持不动；默认前 3 页试点，`--all` 跑全书。
    中间全程 ndarray，只在最终一次 JPEG 编码（默认 q95 / 4:4:4，`--quality` 可调），
    `--gain` 调补偿强度。`apply.json` 记录每页 `mean_modulation`（平均底色系数）与
    `mean_applied`（实际补偿量）；`D=0` 的区域像素零改动。
  - `verify`：对 `pages-clean/` 重算水印场，残留比 = 处理后场强 / 处理前场强；
    同时用有符号残差（闭运算 − 分位图 − 开运算）检测 `bright_halo_ratio`，
    专门捕捉「过补偿形成的白色亮痕」——纯暗化场会把负残差裁掉，对这种缺陷是盲的。
- `shared/repack.mjs`：用 `pages-clean/` 按 `pages.json` 的 `bookSize` 重组图像型 PDF，
  仍是 `/DCTDecode` 直嵌、无文本层，输出 `<slug>_clean_p1-pN.pdf`，原 PDF 保留。

```bash
PY=$HOME/.workbuddy/binaries/python/envs/default/bin/python
$PY shared/dewatermark.py analyze --book issuu/out
$PY shared/dewatermark.py apply   --book issuu/out --pages 5,144,100   # 看 compare-*.png
$PY shared/dewatermark.py apply   --book issuu/out --all --no-compare
$PY shared/dewatermark.py verify  --book issuu/out
node shared/repack.mjs issuu/out
```

> 适用范围：自有版权或已获授权的素材、个人使用。水印若构成权利管理信息，
> 剥离后不得用于再分发；下方版权提示同样适用。

## 边界

只做图像型 PDF：不做 OCR、不加可搜索文本层、不做压缩分享版。
需要可搜索文本时，须对页图另跑 OCR 并叠加文本层（当前未做，也不在仓库范围内）。

### 判断标准：是否绕过鉴权

| 可采集 | 不采集 |
|---|---|
| 页面公开、无登录 / 门控，页图无鉴权（FlippingBook、Folens、Issuu） | 需要登录 / 订阅门控的内容（Yudu 前端登录层、Issuu `isDocumentGated: true` 的出版物） |

判据是「有没有绕过鉴权」，**不是「有没有下载按钮」**：Issuu 匿名页没有下载入口，
但内容公开可阅读，用浏览器逐页翻页 + 元素截图保存是正常链路（`issuu/` 即此实现）。
反过来，Yudu 的 `content.yudu.com/.../Artefact/html/index.html` 有前端登录 / 授权层，
不做伪造凭据、复用他人会话、猜测私有资源路径、关闭前端鉴权等规避。

拿到**官方渠道的授权 PDF** 之后，本仓库仍可直接用：`shared/verify.py` 逐页真实渲染复验、
生成 `index.html` 全书总览，产物按 `out-<slug>/` 归档（由 `.gitignore` 忽略，不入库）。

> 版权提示：Edco Ireland 的 Issuu 出版物页面带 `© The Educational Company of Ireland` 水印，
> 版权页声明复制需出版方许可。请仅在已获授权或个人使用范围内保存成品。
