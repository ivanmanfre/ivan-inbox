# Regen clobber investigation (agent sweep of all 268 n8n workflows, 2026-08-03)

## post_body overwriters on EXISTING carousel_drafts rows (all ACTIVE, none human_edited-aware)
- Post Generation g4OANBwBpHL6gyRK (webhook post-gen-v2 + Engine Trigger): Set Post Content Field
  (unconditional PATCH post_body), Set Image URL Field / Block Image (image_urls replace or []),
  Lint Give-Up + QA Give-Up (post_body=failingText + status=error)
- CLIENT Rise DTC Post Generation MAX 5WjbV0eks4d9Wyh5: identical node set
- CLIENT Rise DTC Post Generation API-FALLBACK e66LhBmXERozhKul: identical node set
- Carousel Generation 0zD6WZRBD7FnaAhw (sub-workflow): caption writes to post_body + taxonomy merges

## Regen initiators
- Proxy Health Probe + Recovery KJA6fSNvDztpAA7z (every 10 min): auto-selects status=error rows,
  flips to generating, re-fires post-gen — ZERO human action. Sneakiest chain: human edit -> later
  failure flips row to error -> auto-regen clobbers.
- Post-Gen Queue Drainer aBjPr3m7RdHZNF2o (every 1 min): skip-guard is status+length only.
- personal-site studioActions.regenerateDraft: merges STALE client-held taxonomy — can drop a fresh
  human_edited stamp. The one legitimate overwrite path (deliberate human regen).
- Rise Idea Kickoff FsuRkf1owG1QpcyD; Failure Handler G50ohygdst5N578Z + Stuck Sentinel
  Awe0yXVCPS9kIy5p (flip rows to error -> feeds Proxy Recovery).

## Non-writers (verified node-by-node): Auto-Scheduler, Newsjack Slot Claim, Editorial Agent, Bridge,
URN Write-back, Buffer/Scheduled publishers, IG Caption Gen (ig_caption only), Slide Re-gen
(pdf_url/slide_metadata), Funnel Tagger, Board Queue Sync, Competitor Gate Watcher, LM wfs, edge fns,
render/video repos. Photo Assigners are guarded (fill-empty only).

## Chosen guard (orchestrator decision)
DB trigger (BEFORE UPDATE ON carousel_drafts): when OLD.taxonomy->>'human_edited'='true' and the
writer is service_role (n8n/engines), preserve OLD.post_body and OLD.image_urls; authenticated user
writes pass through; clearing the flag re-licenses engine overwrite (deliberate-regen escape hatch).
One additive reversible migration beats 6 edits on live engines/schedulers. PostgREST NULL trap
(is.false misses NULL) avoided entirely by not using URL filters.
Residual (named, not built): Drainer/Proxy-Recovery could SELECT-exclude human_edited rows to avoid
wasted generation tokens; regenerateDraft stale-taxonomy merge unfixed (personal-site repo).
Workflow JSON cache: scratchpad wf_dump/ (session-local).
