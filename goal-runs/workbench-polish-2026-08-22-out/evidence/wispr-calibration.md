# Wispr Flow, measured

Ivan named it mid-run: *"see how nice and smooth the Wispr Flow app behaves and looks. Kinda like that. It's very clear to use... It's very clear to read this perfectly."*

That is the most valuable calibration input this run has, because it is a reference **he chose**, not one I inferred. Linear and Geist tell me what a well-regarded tool does. Wispr Flow tells me what Ivan likes.

## How these numbers were obtained

Wispr Flow 1.6.606 is an Electron app (`com.electron.wispr-flow`), installed and running on this machine. Rather than eyeball it, I read its design system directly out of `/Applications/Wispr Flow.app/Contents/Resources/app.asar`, parsing the archive header and extracting `/.webpack/renderer/hub/index.js` (26.5 MB). The bundle ships its SCSS sources inline, so the token definitions are readable verbatim.

These are measured values from a shipped binary, not estimates. **Nothing from it is copied into our code**: what transfers is the numbers and the mechanisms, which is the same thing you get from reading any site's computed CSS.

Window-level screenshots were not possible: `osascript` lacks assistive access on this machine (`-25211`), and I did not capture the full screen because it would pull unrelated private content into the transcript. The bundle is the stronger evidence anyway.

---

## 1. The smoothness has a specific mechanism, and it is free

```
--spring-easing: linear(
  0, 0.005, 0.019 1.8%, 0.079 3.9%, 0.476 13.5%, 0.663 19.1%, 0.738 22%,
  0.8 25.1%, 0.852 28.4%, 0.894 32%, 0.928 36%, 0.953 40.5%, 0.972 45.6%,
  0.985 51.6%, 0.997 67.3%, 1
);
$animation-spring: var(--spring-easing);
```

That is a real spring expressed as a CSS `linear()` easing function, and `$animation-spring` is referenced in over 300 places in the hub bundle alone. **This is what "smooth" is.** A `cubic-bezier` cannot make this shape; it is a sampled spring curve, front-loaded (48% of the distance covered in the first 13.5% of the duration) then settling without overshoot.

It costs nothing: pure CSS, no library, no runtime dependency. Our app has exactly three dependencies and keeps three, and this does not change that.

Alongside it, ordinary state changes are short and unremarkable: `opacity .15s ease`, `background-color .15s ease`, `background-color 100ms ease`, `opacity 120ms ease`, `opacity 200ms ease-out`, `opacity 280ms ease-in-out`. Two other curves appear: `cubic-bezier(0.05, 0.6, 0.4, 0.95)` (26 uses) and `cubic-bezier(0.4, 0, 0.2, 1)` (22 uses, the Material standard).

**The pattern to copy:** colour and opacity changes get a plain 100-150ms ease. Anything that MOVES gets the spring. The app does not animate everything; it animates motion.

## 2. The type finding, and it answers his other question

Wispr's body scale, from the token definitions:

| Token | Size | Line-height | Ratio |
|---|---|---|---|
| body-lg | 18px | 28px | 1.56 |
| body-md | 16px | 24px | **1.50** |
| body-sm | 15px | 20px | **1.33** |
| body-xs | 12px | 20px | 1.67 |
| body-xxs | 10px | 18px | 1.80 |

Headings: 18 / 20 / 24 / 28 / 32 with line-heights 24 / 28 / 32 / 34 / 40. Weights actually used: 400 (1174), 600 (821), 550 (251), 500 (58). Note **550 and 650**, which means a variable font and deliberate half-steps.

The literal sizes that appear most in the shipped bundle: **15px (553 uses), 12px (318), 16px (133), 18px (75), 14px (74)**.

**So the working body size of an app Ivan calls "very clear to read" is 15px on a 20px line.**

Ours, after the run that just shipped, is 16px on a 1.6 line, which is **25.6px**.

