# Unified DM Inbox — Go-Live Checklist

Prod: https://ivanmanfre.github.io/ivan-inbox/ · Repo: `ivanmanfre/ivan-inbox` ·
Supabase project: `bjbvqvzbzczjbatgmccb` · Deploy: GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.

Final verification (Task 9) receipts live in
`~/Desktop/Ivan - Content System/goal-runs/unified-dm-inbox-2026-07-22/phase9-*`.

---

## 1. DNS / custom domain — NOT configured (v1 ships on github.io)

- Current prod is the default GitHub Pages URL `ivanmanfre.github.io/ivan-inbox/` (project pages, so it
  serves under the `/ivan-inbox/` base path — Vite `base` is set for this).
- Custom domain `inbox.ivanmanfredi.com` is **not** set up. DNS for `ivanmanfredi.com` is at **GoDaddy**.
  Whether to flip to a custom subdomain is a **ballot item** (not decided). v1 does not need it.

### Flip-to-custom-domain runbook (only when the ballot says go)
1. In GoDaddy DNS add a `CNAME` record: `inbox` -> `ivanmanfre.github.io`.
2. Commit a `CNAME` file so Pages doesn't drop it on each deploy:
   `public/CNAME` containing the single line `inbox.ivanmanfredi.com` (Vite copies `public/` to the
   build root, so it lands as `/CNAME`).
3. Point the Pages config at the domain:
   ```
   gh api repos/ivanmanfre/ivan-inbox/pages -X PUT --field cname=inbox.ivanmanfredi.com
   ```
   Then enable "Enforce HTTPS" once the cert provisions.
4. **PWA scope changes on the domain move.** Moving from `ivanmanfre.github.io/ivan-inbox/` to a bare
   subdomain root changes the origin AND the base path (`/ivan-inbox/` -> `/`). That means:
   - Update Vite `base` from `/ivan-inbox/` to `/` (and the SW `scope`/manifest `start_url`) before the flip,
     or the app 404s on the new root.
   - Any Home-Screen install and any push subscription made on the old origin **do not carry over** — the
     new origin is a fresh PWA scope. Ivan must re-install to Home Screen and re-enable push after the flip.

---

## 2. Push notifications — iPhone enablement (per device)

Web push on iOS **only** works from an installed PWA, not Safari tabs.

1. Open the prod URL in **Safari** on the iPhone.
2. Share sheet -> **Add to Home Screen**.
3. Launch the app from the Home Screen icon (standalone mode).
4. Go to **Settings -> Push notifications -> Enable**, accept the iOS permission prompt.
   - The Settings copy already tells the truth: if push isn't available it says
     "On iPhone, install to Home Screen first, then enable."

Backend chain (verified Task 8a + Task 9): inbound row insert -> `trg_inbox_push` -> `notify_inbox_push`
-> `net.http_post` -> `inbox-push` edge fn (auth via `INBOX_PUSH_SECRET`) -> looks up
`push_subscriptions where device_label='ivan-inbox'` -> web-push send. With zero subscribers the fn logs
`{message_id, subs:0, results:[]}` and returns (observed at 3.1s realtime latency in Task 9).

**Follow-up before push actually DELIVERS:** the `inbox-push` fn signs with an inbox-scoped keypair
`INBOX_VAPID_PUBLIC_KEY` / `INBOX_VAPID_PRIVATE_KEY` (+ optional `VAPID_SUBJECT`). Confirm those two
secrets are set on the project (`supabase secrets list`) — the frontend already ships the matching
`VITE_VAPID_PUBLIC_KEY`. Until a real `device_label='ivan-inbox'` subscription exists AND the
`INBOX_VAPID_*` pair is present, delivery is inert (chain fires, nothing to send to).

---

## 3. Sender pickup — receipts

Full n8n send-path probe: [`docs/send-path-verification.md`](./send-path-verification.md).

- One dispatcher: `Outreach - Send Messages` (`kFYlfnWd98YaiErH`), every 2 min. Pickup predicate is
  `approved_at NOT NULL AND sent_at IS NULL` — no message_type/channel/client filter. No n8n change made.
- Approving a pipeline draft (stamps `approved_at`, leaves `sent_at` null) is picked up ≤2 min. Verified
  live in Task 5 (`phase5-approve.png` / `phase5-stamp-verification.md`).
- `composeReply` inserts a `manual_reply` row with `approved_at` set and **explicit `sent_at: null`**
  (column default is `now()`, which would otherwise make the row unpickable — fixed in commit e1c573b).
- Copy passes the dispatcher `preSendGate` or it comes back as a red "Send failed: <reason>" chip
  (state honesty — nothing disappears silently).

---

## 4. Known v1.1 items (deferred, called out in-app where relevant)

- **Email compose / Smartlead reply-to-lead sender** — email threads show a disabled composer with
  "Email compose lands in v1.1. Approving email drafts works now." Approving pipeline-authored email
  drafts already works (Gmail lane); composing a fresh email reply needs the `recipient_email`/`Subject:`
  plumbing that isn't wired yet.
- **InMail history** — `linkedin_inmail` rows render, but there is no dedicated InMail compose/threading UX.
- **Client logins** — the app is Ivan's single authed session today. Per-client scoped logins (client_id
  gating so a client only sees their own threads) are not built.
- **Mouse-drag swipe** — the Drafts swipe-to-approve/discard is **touch only** (phone-width PWA). No
  mouse-pointer drag equivalent; on desktop use the Approve/Edit buttons.

---

## 5. Shared-table note — `push_subscriptions` is shared with the dashboard

- The inbox and the personal-site dashboard both write to the same `push_subscriptions` table.
- Inbox subscriptions are tagged `device_label='ivan-inbox'`; `inbox-push` selects **only** those rows,
  so a dashboard subscription never receives inbox payloads (and vice-versa).
- The dashboard's own `send-push-notification` function has **no VAPID secrets configured** on this
  project — a **pre-existing** condition, not introduced here. Dashboard push therefore currently cannot
  deliver. The inbox is unaffected: it uses its own `INBOX_VAPID_*` pair and its own `INBOX_PUSH_SECRET`,
  fully isolated from the dashboard's (missing) config.
