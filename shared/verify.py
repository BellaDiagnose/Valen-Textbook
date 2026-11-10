#!/usr/bin/env python3
"""shared/verify.py — 成品 PDF 的真实渲染验证 + 全页质量扫描 + 总览页生成。

三套 agent 共用：provider / 页码换算从 out/pages.json 单一数据源推断，
所以各本书都能零参数复验；也可用 --out / --provider 显式指定。

依赖 pymupdf：
  python3 -m pip install pymupdf
  python3 ../shared/verify.py --out out          # 在各 agent 目录下执行
  python3 shared/verify.py --out folens/out      # 或在仓库根执行
"""
import argparse
import glob
import json
import math
import os
import re

import pymupdf

BASE = os.path.abspath(os.getcwd())
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.environ.get("OUT_DIR", "out"), help="产物目录（含 pages/ 与 PDF）")
ap.add_argument("--pdf", default=None, help="PDF 路径；缺省取 --out 下最新 .pdf")
ap.add_argument("--title", default=None, help="总览页标题；缺省取 pages.json 的 title")
ap.add_argument("--provider", choices=("flippingbook", "3dissue", "issuu"), default=None,
                help="缺省从 pages.json 推断；老 manifest 无 provider 字段时按 flippingbook 处理")
ap.add_argument("--offset", type=int, default=None, help="物理页 → 书内页码偏移；缺省从 pages.json 推断")
ap.add_argument("--page-label", choices=("physical", "sequence"), default=None,
                help="缺省按 provider 推断：3D Issue / Issuu=sequence，FlippingBook=physical")
args = ap.parse_args()

OUT = os.path.abspath(args.out)
PAGES = os.path.join(OUT, "pages")
PREVIEW = os.path.join(OUT, "preview")
if args.pdf:
    PDF = os.path.abspath(args.pdf)
else:
    cands = sorted(glob.glob(os.path.join(OUT, "*.pdf")), key=os.path.getmtime)
    if not cands:
        raise SystemExit(f"找不到 PDF: {OUT}/*.pdf")
    PDF = cands[-1]
# provider / 页码换算从 manifest 单一数据源推断，避免换书时漏传参数
MANIFEST = {}
mpath = os.path.join(OUT, "pages.json")
if os.path.exists(mpath):
    with open(mpath, encoding="utf-8") as f:
        MANIFEST = json.load(f)
PROVIDER = args.provider or MANIFEST.get("provider") or "flippingbook"
SEQUENCE_PROVIDER = PROVIDER in ("3dissue", "issuu")
OFFSET = args.offset if args.offset is not None else (0 if SEQUENCE_PROVIDER else int(MANIFEST.get("offset") or 0))
LABEL = args.page_label or ("sequence" if SEQUENCE_PROVIDER else "physical")
TITLE = args.title or MANIFEST.get("title") or os.path.splitext(os.path.basename(PDF))[0]
print(f"provider 推断: {PROVIDER} / offset={OFFSET} / label={LABEL}")

os.makedirs(PREVIEW, exist_ok=True)
doc = pymupdf.open(PDF)
n = len(doc)
print(f"验证 PDF: {os.path.basename(PDF)}（{n} 页）")

# ---------- 1. 逐页真实渲染 + 墨迹密度扫描 ----------
# 灰度低分辨率渲染后算标准差：空白页/丢文字层页 std 会塌到接近 0。
rows = []
for i in range(n):
    page = doc[i]
    if not page.get_images():
        raise RuntimeError(f"第 {i+1} 页没有图像对象")
    pix = page.get_pixmap(matrix=pymupdf.Matrix(0.16, 0.16), colorspace=pymupdf.csGRAY, alpha=False)
    s = pix.samples[::17]
    mean = sum(s) / len(s)
    var = sum((v - mean) ** 2 for v in s) / len(s)
    rows.append({"page": i + 1, "std": round(math.sqrt(var), 1), "mean": round(mean, 1)})

low = [r for r in rows if r["std"] < 8]
stds = sorted(r["std"] for r in rows)
print(f"PDF {n} 页全部含图像对象并渲染成功")
print(f"墨迹密度 std: min={stds[0]} p10={stds[n//10]} median={stds[n//2]} p90={stds[n*9//10]} max={stds[-1]}")
print("低密度页(std<8):", [(r["page"], r["std"]) for r in low])

