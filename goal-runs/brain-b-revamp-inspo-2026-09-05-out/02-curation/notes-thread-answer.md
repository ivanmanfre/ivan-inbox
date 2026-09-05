# notes — thread-answer (working verdicts)

Pool: 24 candidates (by-surface.json thread-answer bucket used as sanity check only, too noisy;
built own pool via grep on references.json for chat/message/bubble/ai/streaming/reasoning/markdown/
citation/tool-call/thinking, cross-checked against composer-attachments-voice to exclude input-only
components). Batches of 6, verdict logged before next batch opens.

## Batch 1
1. serafimcloud/agent-chat (55) — the whole shell already matches Ivan's plain-answer layout almost
   exactly (bubble top-right, plain text answer, composer bottom). Confirms the shape, no new move.
   PASS on shape, not a pick on its own.
2. serafimcloud/user-message (0) — white pill user bubble, no move beyond what Ivan already has (lime
   bubble). Reject, nothing to port.
3. serafimcloud/error-message (0) — compact red-tinted card, "Something went wrong" + detail line.
   Belongs to turn-error surface, not thread-answer. Note only, not a pick here.
4. serafimcloud/markdown (8) — KEEP. Real heading/list/code-fence hierarchy inside the answer body,
   plus a small "Streaming..." state label and a "Replay" affordance. Current answer body is flat
   undifferentiated prose; this is the fix.
5. serafimcloud/tool-group (8) — KEEP, strong. Collapsible "Exploring 7 files, 5 searches" header
   that expands into a per-action list (Grep/Glob/Read rows, each with its own icon + mono argument).
   Direct upgrade path for the flat "read 1 memory file ›" pill.
6. serafimcloud/thinking-tool (0) — quiet "Thinking ⌄" collapsible label above a draft. Thin on its
   own (near-empty preview) but the collapsible-reasoning idea overlaps with tool-group; not distinct
   enough to need both. Reject as a separate pick, absorb into tool-group's move if anything.

## Batch 2
7. serafimcloud/mcp-tool (0) — same collapsible-tool-card family as tool-group, this instance shows
   a raw JSON blob under "Listed Resources · query: resources". Redundant with tool-group's move,
   not a separate pick.
8. serafimcloud/plan-tool (0) — file-header card + prose plan + blue Approve button. Blue accent
   fights the lime-only canon; not for the answer surface (no approve-a-plan moment in Ask). Reject.
9. serafimcloud/text-shimmer (10) — static PNG shows only quiet grey text ("Rapid sync"), the shimmer
   is motion-only and invisible here. Belongs to running-thinking surface, not distinct enough on its
   own for thread-answer. Reject here.
10. serafimcloud/edit-tool (0) — red/green diff card. Fights canon (no code-diff moment in the Ask
    surface, colours are wrong). Reject.
11. serafimcloud/subagent-tool (0) — single dense status line "Completed Subagent · Collect previews
    · 6s" (task name + elapsed time on one line). Thin, overlaps tool-group. Note only.
12. serafimcloud/question-tool (0) — lettered multiple-choice question card with blue Next button.
    Blue fights canon, and Ask doesn't ask Ivan multiple-choice questions today. Reject.

## Batch 3
13. educalvolpz/ai-response (8) — KEEP, strong. Numbered inline citation markers (superscript pill
    "1", "2") sit inline right after the exact claim, inside a rounded card. Different move than
    tool-group: inline footnote-at-point-of-claim vs a bottom collapsible summary. Real candidate.
14. ibelick/response-stream (253) — KEEP. Word-by-word fade-in reveal for streaming text (later words
    dimmer/half-opacity, earlier words settled), not a blunt append or classic typewriter caret. White
    ground in the demo, move ports independent of colour.
15. vercel-crawled/message (74) — generic two-bubble chat with avatar. No new move over what Ivan
    already has. Reject.
16. rafa-porto/ai-assistant-interface (235) — empty-state/composer landing block (orb, suggestion
    chips, model picker), not an answer-surface reference; blue gradient fights canon. Reject.
17. ahmedmayara/ai-assistant-card (146) — same, empty-state welcome + suggestion chips, white ground.
    Reject.
18. beratberkayg/ai-chat (128) — generic robot-emoji widget shell, near-empty body. Nothing to port.
    Reject.

## Batch 4
19. coderislive07/ai-assistat (81) — purple/indigo empty-state widget, near-empty body. Fights canon,
    not an answer-surface reference. Reject.
20. botsnew354/ia-siri-chat (86) — full-screen voice orb ("Speaking...", 00:00 timer). Belongs to
    voice-note/composer surface, light theme, green not lime. Reject here.
21. jakobhoeg/message-loading (528) — plain three-dot typing indicator. Belongs to running-thinking
    surface. Reject here (usage is high but the idiom is already covered elsewhere).
22. isaiahbjork/animated-project-cards (84) — light job-board list with coloured icon tiles and pill
    tags. Feed-cards territory, not thread-answer, and a marketing/dashboard idiom. Reject.
23. jatin-yadav05/interactive-accordion (103) — marketing "What we do" landing section. Explicitly
    out per brief (reject landing sections). Reject.
24. serafimcloud/filter-badge (99) — people-filter chip with avatar + remove X. Not the shape of a
    grounded/recall chip (no avatars in Ask). Reject.

## Pool exhausted: 24/24 previews viewed.

## Final picks (ranked, revised after full pool review)
1. serafimcloud/tool-group — collapsible "Exploring N files, M searches" header expanding to a
   per-action mono list. Upgrades the flat "read 1 memory file \u203a" pill into something worth tapping.
2. educalvolpz/ai-response — inline numbered citation markers at point-of-claim inside the answer
   prose. A second, complementary way to ground claims besides the bottom-summary chip.
3. serafimcloud/markdown — real heading/list/code-fence hierarchy plus a quiet "Streaming..." state
   label. Fixes the flat undifferentiated answer paragraph.
4. ibelick/response-stream — word-by-word fade-in reveal for the answer as it streams in, instead of
   an instant block-append. Direct answer to "smooth motion."
5. serafimcloud/text-shimmer — a single shimmering status line for the moment before/while an answer
   or grounding lookup resolves, going flat and static the instant it lands. Swapped in over
   subagent-tool: purpose-built motion component with a video demo, and pairs directly with picks 1
   and 3 (the same family, the "in-flight" state before the collapsible / streaming states settle).

Runners-up: serafimcloud/agent-chat (shell reference, confirms current layout, no standalone move),
serafimcloud/thinking-tool (collapsible reasoning label, overlaps pick 1), serafimcloud/subagent-tool
(single dense status line, thin), serafimcloud/mcp-tool (same collapsible-card family as pick 1, raw
JSON body), serafimcloud/error-message (compact red-tinted card, belongs to turn-error surface).
