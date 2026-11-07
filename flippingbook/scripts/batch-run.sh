#!/usr/bin/env bash
# batch-run.sh — FlippingBook 分批慢速采集驱动
#
# 每批单独启动一次 agent（重新借 CloudFront 签名，规避 Policy 过期）；
# 批内通过 --delay 页间节流，批间通过 GAP 冷却；失败整批 --resume 重跑（幂等，已成功页自动跳过）。
# 每批结束都全量重组 PDF，并只保留最新一份 PDF。
#
# 用法（在 flippingbook/ 目录下）：
#   FROM=11 TO=86 BATCH=10 DELAY=1200 GAP=6 ./scripts/batch-run.sh
#   FROM=11 TO=20 BATCH=10 GAP=0 ./scripts/batch-run.sh   # 先跑一小批验证
# 换书：URL=... SLUG=... OFFSET=... OUT=... ./scripts/batch-run.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

NODE=${NODE:-node}
OUT=${OUT:-out}
URL=${URL:-"https://online.flippingbook.com/view/871445034/x/"}
SLUG=${SLUG:-linking-thinking-1}
OFFSET=${OFFSET:-14}
FROM=${FROM:-11}
TO=${TO:-86}
BATCH=${BATCH:-10}
DELAY=${DELAY:-1200}
GAP=${GAP:-6}
RETRY_GAP=${RETRY_GAP:-15}
MODE=${MODE:-url}

echo "=== batch-run: labels $FROM-$TO / batch=$BATCH / delay=${DELAY}ms / gap=${GAP}s ==="
echo "    root=$ROOT  out=$OUT  offset=+$OFFSET (physical $((FROM+OFFSET))-$((TO+OFFSET)))"

mkdir -p "$OUT/pages" "$OUT/shots"
for ((s=FROM; s<=TO; s+=BATCH)); do
  e=$((s + BATCH - 1))
  (( e > TO )) && e=$TO
  echo ""
  echo "=== [$(date '+%H:%M:%S')] BATCH labels $s-$e → physical $((s+OFFSET))-$((e+OFFSET)) ==="

  attempt=1
  while :; do
    "$NODE" agent.mjs --url "$URL" --out "$OUT" --slug "$SLUG" \
      --pages "$s-$e" --resume --delay "$DELAY" --mode "$MODE"
    rc=$?
    if (( rc == 0 )); then break; fi
    if (( attempt >= 2 )); then
      echo "!!! BATCH $s-$e 两次尝试后仍有失败页，继续下一批（可用 --resume 补采）"
      break
    fi
    attempt=$((attempt + 1))
    echo "--- 批 $s-$e 首次失败(rc=$rc)，冷却 ${RETRY_GAP}s 后 --resume 重试 ---"
    sleep "$RETRY_GAP"
  done

  # 只保留最新一份 PDF，避免中间产物堆积
  ls -1t "$OUT/${SLUG}"_ph*.pdf 2>/dev/null | tail -n +2 | while IFS= read -r f; do rm -f "$f"; done
  echo "--- 进度: $(ls "$OUT"/pages/page-*.jpg 2>/dev/null | wc -l | tr -d ' ') 页图 / $(ls "$OUT"/*.pdf 2>/dev/null | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"

  if (( e < TO )); then
    echo "--- 批间冷却 ${GAP}s ---"
    sleep "$GAP"
  fi
done

echo ""
echo "=== [$(date '+%H:%M:%S')] ALL BATCHES DONE ==="
echo "页图总数: $(ls "$OUT"/pages/page-*.jpg 2>/dev/null | wc -l | tr -d ' ')"
echo "跨页截图: $(ls "$OUT"/shots/spread-*.png 2>/dev/null | wc -l | tr -d ' ')"
ls -lh "$OUT"/*.pdf 2>/dev/null
