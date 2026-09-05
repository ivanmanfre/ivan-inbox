# Notes — running-thinking (batch verdicts)

Pool built from by-surface.json['running-thinking'] (259 raw) + grep over references.json
for think/reason/stream/typing/loader/spinner/stop/tool-call/progress/shimmer/abort/pulse/
skeleton/generating/running. Capped to 24 candidates, heavy on serafimcloud (21st.dev Agent
Elements port) and elements- (compound AI-agent primitives) since both are purpose-built for
exactly this state.

## Batch 1/4
- jahed/ai-agent-response — preview file is corrupt (mp4 bytes under a .png name), cannot judge, DROP.
- shugar/spinner-1 (378) — generic red spinning-dash loader on white. Reskinnable but the move itself (radial dash spinner) is not distinctive; low priority.
- ibelick/response-stream (253) — word-by-word fade-in text reveal, plain black-on-white type. Move: trailing words at lower opacity while streaming, not a hard cut to full text. Portable, fights canon (white bg) but easy to reskin dark.
- serafimcloud/thinking-tool — "Thinking ⌄ / Draft" minimal text row on black. Matches dark instrument aesthetic closely, very subtle collapse affordance. STRONG.
- serafimcloud/tool-group — "Exploring 7 files, 5 searches" collapsible header over nested Grep/Glob/Read rows, dark ground, monospace labels. This is literally the Claude Code trace look. STRONG.
- serafimcloud/send-button — square Stop glyph in a circle, dark ground, minimal. Clean stop-control candidate. STRONG.

## Batch 2/4
- serafimcloud/text-shimmer — single status word ("Rapid sync") on black, meant to shimmer while active. Static shot hides the motion but the move (a shimmering status word instead of spinner+label) is exactly the register of the current "1.8s · $0.2169" line. STRONG.
- serafimcloud/subagent-tool — one row: bold action + subtitle + elapsed seconds ("Completed Subagent · Collect previews · 6s"), dark ground, no chrome. Good elapsed-time receipt pattern, but visually thin (just text); moderate.
- serafimcloud/spiral-loader — tiny spiral squiggle icon, very low visual weight, dark ground. Static PNG undersells the two-phase Lottie motion; interesting alternative to a dot-loader but hard to judge without the video.
- serafimcloud/bash-tool — "Ran command: ls" header over a terminal-style output card (monospace, $ ls -la, file list). Strong tool-call receipt pattern but reads as a dev console; risk of fighting the plain-instrument feel with the terminal skin.
- serafimcloud/search-tool — "Found 3 results ⌄" collapsed header above a "Searched for ..." row and result rows with domain labels. Good collapse/expand receipt shape; the result rows themselves read like a search-engine widget, would need real simplification for inbox use.
- serafimcloud/todo-tool — plan checklist with circular checkboxes ("Audit components / Tighten spacing / Ship updates"), dark ground, minimal type. Good candidate for showing an agent's running plan as steps rather than a blank shimmer bar. STRONG.

## Batch 3/4
- elements-/chain-of-thought — "Chain of Thought 2/3" header, connected checked steps with a vertical line, nested result cards, live spinner on the active step. Strong structural move (numbered progress + connected steps + nested receipts) but the light card / colored-icon skin fights canon hard and reads dense/dashboard.
- elements-/tool-call — monospace tool name + colored status pill (Completed/Running/Awaiting Approval/Error) with expandable INPUT/OUTPUT JSON. Good status-pill vocabulary for a queue of tool calls; the JSON panels are too code-console for thumb use on 390px, would need heavy simplification.
- elements-/streaming-text — plain streaming text with a blinking text cursor at the tail instead of dots. Simple, cheap, very portable move. STRONG (small, low-risk).
- elements-/message-bubble — full desktop chat mockup (user/AI bubbles, timestamps). Not specific to the running state, this is thread/feed material; DROP for this surface.
- elements-/loader-signal-bars — small equalizer/waveform/heartbeat bar-cluster icon, black on white, minimal. Good idle-loader replacement for a spinner or dots, easy to recolor lime-on-dark. STRONG.
- theshanelevine/thinking — light "Thinking ⌃" card with a checked step and a bottom segmented switcher (Steps/Reasoning/Search/Coding). Interesting depth-toggle idea but too much chrome for a phone-width running indicator; risk of overbuilding a simple state.

## Batch 4/4
- larsen66/thinking-orbs — dark pill "Solving...." with a small particle-dot orb on the left, black ground. Closest to canon of anything seen: dark pill, minimal, orb reads as a living process rather than a mechanical spinner. STRONG.
- preetsuthar17/ai-thinking-block — "HextaAI is thinking · 149s" header (small ring icon + elapsed timer) over a text block whose leading edge fades/blurs into the unrevealed tail. Move: blur the frontier of streaming text instead of a hard cut. Light bg, portable idea.
- kvnkld/thinking-reasoning — "Thinking..." header over reasoning text where the last line fades to near-invisible, showing the stream's leading edge. Same fade-frontier move as above, cleaner type. Redundant with ai-thinking-block, pick one.
- asanshay/chat-reasoning — "Reasoning... ⌃" card, connected dot-and-line step list, one step checked ("Used calculator"). Simpler grayscale cousin of elements-/chain-of-thought; light bg, same structural idea already covered.
- heygaia/tool-calls-section — "Used 4 tools ⌃" header with stacked brand icons, then a connected list (icon + bold action + subtle source label) per tool call. The connecting-line provenance-list structure is portable; the colorful brand icons (Gmail red, Calendar multicolor) directly fight the lime-only-accent canon.
- rorogogogo/agent-wave-loader — a row of grayed AI-provider icons cycling under rotating captions ("AI is working... / Routing to the best model... / Taking my time..."). Move: cycle the status caption through stages instead of one static line. Portable and cheap; icons themselves are irrelevant clutter to drop.

## Pool size looked at: 24 (1 dropped for corrupt preview -> 23 actually viewed)
