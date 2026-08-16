# Phase 4 — verification by instrument

Run by the orchestrator, not by the builder. Every row below is a command I executed and read, or it is not claimed. Where an instrument disagreed with a summary, the instrument wins. Where an instrument was wrong, that is recorded too.

## The deploy fence

| check | command | result |
|---|---|---|
| `main` unchanged | `git log main --oneline -1` | **`7c9ea96`**, the pre-run commit |
| nothing pushed | `git log origin/main..main` | **0 commits** |
| no branch on the remote | `git branch -r \| grep -c 'exp/v2\|tourney/v2'` | **0** |
| winner branch | `git rev-list main..exp/v2 --count` | **20 commits**, unmerged |

The live site at `ivanmanfre.github.io/ivan-inbox` is byte-for-byte what it was before this run started. Nothing armed, nothing deployed, `RAILWAY_CLAUDE_API_KEY` deliberately unset.

## The winner is NOT purely additive — stated plainly

The DoD asked for default routes pixel-identical to the pre-run baseline. **On the live site that holds; on the `exp/v2` branch it does not, and it cannot.** `git diff --name-only main...exp/v2 -- src/` shows **16 shared production files** changed outside `src/exp/`: `hooks/{useInbox,useOps,useContent}.ts`, `lib/{inbox,today}.ts`, `screens/{Today,Inbox,Drafts,Ops,Sends,Thread}Screen.tsx`, `screens/kpi/OverviewView.tsx`, `styles.css`.

That is a direct consequence of what the panel required. The `approveDraft` guard (U1), the missing fetch-failed states (U2/U3), the compose confirmation (U4), the doubled headers and the clipped `% of cap` pill all live in shared production code, and the mission's own defect table authorised fixing them. A change that fixes a send-safety landmine cannot also be invisible.

Measured delta, `scripts/diffshots.mjs baseline /tmp/v2-defaults` after building and serving `exp/v2` on port 4191:

| route | verdict | words before → after | why |
|---|---|---|---|
| settings ×2 | **IDENTICAL** | 67/70 → 67/70 | untouched |
| drafts ×2 | pixels differ, geometry same | 22/25 → 22/25 | freshness strip |
| today ×2 | geometry moved | 769 → **413** | G1 removed the inline `Approve & send` that acted on the cached brief, replaced by `HandOff` |
| sends ×2 | geometry moved | 265 → 256 | clipped `% of cap` pill fixed |
| ops ×2 | geometry moved | 19 → 15 | doubled header removed, honest empty copy |
| inbox ×2 | geometry moved | 49,558 → 49,560 | +2 words, a label |

My own instrument prints `REGRESSION` for a geometry move and exits 1. That word is wrong here and I am not going to let the label stand in for a judgement: every move above is an intended graft or fix, verified individually below. The instrument's job is to notice movement, not to interpret it.

## Independent probe of the default routes on the winner build

`scripts/_probe.mjs` (temporary, removed after use) against `localhost:4191`, real authed session:

- **today** → one `h2`, 162 zone elements, **zero approve buttons** (G1 landed), masthead reads `16 THINGS ON YOUR PLATE / 4 urgent / 12 to approve / 0 …` and **4 + 12 + 0 = 16**, so G4's arithmetic holds on live data.
- **ops** → **one** `h2` (MF1's doubled header is gone on the default route too, not only inside the gated surface), and the honest-copy graft is present.
- **sends** → one `h2`, 21 zones, new decision framing.

## A defect my own probe found, which the build missed

The ops probe returned the literal string **"Checked now ago"**. Cause: three production screens built the label as `` `${ago(t)} ago` ``, and `ago()` returns a bare `'now'` under a minute (`src/lib/today.ts:519`), so the freshest and by far most common read rendered as "Checked now ago". The v2c-internal surfaces used a different helper and were unaffected, which is exactly why a summary would not surface it.

Fixed in commit `64e3b72`: `checkedPhrase()` owns the whole phrase rather than appending to a duration, all three call sites use it, and the em dash in that copy went away with it. Four regression tests, including a loop asserting no timestamp in the last hour can ever render `now ago`. Suite went 288 → **292 passing**, build clean, lint 0 errors.

## Secret grep — and a false positive of my own making

| check | result |
|---|---|
| `sk-ant-api03` in `dist/` | **0** |
| `sbp_` management PAT in `dist/` | **0** |
| service-role JWT in `dist/` | **0** |
| secrets in `git log -p main..exp/v2` | **0 matches** |

My first pass reported a hit, because my pattern matched *any* HS256 JWT. Decoding every JWT in the bundle returns exactly one token: `role=anon`, `ref=bjbvqvzbzczjbatgmccb`. That is the anon key, it is what `.github/workflows/deploy.yml:14` injects, and shipping it in a static SPA is correct and unavoidable. **No leak.** The lesson is the same one that produced the retracted P0 earlier in this run: a pattern match is not a finding until it is identified.

## Broker, probed in production after the wiring

| probe | status | body |
|---|---|---|
| no auth header | **401** | `UNAUTHORIZED_NO_AUTH_HEADER` |
| anon key as bearer | **401** | `{"error":"invalid_token"}` |
| Ivan's real JWT, real prompt | **502** | `{"error":"upstream_error","detail":"status 401 Invalid or missing API key"}` |
| Ivan's real JWT, 12,100-char prompt | **413** | `{"error":"prompt_too_long"}` |

The anon row is the important one: the anon key **is** a valid JWT, so Supabase's platform gate accepts it and the in-code `getUser()` check is the thing that rejects it. That was the specific failure mode the security skeptic warned about, and it is closed.

The 502 row is the unarmed state working as designed. It maps to `upstream_not_armed` and the UI renders "Claude is not armed yet: the container key is not set on the broker." with no retry button, because retrying cannot help.

## Gate table on the gated surface

From the builder's run and spot-confirmed here: 44 shots, **zero** horizontal overflow at 390px, **zero** hard-clipped text, **zero** app console errors, **zero** failed captures, encoding gate passes on every content-bearing surface, stat numbers at 34/32/30/28px (inside the app's real 26-38px scale, none in a 20-25px dead zone), `package.json` **byte-identical** to `main` so no dependency was added, **0** monospaced elements measured, severity still 3-tier. Prose share exceeds 80% on 19 regions and every one is either the inbox list or a draft body, the two classes `CALIBRATION.md` pre-classified as true-positive exemptions.

## What is NOT verified, and cannot be by this run

1. **A completed Claude turn.** Requires `RAILWAY_CLAUDE_API_KEY`, whose value is not obtainable non-interactively. Everything up to the container's own auth check is proven; the leg past it is not.
2. **Real dictation.** Headless Chromium exposes `webkitSpeechRecognition` but cannot capture a microphone. Feature-detection was proven behaviourally (constructors deleted → 0 mic affordances, 0 errors), but one human speaking into real Safari or Chrome is the only way to confirm the audio leg.
3. **iOS PWA behaviour** — service worker plus microphone permission on Ivan's actual phone.
4. **Whether the revamp is actually better to live in.** A week of real use answers that; no instrument does.
