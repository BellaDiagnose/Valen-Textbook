# flippingbook/ — FlippingBook Online 采集

> 目标：给定 `online.flippingbook.com/view/<hid>/` 链接，自动**翻页 → 截图 → 合成高清页图 → 组装 PDF**。
> 已验证：*Linking Thinking 1 Textbook*，322 物理页 / 308 标签页，offset=14。
> 另一套引擎（Folens / 3D Issue）见 [`../folens/README.md`](../folens/README.md)。

## 设计总览

```
1. discover          2. plan              3. 逐页循环 flip/capture
借 viewer 拿签名  →  pager.json +      →  3a. flip：URL 深链 / 点击按钮
凭据（通配授权）     页码偏移推断         3b. screenshot：视图存证
                                        3c. harvest：substrate + vector 合成
                                                  ↓
                              4. assemble：shared/pdf.mjs JPEG→PDF 直嵌
```

## 关键机制（实测 FlippingBook Online 4.36）

### 1. 签名凭据可以"借"

```
https://d17lvj5xn8sco6.cloudfront.net/<hex-path>/<pubId>/common/pages/
  html5substrates/page%04d_<level>.<jpg|webp>?Key-Pair-Id=…&Policy=…&Signature=…
```

- `Policy` 是 `…/<pubId>/*` **通配授权** → 从 viewer 已加载的 `<img>` 抓一条 URL，
  签名即可复用到该出版物的全部资源（含 `pager.json`、`vector/*.svg`）。
- 凭据有有效期（EpochTime），agent 每次运行现场获取，不持久化。分批脚本每批重启 agent 重借一次。

### 2. 资源地图

| 资源 | 路径模板 | 说明 |
|---|---|---|
| 页面位图 | `common/pages/html5substrates/page%04d_{1..4}.jpg` | 高度档位 650/960/1350/2050px（`_4` 最清晰，仅 jpg） |
| 矢量文字层 | `common/pages/vector/%04d.svg` | 文字 + 内嵌 base64 字体，自包含，可独立渲染 |
| 页面元数据 | `common/pager.json` | bookSize(pt)、每页 substrateSizes / links / 文字层标记 |
| 深链翻页 | `/view/<hid>/<N>/` | 直达含标签页 N 的跨页 |

### 3. 标签页 → 物理页映射

状态栏 `Pages: xiv - 1 out of 308` 给出标签区间。进入 `/1/` 后：

- 左页是罗马数字 → `offset = romanVal(left)`（本书 xiv=14 → 标签 N = 物理页 N+14）
- 否则 `offset = left - 1`

已实测验证：标签 4→0018、5→0019。**偏移锚定必须在 `/1/`**，任意入口页的标签无法自证偏移。

### 4. 为什么"合成"而不是"直取 substrate"

文字走独立矢量层（`vectorText:true`），substrate 位图**不含文字**；viewer 自己就是
`bg-layer`(substrate) + `svg-layer`(SVG blob img) 两层叠加。所以高清采集 =
在浏览器里离屏挂载 `substrate 底图 + 矢量 SVG`，再元素级截图。

## 使用

在 `flippingbook/` 目录下执行（依赖由仓库根 `npm install` 装齐）：

```bash
npm install                    # 仓库根，workspaces
npx agent-browser install      # 首次：下载 Chrome for Testing

cd flippingbook
node agent.mjs --pages 1-5                       # 默认：深链翻页 + 合成引擎 + 拼 PDF
node agent.mjs --pages 1-5 --mode click          # 用 "Next page" 按钮翻页（模拟真实用户）
node agent.mjs --pages 1-5 --engine cdn          # 直取 CDN substrate（快，但无文字层）
node agent.mjs --physical 1-14                   # 物理页模式（封面 / 罗马前置页，无跨页截图）
node agent.mjs --pages 1-10 --resume             # 增量续跑：跳过已有页图，PDF 全量重组
node agent.mjs --pages 1-5 --no-pdf              # 只存图
node agent.mjs --pages 1-10 --delay 1200         # 页间节流 1.2s
```

换书用 `--url <viewer 深链> --title <书名> --slug <PDF 文件名前缀> --out <产物目录>`；
`--out` 默认 `out`。不传 `--pages` 也不传 `--physical` 会直接报错，避免静默跑出错页。

PDF 组装始终基于 `out/pages/` 现有全部页图 → 多次增量运行自动合并成一本。

### 分批慢速采集（推荐用于长区间）

```bash
# 标签 11-86（= 物理页 25-100），每批 10 页，页间 1.2s，批间冷却 6s
FROM=11 TO=86 BATCH=10 DELAY=1200 GAP=6 ./scripts/batch-run.sh
```

`scripts/batch-run.sh` 的行为：

- **每批重启一次 agent** → 重新借 CloudFront 签名，规避 Policy 有效期；
- 每批带 `--resume`，单批失败冷却 15s 后整批重试（已成功页自动跳过，幂等）；
- 每批结束全量重组 PDF，并只保留最新一份（旧 PDF 自动清理）；
- 进度日志可重定向：`… > out/batch-100.log 2>&1`；
- 环境变量 `URL / OUT / SLUG / OFFSET / NODE / MODE / RETRY_GAP` 均可覆盖；
- 区间换算：**物理页 = 标签页 + OFFSET**（默认 14），想采到物理 100 → `TO=86`。

全书 322 物理页已用 `FROM=87 TO=308 BATCH=10 DELAY=1200 GAP=6 ./scripts/batch-run.sh` 跑完
（标签上限 308 = 物理 322）。

## 坑位记录（全书 322 页实测）