His hypothesis was *"I think it's because the sizes are smaller"*. The measurement says he is half right, and the half he is missing is the more useful half: 15 versus 16 is a 6% difference in size, but 20px versus 25.6px is a **22% difference in the vertical cost of every single line**. Leading is the lever, not size. A list can be given back a fifth of its vertical space without dropping below the size he already reads comfortably in another app every day.

A separate agent is measuring the old dashboard against the new inbox on exactly this axis and does not know this yet. It is being told now.

## 3. Shadows exist here, and my Phase 1 spec was too absolute

```
$shadow-light:  rgba(26, 26, 26, 0.05)
$shadow-medium: rgba(26, 26, 26, 0.10)
$shadow-dark:   rgba(26, 26, 26, 0.25)
$shadow-card:   0 2px 8px rgba(0, 0, 0, 0.08)
$shadow-focus:  0 0 0 2px rgba(0, 0, 0, 0.04)
$shadow-drag:   0 2px 8px rgba(0, 0, 0, 0.12)
```

Plus a full Tailwind-shaped elevation ramp from `0 1px 2px` up to `0 25px 50px -12px`.

`phase1-system.md` said shadow is for overlap only and a card never gets one. Wispr is an app he likes and it puts a `0 2px 8px` at 8% under a card. **The spec is corrected**: a shadow is allowed on a resting surface, but capped at 12% alpha and never as the *primary* depth cue. The lightness step still does the work; a soft shadow may sit on top of it. What stays banned is what actually caused the complaint, which is a hard bevel doing the job a colour step should do.

Note `$shadow-drag: 0 2px 8px rgba(0,0,0,.12)`, a distinct heavier shadow used only while dragging. Our calendar has drag and gives it nothing but `opacity: .4`.

## 4. Radius: small things are 4px

Frequency in the shipped bundle: **4px (645), 24px (490), 8px (337), 6px (223), 12px (205), 16px (116), 50% (145), 9999px (58), 2px (60)**. There is a named scale behind it (`radius.rounded(md|lg|xl|full)`).

The shape of it: small controls and inline elements are 4 to 8px. Large containers go to 16 or 24. Pills are pills.

Our calendar chip is **12px on a 108x87 box**, which is what makes it read as a lozenge floating on its cell. `phase1-system.md` already moves chips to 6px; this confirms 4 to 6 is the right neighbourhood and 12 was too round for the size.

## 5. Colour: the dark theme swaps semantics, and nothing is pure

```
light:  --shade-white: #fff;     --shade-black: #000;
dark:   --shade-white: #1a1a1a;  --shade-black: #deddd7;
```

They invert the meaning of two tokens rather than maintain two palettes. Worth noting but not worth copying; our token structure is already fine.

What IS worth noting: in dark mode the "ink" is `#deddd7`, a **warm off-white**, not pure white, and the ground is `#1a1a1a`, not near-black. Ours is `#0C0C0B`. A slightly lifted ground with slightly softened ink is a large part of why a dark UI reads as comfortable rather than as a terminal.

Also present: `$text-optical-offset: 2px`, an optical correction token. Small detail, real craft.

---

## What transfers, ranked

1. **The `linear()` spring**, applied to anything that moves. Free, and it is the single thing he actually named.
2. **Tighter leading on dense surfaces.** 15-16px type on a 20-22px line for lists and rows; keep 1.5 to 1.6 for reading surfaces like the post body. This is the density answer.
3. **Soft shadow allowed at 8 to 12% alpha**, on top of the lightness step, never instead of it. Corrects my own spec.
4. **4 to 6px radius on small elements**, 14 to 16 on containers.
5. **A distinct drag shadow**, because our calendar drags and currently signals it by fading the thing you are dragging.
6. **Warm off-white ink on a lifted dark ground**, worth testing as a ballot arm rather than assumed.

## What does not transfer

Wispr is a dictation utility with a hero-serif marketing register (`$font-size-heading-serif-xl: 72px`) and a rainbow pill ring motif. None of that belongs here. The brand identity is locked: dark plate, pistachio ground, lime accent. What we take is craft, not costume.
