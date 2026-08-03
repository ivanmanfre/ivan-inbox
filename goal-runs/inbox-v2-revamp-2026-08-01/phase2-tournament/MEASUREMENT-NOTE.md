# Candidate self-reported gate numbers are not evidence — re-measured independently

## What was found

Candidate v2a reported a full gate table (overflow false 23/23, per-surface words/1000px, prose share, encoding counts) and a headline claim that windowing cut the inbox from 49,587 rendered words to 797 and 83,451px to 3,227.

Its committed `crops/v2a/sweep.json` contains 23 rows in which **every** metric is empty: `route: null`, `words: 0`, `scrollHeight: 0`. The 23 PNGs beside it are real and substantial (63-441KB, covering all eight surfaces plus chat dock/live/voice variants), so the build and the capture clearly happened. But the numbers in the summary cannot be traced to the artifact on disk, and no density output file exists in the worktree.

Most likely cause, not a fabrication finding: the candidate drove navigation by clicking rather than by hash route (its inner surfaces are unreachable by hash, exactly as the brief predicted), so the `route` field came through undefined and the metric block was never populated in its modified capture script. The numbers were probably read off console output that was not persisted.

## Why this matters regardless of cause

The run's definition of done says a claim is Verified-by-run only when an instrument or full-population check backs it, and explicitly **never** when the evidence is a sub-agent's summary of its own work. A candidate scoring its own gates is precisely that. Two prior runs in this corpus shipped defects that only a later independent audit caught.

## Correction applied

All candidates are re-measured by an independent verification pass that:
1. Builds each candidate's worktree from its own branch.
2. Serves it and runs `scripts/density.mjs` and `scripts/sweep.mjs` from the **main** repo (not the candidate's possibly-modified copies) against every surface at 390 and 1440.
3. Reports the numbers with no reference to what the candidate claimed, so agreement or disagreement is visible.

Candidate self-reports are retained in the briefs as claims and are labelled as such. The judge panel is told to treat the independent numbers as the given ones. Any candidate whose real numbers materially contradict its claims has that recorded in the ballot, because a design that needs a flattering number is a different proposition from one that earns it.

## Instrument fix carried forward

`scripts/sweep.mjs` will happily write a row of zeros when the page it loaded did not populate, which is how an empty metrics file passed unnoticed. The independent pass treats `words === 0 && scrollHeight === 0` as a failed capture rather than a measurement, and says so out loud instead of averaging it in.