- **跨页定位用状态栏文本，禁用 img 可见性**：大视口下 viewer 把当前跨页画在 canvas 上，
  `<img>` 可能根本不存在；元素截图动作还会触发 viewer 重渲染、img 集合重建。
  唯一可靠信号是 `Pages: 6 - 7 out of 308`。
- **状态栏有单页格式**：末页显示 `Pages: 308 out of 308`（无 `left - right`），解析器必须同时
  支持双页与单页两种格式，否则最后一页 `waitAtLabel` 必然超时、整批崩溃。
- **U+200E**：状态栏文本混有方向控制符，正则前 strip `[\u2000-\u202F\u00A0]`。
- **spawn E2BIG**：密集文字页的矢量 SVG 可达数百 KB，base64 注入 `agent-browser eval` 会超
  ARG_MAX。改为让浏览器 `<img>` 直接加载带签名的 CDN URL，eval 参数只剩几十字节；
  实测同页产出与 base64 方案仅差 2 字节。SVG 404 时用 `onerror` 隐藏该层。
- **视口**：合成画布 1454×2050 必须整体在视口内，先 `set viewport 1470 2070`，否则 CDP
  元素截图丢视口外内容（表现为下半页全白）。
- **eval 双层 JSON**：CLI 把 eval 返回值再 JSON 编码一次；脚本约定返回 `JSON.stringify(x)`，
  解析时解两层，布尔表达式也要包 `JSON.stringify(...)`。eval 不 await Promise，异步资源加载
  交给浏览器原生 `<img>` + Node 侧轮询 `complete`。
- **跨页配对**：标签 (2,3)(4,5)(6,7)… 同跨页；click 模式目标已在当前跨页则免翻页。
- **动画竞态**：翻页后固定 settle 1.5s，否则抓到翻页动画中途（半透明空白帧）。
- **确定性失败靠整批重试无效**：E2BIG / 状态栏格式这类问题每批都复现，必须先改代码，
  再用 `--resume` 补采缺页（页图存在但 manifest 无记录的页也会一并补齐）。

## 产出结构（全书完成态）

```
out/
├── index.html                            # 全书总览：322 页缩略图、页码跳转、异常页筛选
├── quality.json                          # 全量渲染校验报告（每页墨迹密度 / 缺页）
├── preview/render-001.png / -161 / -322   # PDF 首/中/末页真实渲染存证
├── pages.json                            # manifest 322 条（provider/offset/书内标签→物理页映射）
├── batch-100.log / batch-full.log         # 两阶段分批运行日志
├── pages/page-0001.jpg … page-0322.jpg    # 322 张 1454×2050 高清页图（底图+文字合成）
├── shots/spread-001.png … spread-308.png  # 308 张浏览器翻页跨页截图
└── linking-thinking-1_ph1-ph322.pdf       # 597×842pt / 322 页 / 131.51 MB
```

## 采集进度与最终校验

| 阶段 | 范围 | 批数 | 耗时 | 结果 |
|---|---|---|---|---|
| 试点 | 物理 1-24（封面 + 罗马前置 + 标签 1-10） | — | — | ✅ |
| 第一批 | 物理 25-100（标签 11-86） | 8 | 12m22s | ✅ 零失败 |
| 全书续跑 | 物理 101-322（标签 87-308） | 23 | 43m29s | 2 页缺口，已修复补采 |
| 补采 | 物理 254（E2BIG）、321/322（末页单页格式） | 1 | ~20s | ✅ 322/322 |

- 结构：322 张页图全部 1454×2050、无缺页；manifest 322 条；跨页截图 308 张无缺号；
  PDF 322 个 Page 对象 / `Count 322` / xref + EOF 正常。物理 2 是封面背面空白页（原书如此）。
- 真实渲染：PyMuPDF 逐页打开 322 页，每页都含图像对象且渲染成功。
- 全页墨迹密度扫描：min 0.0 / p10 21.7 / median 28.2 / max 87.6，仅物理页 2 为 0，
  其余 321 页均 ≥21.7 → **无静默丢失文字层的页**。

## 复验

```bash
python3 -m pip install pymupdf
./scripts/verify.sh                # 等价于 python3 ../shared/verify.py --out out
```

`shared/verify.py` 会重新生成 `quality.json`、`preview/` 三张渲染存证与 `index.html` 总览页；
从 `pages.json` 自动推断 `provider=flippingbook` / `offset=14` / `physical` 页码标签，零参数即可。
`--pdf / --title / --offset / --page-label / --provider` 可显式覆盖。
也可用 `PYTHON=<带 pymupdf 的解释器> ./scripts/verify.sh`。

从头重跑（标签 1-308 覆盖物理 15-322；封面/前置页另需 `--physical 1-14`）：

```bash
node agent.mjs --physical 1-14 --resume
FROM=1 TO=308 BATCH=10 DELAY=1200 GAP=6 ./scripts/batch-run.sh > out/batch-full.log 2>&1
```

## 代码结构

```
agent.mjs               独立入口：CLI + discover/plan/flip/harvest/assemble
lib/browser.mjs         agent-browser CLI 封装（含 CLI 路径自动解析）
lib/discover.mjs        签名凭据、pager.json、页码偏移、资源 URL 模板
lib/fetcher.mjs         带重试的下载器 + 分辨率档位降级
scripts/batch-run.sh    分批慢速采集驱动
scripts/verify.sh       成品复验 wrapper
../shared/pdf.mjs       JPEG→PDF 直嵌（两套引擎共用）
../shared/util.mjs      CLI / 区间 / 节流（两套引擎共用）
../shared/verify.py     成品复验（两套引擎共用）
```

> **PDF 是图像型**：页面由 JPEG 直嵌，矢量文字层已光栅化进页图，文字清晰但
> **不可选中 / 搜索 / 复制**。本项目不叠加 OCR 文本层。
