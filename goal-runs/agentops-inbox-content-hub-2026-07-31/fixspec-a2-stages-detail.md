# Cand-A round 2: pipeline stages + draft detail register (Ivan's ballot feedback 2026-07-31)
Scope: src/exp/cand-a/ + ADDITIVE ONLY changes to src/lib/content.ts + src/lib/content.test.ts + src/hooks/useContent.ts. Verify tsc + vitest + build. Commit nothing.

## 1. Queue reorganized: lifecycle stages, not triage buckets
Ivan: "pretty shitty the way stages are... separate on our end on ideas, review, approved". Replace the D5 triage-bucket ordering with PIPELINE ORDER sections:
Ideas -> Generating -> Needs review (actionable, approve/skip stays) -> Approved -> Scheduled -> Published (recent). 
- Errors and stuck-scheduled become a compact red alert strip pinned ABOVE the pipeline (count + tap scrolls), not sections mid-flow. Approved-unscheduled stays a visible sub-line inside Approved ("N approved without a date").
- Keep a compact stage rail (horizontal chip counts in pipeline order) replacing the 2x2 tile grid; tap scrolls to section. Severity color only on Error/Stuck chips with count>0.
- The 'unknown/other' catch stays at bottom (never dropped).
- Statuses map: idea->Ideas, generating->Generating, review->Needs review, approved->Approved, scheduled->Scheduled, published->Published, error+stuck->alert strip, disqualified/skipped->collapsed Archived row.

## 2. Rise lane: board-visibility separation
carousel_drafts.board_visible marks whether the row is PROMOTED onto Rise's client board (operator_set_board_visible flow). In the Rise lane every card carries a pill: "On Rise's board" (accent, board_visible=true) vs "Internal" (neutral, false). Add a lane-header line: "N of M visible on Rise's board". Rise stays read-only (D7). Same pipeline sections as Ivan lane.

## 3. Draft detail screen (both lanes, push full-screen like ThreadScreen)
Tap any card -> DraftDetail. New lib fn fetchDraftDetail(id): select=* single row (list fetch stays slim). Render, showing only populated fields, in this order:
- Header: title, type chip, status chip, lane pill (+ board_visible pill on Rise rows).
- Dates row: created_at, updated_at, scheduled_at, published_at (relative + absolute on tap or small).
- Source block: taxonomy.source + source_label + source_detail + source_ref + client_idea_id ("From idea" line) - whatever is populated.
- Generation register: agent_log as a timeline (ts + body, newest last, monospace-free, clamp long bodies w/ expand). This is the "agent details on generation" ask.
- QA card: score + verdict chip (PASS green / else amber) + feedback text collapsed w/ expand.
- Taxonomy grid: pillar, hook_type, structure_used, image_style, experiment arm, funnel_stage, topic_strength - label/value rows, only populated ones.
- Content: full post_body (pre-wrap), ig_caption if present, key_points if present, image_urls as swipeable/scroll row, pdf_url link if present.
- Actions: on Ivan review rows only, the same Approve/Skip via useConfirm. Nothing else mutates.
## 4. Register rules
House style throughout (hairlines, uppercase section labels, .5px, severity palette, skeleton on first load). No new colors. All new pure fns (stage mapping, agent_log normalization - it may be array of {ts,body} or other shapes, guard) get vitest tests w/ incident comments. agent_log/qa can be absent or malformed: render nothing rather than crash (try/catch shape guards).
