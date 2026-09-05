# running-thinking — curation

Surface: the turn in flight (thinking indicators, streaming text, tool calls, reasoning blocks,
loaders, the Stop control). Canon that stays: dark ground, pistachio plate frame, lime single
accent, no warm paper, no serif.

Pool: built from by-surface.json['running-thinking'] (259 raw entries) plus a grep over
references.json for think/reason/stream/typing/loader/spinner/stop/tool-call/progress/shimmer/
abort/pulse/skeleton/generating/running. Capped at 24 per the pacing rule; one (jahed/ai-agent-response)
had a corrupt preview file and could not be judged, leaving 23 actually viewed. Two families
dominate the on-point end of the pool: serafimcloud (a direct port of 21st.dev's "Agent Elements"
kit — thinking/tool/todo/search/bash rows built for exactly this state) and elements- (compound
AI-agent primitives: chain-of-thought, tool-call, streaming-text, loader-signal-bars).

## Top 5

1. **Tool Group** · serafimcloud · usage 8 · Move: a collapsible header ("Exploring 7 files, 5 searches") that summarizes nested tool calls (Grep/Glob/Read rows) underneath, state-driven between completed/streaming/interrupted. Lands as a replacement for the current bare "read 1 memory file ›" chip: one line Ivan can glance at, expandable when he wants the receipts, collapsed the rest of the time. Risk: the nested rows read as a dev console (monospace file paths) if ported verbatim; needs re-typeset in the app's own type, and the shimmer label must not compete with the lime accent.
   Preview: `01-refs/previews/serafimcloud__tool-group.png` · Video: https://cdn.21st.dev/21st.dev/tool-group/streaming/video.1777646307311.mp4

2. **Thinking Tool** · serafimcloud · usage n/a · Move: a minimal collapsible row — a "Thinking ⌄" label that expands to a draft/answer beneath it, nothing else on screen. Lands as the direct upgrade to the current "Claude ● 1.8s · $0.2169" line: same restraint, but the label itself becomes the affordance (tap to see the reasoning) instead of a static status string. Risk: too minimal to read as "new" on its own; needs the shimmer motion (present in the source, not the static preview) to earn its place, otherwise it is just smaller text.
   Preview: `01-refs/previews/serafimcloud__thinking-tool.png` · Video: none listed

3. **AI Streaming Text** · elements- · usage n/a · Move: a blinking text cursor sits at the tail of the response as it streams in, instead of a hard cut from nothing to full text. Lands on the streamed answer body itself (the "ready" / counting text in the after-shot) — the cursor is the only new element, cheap to add, and reads instantly as "still writing" without a separate loader. Risk: none structural; the only failure mode is a cursor blink rate that feels laggy on a phone repaint, tune it fast (~500ms) and it disappears as a problem.
   Preview: `01-refs/previews/elements-__streaming-text.png` · Video: none listed

4. **Thinking Orbs** · larsen66 · usage n/a · Move: a dark pill ("Solving....") built around a small particle-dot orb, six hand-tuned canvas states (working/searching/solving/listening/composing/shaping) standing in for a spinner. Lands as the visual anchor of the whole running state: the orb replaces the plain asterisk glyph next to "Claude" in the after-shot, giving the turn-in-flight a living, breathing marker instead of a static icon. Risk: a canvas-driven orb is the highest-motion-cost item in this set of picks; must confirm it does not tax battery/CPU on a phone held ten times a day, and the dot color must be lime-only, not the source's white-on-black.
   Preview: `01-refs/previews/larsen66__thinking-orbs.png` · Video: none listed

5. **Send Button** · serafimcloud · usage 9 · Move: one round button that swaps state (send / typing / streaming-stop) rather than three different controls; the streaming state renders as a plain filled square inside the circle. Lands directly on the Stop control called out in the brief: today's inbox already has a "■" glyph in the composer, this pattern gives it a clean idle→typing→stop state machine to sit inside instead of being a separate static icon. Risk: very low, it is already close to canon (dark ground, single glyph); the only thing to watch is keeping the circle's fill a neutral gray, not lime, so Stop does not read as an accent action.
   Preview: `01-refs/previews/serafimcloud__send-button.png` · Video: https://cdn.21st.dev/21st.dev/send-button/streaming/video.1777385580737.mp4

## Runners-up

- **Signal Bars Loader** · elements- · usage n/a — an equalizer/waveform/heartbeat bar-cluster loader; a good alternate motion-language to the orb but redundant once the orb is chosen. Preview: `01-refs/previews/elements-__loader-signal-bars.png`
- **Text Shimmer** · serafimcloud · usage 10 — a single status word that shimmers while active; strong but overlaps with Thinking Tool's own shimmer state. Preview: `01-refs/previews/serafimcloud__text-shimmer.png`
- **Todo Tool** · serafimcloud · usage n/a — a running plan rendered as a checklist with circular status icons; valuable for longer autonomous runs but heavier than a single turn needs. Preview: `01-refs/previews/serafimcloud__todo-tool.png`
- **AI Chain of Thought** · elements- · usage n/a — numbered progress header + connected step list with nested result cards and a live spinner on the active step; the richest structural idea in the pool but its light, colorful card skin fights the dark canon hardest of anything reviewed. Preview: `01-refs/previews/elements-__chain-of-thought.png`
- **Agent Wave Loader** · rorogogogo · usage n/a — cycles the status caption through stages ("AI is working... / Routing to the best model... / Taking my time...") under a row of provider icons; the caption-cycling move is cheap and portable, the icons themselves are clutter to drop. Preview: `01-refs/previews/rorogogogo__agent-wave-loader.png`

Pool size looked at: 24 candidates (1 unviewable due to a corrupt preview file).
