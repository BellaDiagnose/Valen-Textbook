#!/usr/bin/env bash
# 复验本模块成品：真实渲染 + 墨迹密度扫描 + 总览页（需 python3 + pymupdf）
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec "${PYTHON:-python3}" ../shared/verify.py --out out-essential-science-2nd "$@"