# ---------- 2. 首 / 中 / 末页渲染存证 ----------
marks = sorted({1, (n + 1) // 2, n})
for p in marks:
    pix = doc[p - 1].get_pixmap(matrix=pymupdf.Matrix(0.8, 0.8), alpha=False)
    pix.save(os.path.join(PREVIEW, f"render-{p:03d}.png"))
print("渲染存证:", ", ".join(f"preview/render-{p:03d}.png" for p in marks))

# ---------- 3. 质量报告 ----------
files = sorted(f for f in os.listdir(PAGES) if re.fullmatch(r"page-\d{4}\.jpg", f))
sizes = {int(f[5:9]): os.path.getsize(os.path.join(PAGES, f)) for f in files}
try:
    first = pymupdf.Pixmap(os.path.join(PAGES, files[0]))
    iw, ih = first.width, first.height
except Exception:
    iw, ih = 1454, 2050
report = {
    "provider": PROVIDER,
    "pdf": os.path.basename(PDF),
    "pdf_pages": n,
    "pdf_bytes": os.path.getsize(PDF),
    "page_images": len(files),
    "page_image_size": [iw, ih],
    "missing_pages": [p for p in range(1, n + 1) if p not in sizes],
    "low_density_pages": low,
    "ink_std": {r["page"]: r["std"] for r in rows},
    "note": "PDF 为图像型：页面由 JPEG 直嵌，文字清晰但不可选中 / 搜索 / 复制。",
}
with open(os.path.join(OUT, "quality.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("质量报告 →", os.path.relpath(os.path.join(OUT, "quality.json"), BASE))

# ---------- 4. 全书总览页 ----------
def desc(p):
    if LABEL == "sequence":
        return f"第 {p} 页"
    label = p - OFFSET if p > OFFSET else 0
    return "封面 / 前置" if not label else f"书内 {label}"

cards = []
for p in range(1, n + 1):
    std = report["ink_std"][p]
    warn = " warn" if std < 8 else ""
    cards.append(
        f'<a class="card{warn}" href="pages/page-{p:04d}.jpg" target="_blank" '
        f'data-p="{p}" title="{desc(p)} · {(sizes.get(p,0)/1024):.0f}KB · std {std}">'
        f'<img loading="lazy" src="pages/page-{p:04d}.jpg" alt="{desc(p)}">'
        f'<div class="meta"><b>{p:03d}</b><span>{desc(p)}</span></div></a>'
    )

html_doc = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{TITLE} · 全书总览（{n} 页）</title>
<style>
:root {{ --bg:#f6f9fb; --card:#fff; --line:#e3ecf1; --ink:#16313f; --muted:#6b8794; --accent:#0d9488; --warn:#e0a33a; }}
* {{ box-sizing:border-box }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif }}
header {{ position:sticky; top:0; z-index:9; background:rgba(255,255,255,.94); backdrop-filter:blur(10px); border-bottom:1px solid var(--line); padding:16px 24px }}
h1 {{ margin:0 0 4px; font-size:19px; letter-spacing:.2px }}
.sub {{ color:var(--muted); font-size:12.5px }}
.stats {{ display:flex; gap:22px; flex-wrap:wrap; margin-top:12px }}
.stat {{ background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:7px 13px; min-width:112px }}
.stat b {{ display:block; font-size:17px; color:var(--accent) }}
.stat span {{ font-size:11.5px; color:var(--muted) }}
.tools {{ margin-top:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap }}
input,button {{ font:inherit; border:1px solid var(--line); border-radius:8px; padding:6px 11px; background:#fff; color:var(--ink) }}
input {{ width:120px }}
button {{ cursor:pointer }}
button:hover {{ border-color:var(--accent); color:var(--accent) }}
main {{ padding:20px 24px 60px }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:14px }}
.card {{ display:block; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; text-decoration:none; color:inherit; transition:transform .15s,box-shadow .15s }}
.card:hover {{ transform:translateY(-3px); box-shadow:0 8px 22px rgba(13,148,136,.13); border-color:var(--accent) }}
.card img {{ display:block; width:100%; aspect-ratio:{iw}/{ih}; object-fit:cover; background:#fff }}
.meta {{ display:flex; justify-content:space-between; align-items:center; padding:7px 9px; font-size:11.5px; border-top:1px solid var(--line) }}
.meta b {{ font-size:12.5px }}
.meta span {{ color:var(--muted) }}
.card.warn {{ border-color:var(--warn) }}
.card.warn .meta b::after {{ content:" ⚠"; color:var(--warn) }}
.note {{ margin:0 24px 18px; padding:11px 14px; background:#fffaf0; border:1px solid #f2dfb8; border-radius:10px; font-size:12.5px; color:#7a5b22 }}
.hide {{ display:none !important }}
</style></head><body>
<header>
  <h1>{TITLE} · 全书总览</h1>
  <div class="sub">第 1–{n} 页 · 点击任一页查看 {iw}×{ih} 高清原图</div>
  <div class="stats">
    <div class="stat"><b>{n}</b><span>PDF 页数</span></div>
    <div class="stat"><b>{len(files)}</b><span>高清页图</span></div>
    <div class="stat"><b>{report['pdf_bytes']/1024/1024:.1f} MB</b><span>PDF 体积</span></div>
    <div class="stat"><b>{len(low)}</b><span>低密度页</span></div>
    <div class="stat"><b>{len([r for r in rows if r['std']>=8])}</b><span>渲染校验通过</span></div>
  </div>
  <div class="tools">
    <input id="jump" type="number" min="1" max="{n}" placeholder="页码">
    <button onclick="jumpTo()">跳转</button>
    <button onclick="toggleLow()">仅看低密度页</button>
    <button onclick="reset()">显示全部</button>
  </div>
</header>
<div class="note">{report['note']} 低密度页（std&lt;8）多为原书空白页，已用 ⚠ 标注。</div>
<main><div class="grid" id="grid">{''.join(cards)}</div></main>
<script>
const cards=[...document.querySelectorAll('.card')];
function jumpTo(){{const v=+document.getElementById('jump').value; if(!v)return;
  const c=cards.find(x=>+x.dataset.p===v); if(c){{c.scrollIntoView({{behavior:'smooth',block:'center'}});c.style.outline='3px solid var(--accent)';setTimeout(()=>c.style.outline='',1600);}}}}
let lowOnly=false;
function toggleLow(){{lowOnly=!lowOnly;cards.forEach(c=>c.classList.toggle('hide',lowOnly&&!c.classList.contains('warn')));}}
function reset(){{lowOnly=false;cards.forEach(c=>c.classList.remove('hide'));document.getElementById('jump').value='';}}
</script></body></html>
"""
with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
    f.write(html_doc)
print("总览页 →", os.path.relpath(os.path.join(OUT, "index.html"), BASE))
