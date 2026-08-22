#!/bin/bash
# Run the chip probe across every viewport/theme this phase has a gate at.
#   ./run-probes.sh before|after [baseUrl]
set -u
TAG="${1:-after}"
BASE="${2:-http://localhost:4186/}"
D="$(cd "$(dirname "$0")" && pwd)"
for cfg in "1440 dark" "1440 light" "390 dark" "390 light" "2560 dark"; do
  set -- $cfg
  W="$1"; T="$2"
  node "$D/cal-probe.mjs" "$BASE" "$D/probe-$TAG-$W-$T.json" "$W" "$T" >/dev/null 2>&1
  node -e "
    const j=require('$D/probe-$TAG-$W-$T.json')
    console.log('$W $T'.padEnd(12),
      'chip', j.chip && j.chip.size,
      '| cell', j.ownCell,
      '| ratio', j.chipShareOfOwnCell,
      '| dL', j.lightnessStep.delta,
      '| same', j.lightnessStep.same,
      '| overflow', j.cellsWithOverflow,
      '| 2+days', j.daysWithTwoPlus,
      '| more', j.moreButtons,
      '| title[]', j.nativeTitleOnChip,
      '| writes', j.attemptedWrites)
  "
done
