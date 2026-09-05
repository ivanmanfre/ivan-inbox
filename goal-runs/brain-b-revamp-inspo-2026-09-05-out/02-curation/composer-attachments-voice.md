# composer-attachments-voice — 21st.dev curation

Surface: the message composer — AI chat inputs, attachment trays, image and PDF chips, voice recording, waveforms, transcripts.

Pool built: 199 candidates (198 from by-surface.json's `composer-attachments-voice` tag plus one grep extra, `chapter-scrubber`, whose description names "transcript"). Previews opened and judged: 24, in four batches of 6 covering composer/input core, voice input/recording, waveform/audio, and attachment chips/dropzone. Full batch notes in `notes-composer-attachments-voice.md`.

---

## Picks

### 1. File Attachment · serafimcloud · usage 0
- **Move:** a compact chip per attached file — icon-by-extension for documents, a real thumbnail for images, name and size beneath, and a remove button that only appears on hover (idle state stays clean).
- **Lands in the inbox:** replaces whatever currently marks an image/PDF pulled into a draft. Two or three chips sit in a row above the send bar; Ivan sees at a glance what is attached without a delete "x" cluttering every chip at rest.
- **Risk:** hover has no equivalent on a phone. The remove affordance needs to become tap-to-reveal (long-press or a persistent small glyph) or the delete action disappears entirely on 390px.
- **Preview:** `../01-refs/previews/serafimcloud__file-attachment.png`
- **Video:** none

### 2. Claude Style AI Input · suraj-xd · usage 0
- **Move:** the composer itself adapts its attachment preview to content type — a pasted-text chip gets a monospace snippet, a PDF gets a page-count badge, an image gets a real thumbnail, each with a small type badge in the corner (PASTED / PDF / HTML).
- **Lands in the inbox:** when Davorin's brief or a scraped page lands in a draft, the chip tells Ivan what kind of thing it is before he opens it, not just a generic file icon. Complements pick 1's minimal chip with a richer, type-aware variant for anything text-based.
- **Risk:** four chip types is a lot of surface for a narrow composer; at 390px more than two chips wide needs to wrap or scroll, not shrink to illegibility.
- **Preview:** `../01-refs/previews/suraj-xd__claude-style-ai-input.png`
- **Video:** none

### 3. Voice Message Bubble · ruixen.ui · usage 0
- **Move:** a play/pause button, a minimalist black-and-white bar waveform, and a duration label in one compact bubble, with a real-time progress overlay that lets Ivan click into the waveform to seek.
- **Lands in the inbox:** this is the shape a recorded voice note should take once sent, not a generic audio-file row. The waveform recolors cleanly to lime-on-dark and the seek interaction is exactly what a voice-note review pass needs.
- **Risk:** shadcn theme-aware bones make the recolor easy, but a static bar waveform reads as decoration unless the progress overlay genuinely tracks playback — a fake waveform that never moves under the finger is worse than none.
- **Preview:** `../01-refs/previews/ruixen.ui__voice-message-bubble.png`
- **Video:** none

### 4. AI Voice Input · kokonutd · usage 763
- **Move:** the idle-to-recording transition is carried entirely by state, not a modal — a mic glyph, a monospace timer, and a level-meter track that only animates while live, with a demo/preview mode for testing the transition.
- **Lands in the inbox:** the composer's mic button, tapped, becomes this in place, so Ivan never leaves the thread to record. The timer and meter tell him it is actually capturing without needing to glance for a separate indicator.
- **Risk:** high usage number suggests wide adoption of the pattern, but the specific visualizer bars in the reference are a generic equalizer; they need real amplitude data or a fixed lime pulse, not a canned animation that looks alive when the mic is silent.
- **Preview:** `../01-refs/previews/kokonutd__ai-voice-input.png`
- **Video:** https://cdn.21st.dev/user_2rQ1QHrJyxpmWMHhqhANzWMc64n/ai-voice-input/default/video.1788464920005.mp4

### 5. Voice Dictator · uicapsule · usage 0
- **Move:** a pulsing waveform orb runs while a live transcript streams in below it, so listening and reading are the same event on screen rather than a spinner followed by a wall of text.
- **Lands in the inbox:** when Ivan dictates a reply instead of typing, the words should appear as he speaks, under a small glyph that visibly reacts to his voice, so he can catch a mis-hearing before he hits send instead of after.
- **Risk:** the static preview only shows the orb (concentric dithered rings), not the transcript text itself — the transcript-while-pulsing claim comes from the component's description, not something verified in the still. Confirm the transcript actually renders before committing to the pattern; if it does not, this is only an orb, which pick 4 already covers.
- **Preview:** `../01-refs/previews/uicapsule__voice-dictator.png`
- **Video:** none

---

## Runners-up

- **AI prompt Box · jahed · 1868** — icon row (paperclip / globe / settings / folder) below the textarea, separated by thin dividers, mic pinned in a white circle. `../01-refs/previews/jahed__ai-prompt-box.png`
- **Waveform · thegridcn · 0** — a HUD-bordered "AUDIO SIGNAL / LIVE" panel with a glowing bar waveform; sci-fi brackets fight canon but the labeled-live readout is a clean shape. `../01-refs/previews/thegridcn__waveform.png`
- **Audio Player · ElevenLabs-crawled · 0** — a dark track list where the active row shows a play button, elapsed/total time, and a settings glyph; good bones for a "past voice notes" panel. `../01-refs/previews/ElevenLabs-crawled__audio-player.png`
- **Voice Powered Orb · isaiahbjork · 263** — a shader-based orb whose rotation and glow intensity modulate live with microphone input. `../01-refs/previews/isaiahbjork__voice-powered-orb.png`
- **Audio Upload Card · isaiahbjork · 0** — a dashed dropzone whose upload glyph crossfades into a filename-plus-waveform row once a file lands (preview file is an mp4 mislabeled .png; frame extracted to confirm). `../01-refs/previews/isaiahbjork__audio-upload-card.png`
