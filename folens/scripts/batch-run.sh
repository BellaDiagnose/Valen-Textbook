#!/usr/bin/env bash
# batch-run.sh — Folens / 3D Issue 分批直采驱动
#
# 每批单独起一次 agent，PDF 按 out/pages 全量重组；--resume 幂等，整批失败自动重跑一次。
# 用法（在 folens/ 目录下）：
#   FROM=1 TO=198 BATCH=20 DELAY=800 GAP=3 ./scripts/batch-run.sh
# 换书：URL=... OUT=... ./scripts/batch-run.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

NODE=${NODE:-node}
OUT=${OUT:-out}
URL=${URL:-"https://digital.folens.ie/sites/default/files/bulk_upload/EssentialScience2ndEd/ES_TB_EBOOK/index.html"}
FROM=${FROM:-1}
TO=${TO:-198}
BATCH=${BATCH:-20}
DELAY=${DELAY:-800}
GAP=${GAP:-3}
LOG="$OUT/batch.log"

mkdir -p "$OUT/pages" "$OUT/shots"
echo "=== 3D Issue 分批采集 $FROM-$TO（每批 $BATCH 页 / 页间 ${DELAY}ms）===" | tee "$LOG"
for ((s = FROM; s <= TO; s += BATCH)); do
  e=$((s + BATCH - 1)); ((e > TO)) && e=$TO
  echo "=== [$s-$e] $(date '+%H:%M:%S')" | tee -a "$LOG"
  for attempt in 1 2; do
    if "$NODE" agent.mjs --url "$URL" --out "$OUT" --pages "$s-$e" --resume --delay "$DELAY" >>"$LOG" 2>&1; then
      break
    fi
    echo "!!! 批次 $s-$e 第 $attempt 次失败，冷却 12s" | tee -a "$LOG"
    sleep 12
  done
  echo "--- 进度: $(ls "$OUT"/pages/page-*.jpg 2>/dev/null | wc -l | tr -d ' ') 页" | tee -a "$LOG"
  sleep "$GAP"
done
echo "=== 完成 $(date '+%H:%M:%S')" | tee -a "$LOG"
