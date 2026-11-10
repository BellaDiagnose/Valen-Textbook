#!/usr/bin/env python3
"""Remove a fixed, semi-transparent neutral-grey overlay from a page-image set.

Principle
---------
The watermark is constant across every page while the printed content is not.
A cross-page high-percentile image therefore isolates the overlay: page content
is outvoted, the constant watermark survives.  Morphological closing of that
image estimates the un-watermarked background, and the difference is the local
darkening field D(x, y) calibrated on white paper (B = 255).

The overlay behaves as a semi-transparent dark layer, i.e. a multiplicative
attenuation  I = B * (1 - k).  Its darkening is therefore proportional to the
underlying paper brightness:  Delta = k * B.  With k = D / 255 the restoration
is  B = I / (1 - k) ~= I + D * B / 255.  Using the page's own local background
(estimated by a large morphological closing that fills dark strokes) as a
first-order estimate of B avoids the division and its noise amplification near
k -> 1:

    B = clip(I + g * D * f),   f = bg_local / 255

On white paper f = 1 and this reduces to the plain additive form; on tinted or
dark artwork f < 1 and the compensation scales down instead of overshooting
into a bright ("white watermark") halo.  D is zero outside watermark strokes,
so those pixels are untouched.  No inpainting and no generative fill are used:
the underlying pixels were never lost, only attenuated.

Usage
-----
  dewatermark.py analyze --book DIR [--sample 48] [--percentile 95]
  dewatermark.py apply   --book DIR [--pages 1,2,3] [--gain 1.0] [--all]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from collections import Counter

import cv2
import numpy as np
from PIL import Image

PAGE_GLOB = "page-*.jpg"
SUBDIR = "dewatermark"
CLEAN_DIR = "pages-clean"
KERNEL = 41
BG_KERNEL = 61
FLOOR = 1.0
CEIL = 110.0
BLUR = 0.6
GAIN = 1.15
EDGE_FRAC = 0.025
MIN_AGREEMENT = 0.60
MIN_COVERAGE = 0.008
MIN_BAND_ENERGY = 0.80
MIN_HIGH_RATIO = 0.008
JPEG_QUALITY = 95


def page_files(book: str, subdir: str = "pages") -> list[str]:
    files = sorted(glob.glob(os.path.join(book, subdir, PAGE_GLOB)))
    if not files:
        raise SystemExit(f"no page images under {book}/{subdir}/")
    return files


def size_of(path: str) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def reference_size(files: list[str]) -> tuple[int, int]:
    return Counter(size_of(p) for p in files).most_common(1)[0][0]


def load_gray(path: str, size: tuple[int, int]) -> np.ndarray:
    im = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if im is None:
        raise SystemExit(f"cannot decode {path}")
    if (im.shape[1], im.shape[0]) != size:
        im = cv2.resize(im, size, interpolation=cv2.INTER_LINEAR)
    return im


def darkening_field(stack: np.ndarray, percentile: float) -> np.ndarray:
    n = stack.shape[0]
    k = min(n - 1, int(round(percentile / 100.0 * (n - 1))))
    part = np.partition(stack, k, axis=0)
    background = part[k].astype(np.float32)
    del part
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (KERNEL, KERNEL))
    closed = cv2.morphologyEx(background, cv2.MORPH_CLOSE, kernel)
    d = np.clip(closed - background, 0.0, 255.0)
    d = cv2.GaussianBlur(d, (0, 0), BLUR)
    d = np.clip(d - FLOOR, 0.0, CEIL)
    edge = max(1, int(d.shape[0] * EDGE_FRAC))
    d[:edge, :] = 0.0
    d[-edge:, :] = 0.0
    return d


def signed_residual(stack: np.ndarray, percentile: float) -> np.ndarray:
    """Signed leftover structure: >0 dark strokes, <0 bright (white) halo.

    A plain darkening field clips negative values, so it is blind to the bright
    halo produced by over-compensating on dark artwork.  Comparing the closing
    and opening of the cross-page percentile image exposes both directions.
    """
    n = stack.shape[0]
    k = min(n - 1, int(round(percentile / 100.0 * (n - 1))))
    p = np.partition(stack, k, axis=0)[k].astype(np.float32)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (KERNEL, KERNEL))
    closed = cv2.morphologyEx(p, cv2.MORPH_CLOSE, kernel)
    opened = cv2.morphologyEx(p, cv2.MORPH_OPEN, kernel)
    s = cv2.GaussianBlur((closed - p) - (p - opened), (0, 0), BLUR)
    edge = max(1, int(s.shape[0] * EDGE_FRAC))
    s[:edge, :] = 0.0
    s[-edge:, :] = 0.0
    return s


def analyze(book: str, sample: int, percentile: float) -> None:
    files = page_files(book)
    size = reference_size(files)
    outdir = os.path.join(book, SUBDIR)
    os.makedirs(outdir, exist_ok=True)

    idx = np.unique(np.linspace(0, len(files) - 1, min(sample, len(files))).astype(int))
    stack = np.stack([load_gray(files[i], size) for i in idx])
    print(f"[analyze] {len(files)} pages, ref={size}, sampled={len(idx)}, stack={stack.nbytes/1e6:.0f} MB")

    full = darkening_field(stack, percentile)
    half = len(idx) // 2
    d1 = darkening_field(stack[::2], percentile)
    d2 = darkening_field(stack[1::2], percentile)
    sd1, sd2 = float(d1.std()), float(d2.std())
    agreement = (float(np.corrcoef(d1.ravel(), d2.ravel())[0, 1])
                 if half > 2 and sd1 > 1e-6 and sd2 > 1e-6 else 0.0)

    mask = full > 1.0
    coverage = float(mask.mean())
    high_ratio = float((full > 30).mean())
    h, w = full.shape
    u = (np.arange(h, dtype=np.float32)[:, None] / h +
         np.arange(w, dtype=np.float32)[None, :] / w)
    band = (u > 0.65) & (u < 1.35)
    band_energy = float(full[band].sum() / max(full.sum(), 1e-6))
    constant = bool(agreement >= MIN_AGREEMENT and coverage >= MIN_COVERAGE
                    and band_energy >= MIN_BAND_ENERGY and high_ratio >= MIN_HIGH_RATIO)
    report = {
        "book": os.path.basename(book),
        "pages": len(files),
        "reference_size": list(size),
        "sampled": int(len(idx)),
        "percentile": percentile,
        "split_half_correlation": round(agreement, 4),
        "watermark_pixel_ratio": round(coverage, 4),
        "diagonal_band_energy": round(band_energy, 4),
        "high_strength_ratio": round(high_ratio, 4),
        "page_constant_watermark": constant,
        "darkening_max": round(float(full.max()), 2),
        "darkening_mean_on_strokes": round(float(full[mask].mean()), 2) if mask.any() else 0.0,
        "background_median": round(float(np.median(full)), 3),
    }
    np.savez_compressed(os.path.join(outdir, "field.npz"),
                        d=full.astype(np.float32), size=np.array(size))
    preview = np.clip(full * (255.0 / max(full.max(), 1.0)), 0, 255).astype(np.uint8)
    Image.fromarray(preview).save(os.path.join(outdir, "field-preview.png"))
    with open(os.path.join(outdir, "analyze.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    if not report["page_constant_watermark"]:
        print("[skip] no page-constant watermark detected; apply will refuse this book")


def restore(path: str, d: np.ndarray, size: tuple[int, int], gain: float,
            dst: str, quality: int) -> dict:
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit(f"cannot decode {path}")
    h, w = im.shape[:2]
    field = d if (w, h) == size else cv2.resize(d, (w, h), interpolation=cv2.INTER_LINEAR)
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (BG_KERNEL, BG_KERNEL))
    bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel).astype(np.float32)
    modulation = np.clip(bg / 255.0, 0.0, 1.0)
    modulation[field < 0.5] = 0.0
    compensation = field * modulation * gain
    out = np.clip(im.astype(np.float32) + compensation[:, :, None], 0, 255).astype(np.uint8)
    cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, quality,
                           cv2.IMWRITE_JPEG_SAMPLING_FACTOR,
                           cv2.IMWRITE_JPEG_SAMPLING_FACTOR_444])
    clean_zone = field < 0.5
    delta = np.abs(out.astype(np.int16) - im.astype(np.int16))
    strokes = field > 1.0
    return {
        "page": os.path.basename(path),
        "size": [w, h],
        "changed_ratio": round(float(strokes.mean()), 4),
        "clean_zone_max_delta": int(delta[clean_zone].max()) if clean_zone.any() else 0,
        "clean_zone_mean_delta": round(float(delta[clean_zone].mean()), 3) if clean_zone.any() else 0.0,
        "mean_compensation": round(float(field[strokes].mean()), 2) if strokes.any() else 0.0,
        "mean_modulation": round(float(modulation[strokes].mean()), 3) if strokes.any() else 0.0,
        "mean_applied": round(float(compensation[strokes].mean()), 2) if strokes.any() else 0.0,
    }


def comparison(before: str, after: str, dst: str, width: int = 620) -> None:
    a = Image.open(before).convert("RGB")
    b = Image.open(after).convert("RGB")
    scale = width / a.width
    h = int(a.height * scale)
    a = a.resize((width, h), Image.LANCZOS)
    b = b.resize((width, h), Image.LANCZOS)
    canvas = Image.new("RGB", (width * 2 + 12, h), (238, 238, 238))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (width + 12, 0))
    canvas.save(dst)


def apply(book: str, pages: str | None, gain: float, all_pages: bool,
          compare: bool, quality: int) -> None:
    meta_path = os.path.join(book, SUBDIR, "analyze.json")
    with open(meta_path) as f:
        meta = json.load(f)
    if not meta.get("page_constant_watermark"):
        raise SystemExit(f"refusing: {book} has no page-constant watermark "
                         f"(agreement={meta['split_half_correlation']}, "
                         f"coverage={meta['watermark_pixel_ratio']})")
    field_path = os.path.join(book, SUBDIR, "field.npz")
    if not os.path.exists(field_path):
        raise SystemExit("run analyze first")
    data = np.load(field_path)
    d = data["d"].astype(np.float32)
    size = tuple(int(x) for x in data["size"])
    files = page_files(book)
    wanted = (list(range(1, len(files) + 1)) if all_pages else
              [int(x) for x in (pages or "1,2,3").split(",")])
    clean_dir = os.path.join(book, CLEAN_DIR)
    outdir = os.path.join(book, SUBDIR)
    os.makedirs(clean_dir, exist_ok=True)
    results = []
    for n in wanted:
        src = files[n - 1]
        dst = os.path.join(clean_dir, os.path.basename(src))
        r = restore(src, d, size, gain, dst, quality)
        results.append(r)
        if compare:
            comparison(src, dst, os.path.join(outdir, f"compare-{n:04d}.png"))
        print(f"[apply] {n:4d}/{len(files)} changed={r['changed_ratio']:.3f} "
              f"clean_delta_max={r['clean_zone_max_delta']}")
    report = {"gain": gain, "quality": quality, "pages": len(results), "results": results}
    with open(os.path.join(outdir, "apply.json"), "w") as f:
        json.dump(report, f, indent=2)


def verify(book: str, sample: int, percentile: float) -> None:
    outdir = os.path.join(book, SUBDIR)
    with open(os.path.join(outdir, "analyze.json")) as f:
        meta = json.load(f)
    if not meta["page_constant_watermark"]:
        print(f"[verify] {book}: no watermark, nothing to verify")
        return
    size = tuple(meta["reference_size"])
    files = page_files(book, CLEAN_DIR)
    idx = np.unique(np.linspace(0, len(files) - 1, min(sample, len(files))).astype(int))
    stack = np.stack([load_gray(files[i], size) for i in idx])
    residual = darkening_field(stack, percentile)
    signed = signed_residual(stack, percentile)
    source = np.load(os.path.join(outdir, "field.npz"))["d"].astype(np.float32)
    strokes = source > 10
    report = {
        "book": os.path.basename(book),
        "clean_pages": len(files),
        "sampled": int(len(idx)),
        "watermark_stroke_pixels": int(strokes.sum()),
        "field_before_mean": round(float(source[strokes].mean()), 2),
        "field_after_mean": round(float(residual[strokes].mean()), 2),
        "residual_ratio": round(float(residual[strokes].mean() / source[strokes].mean()), 4),
        "signed_mean_on_strokes": round(float(signed[strokes].mean()), 2),
        "bright_halo_ratio": round(float((signed[strokes] < -8).mean()), 4),
        "dark_residual_ratio": round(float((signed[strokes] > 8).mean()), 4),
    }
    with open(os.path.join(outdir, "verify.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--book", required=True)
    a.add_argument("--sample", type=int, default=48)
    a.add_argument("--percentile", type=float, default=95)
    b = sub.add_parser("apply")
    b.add_argument("--book", required=True)
    b.add_argument("--pages", default=None)
    b.add_argument("--gain", type=float, default=GAIN)
    b.add_argument("--quality", type=int, default=JPEG_QUALITY)
    b.add_argument("--all", action="store_true")
    b.add_argument("--no-compare", action="store_true")
    c = sub.add_parser("verify")
    c.add_argument("--book", required=True)
    c.add_argument("--sample", type=int, default=48)
    c.add_argument("--percentile", type=float, default=95)
    args = ap.parse_args()
    if args.cmd == "analyze":
        analyze(args.book, args.sample, args.percentile)
    elif args.cmd == "verify":
        verify(args.book, args.sample, args.percentile)
    else:
        apply(args.book, args.pages, args.gain, args.all, not args.no_compare,
              args.quality)


if __name__ == "__main__":
    main()
