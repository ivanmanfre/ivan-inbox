# notes — composer-attachments-voice

Pool: 198 tagged by-surface.json + 1 grep extra (chapter-scrubber, transcript-relevant) = 199 candidates surveyed by name/description/usage. Capped viewing pool at 24, spanning: composer/input container, voice input/recording, waveform/audio, attachment chips/dropzone.

## Batch 1 — composer/input core
- jahed/ai-prompt-box (1868): rounded pill composer, icon row (paperclip/globe/settings/folder) below the textarea separated by dividers, mic pinned in a white circle bottom-right. Warm gradient bg fights canon; icon-row idea is portable.
- jahed/chatgpt-prompt-input (1397): plus + "Tools" pill inline below text, mic and up-arrow send stacked on the right. Clean but generic; white bg, low signal beyond icon placement.
- sensewood8/claude-style-chat-input (346): this IS Claude.ai's own composer — warm paper bg + serif headline (both banned), but structure (plus/history icons left, model picker + send right, quick-action pills below) is a strong reference for layout despite the skin.
- suraj-xd/claude-style-ai-input (no usage): attachment CHIPS row below the composer, each chip carries a type badge (PASTED/PDF/HTML) at bottom-left and a thumbnail for images. Exactly on point for image/PDF chips. Dark bg already close to canon. STRONG PICK.
- Alwurts/chat-input (442): minimal dark bar, text + circular send arrow only. Too plain to carry a move alone.
- aghasisahakyan1/multimodal-ai-chat-input (143): suggestion cards above a composer with paperclip + circular send arrow. Unremarkable, low signal.

## Batch 2 — voice input/recording
- kokonutd/ai-voice-input (763): mic glyph + monospace 00:00 timer + a dotted horizontal level-meter track + "Click to speak" label, all text/glyph driven, no waveform yet. Clean state-affordance for idle-to-recording.
- isaiahbjork/voice-powered-orb (263): glowing gradient ring (Siri-style orb) with a pill button below reading "Start Recording"; ring presumably brightens while listening. Neon blue/purple glow fights canon but the ring-brightens-while-listening idea recolors to lime cleanly.
- molecule-lab-rushil/voice-input (139): a bare circular mic button, nothing else. No signal alone.
- uicapsule/voice-dictator (no usage): concentric halftone dot rings pulsing outward from a center dot on black — a literal voice-ripple visualization. Striking motion idea but full-screen hero scale, not composer-sized.
- erikvalencia1/voice-recording (no usage): single flat blue circle with a white dot, minimal pulse. Too plain, low signal.
- ruixen.ui/voice-message-bubble (no usage): waveform + play button + duration label inside a message bubble (light/dark variants). Directly on point for a sent voice note. STRONG PICK.

## Batch 3 — waveform/audio
- thegridcn/waveform (no usage): HUD-style bordered panel labeled "AUDIO SIGNAL / LIVE" with corner brackets and a teal glowing bar waveform. Sci-fi brackets/glow fight canon but the labeled-live bar readout is a clean reference shape.
- ruixen.ui/waveform-player (no usage): plain black vector bar waveform + a "Play" pill below, white bg. Minimal, easy to recolor dark/lime, but low distinctiveness on its own.
- dhileepkumargm/sonic-waveform (no usage): a marketing hero section (headline + CTA button over a wavy gradient banner). REJECT — hero block per brief.
- ElevenLabs-crawled/live-waveform (73 usages per catalog card): preview asset is broken (shows only the 21st.dev catalog placeholder, not the live component). Not usable as a visual reference.
- ElevenLabs-crawled/audio-player (no usage): dark track list (roman-numeral titled tracks II-00..03), active row shows play button + elapsed/total time + a small settings glyph. Good bones for a "past voice notes" list, already dark.
- isaiahbjork/audio-upload-card (no usage, preview file is actually an mp4 mislabeled .png, extracted a frame): "Upload Your Audio" dashed dropzone with an upload glyph that crossfades into a filename + waveform row once a file lands. Dark ground close to canon already. STRONG PICK — one component covers both the empty dropzone and the attached-voice-note state.

## Batch 4 — attachment chips / dropzone
- serafimcloud/file-attachment (no usage): two file/image chips side by side, icon-by-extension for docs, thumbnail for images, name + size beneath, dark ground. Description confirms a hover-revealed remove button. Bullseye match for "image and PDF chips." STRONG PICK.
- serafimcloud/attachment-button (no usage): preview asset is near-blank (a single crosshair dot on dark), not enough visual information to judge. Reject on preview quality.
- kokonutd/ai-input-with-file (no usage, preview matches "File Upload and Chat!" placeholder text): light-mode pill composer with a paperclip icon-chip on the left and a send arrow on the right. Generic, doesn't show the attached-file state, low signal beyond icon placement already covered elsewhere.
- uilayout.contact/imgpreview-dropzone (no usage): light blue-accent dropzone with a circular image glyph, "Drop your files here" + filetype/size copy + a "Select files" button. Standard, un-styled to canon, no attached-state shown.
- uilayout.contact/chat-form-dropzone (no usage): a paperclip chip fused to the left edge of a rounded input, "Your message here..." placeholder. Simple paperclip-in-chip idea, modest signal.
- joyco/file-dropzone (no usage): "Drop your files here" light dropzone with an image glyph, dashed border, upload icon button below. Standard-issue dropzone, no distinguishing move.

Final picks selected from all 4 batches (24 viewed of a 199-strong pool): serafimcloud/file-attachment, suraj-xd/claude-style-ai-input, ruixen.ui/voice-message-bubble, kokonutd/ai-voice-input, uicapsule/voice-dictator.
