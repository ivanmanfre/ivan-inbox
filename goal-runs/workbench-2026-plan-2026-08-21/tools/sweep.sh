#!/bin/bash
# Phase 6 verification sweep. Runs every gate the run is held to and writes its
# evidence under goal-runs/workbench-2026-plan-2026-08-21/final/.
#
# Nothing here trusts a summary: the build is the real gate, the screenshots are
# authed, and the stock control is compared against a capture taken from a clean
# `main` worktree before any of this work started.
set -u
REPO=/Users/ivanmanfredi/Desktop/ivan-inbox
RUN=$REPO/goal-runs/workbench-2026-plan-2026-08-21
OUT=$RUN/final
mkdir -p "$OUT"
cd "$REPO" || exit 1

echo "=== 1. build (tsc -b && vite build) ==="
npm run build > "$OUT/build.log" 2>&1
BUILD=$?
tail -4 "$OUT/build.log"
echo "build exit: $BUILD"

echo
echo "=== 2. tests ==="
npm test > "$OUT/test.log" 2>&1
grep -E "Test Files|Tests " "$OUT/test.log" | tail -2

echo
echo "=== 3. lint ==="
npm run lint > "$OUT/lint.log" 2>&1
tail -3 "$OUT/lint.log"

echo
echo "=== 4. voice gate (added lines only) ==="
node "$RUN/tools/voice-lint.mjs" --base main > "$OUT/voice.log" 2>&1
tail -6 "$OUT/voice.log"

echo
echo "=== 5. session ==="
node "$RUN/tools/refresh.mjs"

echo
echo "=== 6. preview on 4173 ==="
lsof -ti :4173 | xargs kill 2>/dev/null
sleep 1
(npx vite preview --port 4173 --strictPort > /tmp/wb-final-preview.log 2>&1 &)
sleep 5
curl -s -o /dev/null -w "preview http: %{http_code}\n" http://localhost:4173/

echo
echo "=== 7. full sweep, dark, 9 lanes x 4 viewports ==="
node "$RUN/tools/measure.mjs" --out "$OUT/dark" --shots 2>&1 | tail -12

echo
echo "=== 8. full sweep, light, 1440 ==="
node "$RUN/tools/measure.mjs" --out "$OUT/light" --theme light --viewports 1440 --shots 2>&1 | tail -4

echo
echo "=== 9. #exp/stock control, after ==="
node "$RUN/tools/stock-shot.mjs" --base http://localhost:4173/ --out "$OUT/stock-after"
echo "--- stock before vs after (sha256 of decoded PNG) ---"
for vw in 390 1024 1440; do
  A=$(shasum -a 256 "$RUN/stock-before/stock-$vw.png" 2>/dev/null | cut -d' ' -f1)
  B=$(shasum -a 256 "$OUT/stock-after/stock-$vw.png" 2>/dev/null | cut -d' ' -f1)
  SA=$(stat -f%z "$RUN/stock-before/stock-$vw.png" 2>/dev/null)
  SB=$(stat -f%z "$OUT/stock-after/stock-$vw.png" 2>/dev/null)
  if [ "$A" = "$B" ]; then echo "  $vw: IDENTICAL"; else echo "  $vw: DIFFERS (before ${SA}b, after ${SB}b) - open both and look before concluding"; fi
done

echo
echo "=== done. evidence in $OUT ==="
