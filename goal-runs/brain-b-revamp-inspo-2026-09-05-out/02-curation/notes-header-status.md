# Notes — header-status (batch verdicts)

Pool built from by-surface.json['header-status'] (596, noisy) plus targeted grep over references.json for: dynamic island, status dot/pill/capsule/badge, header (sticky/scroll-hide/collapsing), notification center/badge/count, alert banner, system status. Final capped pool: 24.

## Batch 1 (1-6)
1. educalvolpz/dynamic-island — KEEP. Real Apple-style black capsule, morphs between compact icon state and a row of quick-action pills below. Exact idiom for a status capsule.
2. cult-ui/dynamic-island — REJECT. Despite the name it previews as a plain login modal card, no capsule/island behavior visible.
3. aghasisahakyan1/dynamic-island — KEEP. Genuine island with an expanded music-player state (art, title, transport controls) plus the same action-pill tray. Shows the expand/collapse motion better than #1.
4. digitalzone0707/dynamic-island-toc — REJECT. It is a light desktop table-of-contents overlay on an article page, not a status surface, wrong idiom and fights dark canon.
5. ddoemonn/sticky-header — KEEP (idea, not skin). Light theme but the move is exact: big title "Inbox" with a live count subtitle ("8 messages") that condenses on scroll — maps directly to place-title + unread-count.
6. motiondotdev/motion-scroll-hide-header — UNCLEAR. Preview render is nearly all-black/empty (broken capture), can't verify the hide-on-scroll claim visually; hold as low-confidence, do not shortlist without a working state.

## Batch 2 (7-12)
7. serafimcloud/telegram-profile-header — REJECT. It is a full-bleed profile photo card with an Edit pill, a Telegram-profile idiom not a header/status bar; nothing to port for a place-title/status strip.
8. 7ovr/page-header-2 — REJECT. Breadcrumbs + title + "Active" badge + Export/Save buttons is a desktop app-shell page header; the badge-beside-title idea is already covered better elsewhere.
9. kumail_ali_r/core-header-navbar — MAYBE. Name + "ACTIVE NOW" presence text beside an avatar on the right of a nav bar is a usable presence-status idiom, but the rest (tab row, wordmark) is desktop dashboard chrome.
10. uiable/uiable-breadcrumb-page-header — REJECT. Generic breadcrumb-plus-title card, no status content, no motion, nothing new.
11. edwinvakayil/status-dot — KEEP. Clean state-token legend (Building/Ready/Error/Queued/Live) each a colored dot with a soft pulse ring on the active states — exact transferable idiom for seat-health / automation-alert states.
12. isaiahbjork/hud-status-1 — RISKY KEEP. Angled-cut capsule shape with glowing edge is a distinctive silhouette worth noting, but the neon-HUD green glow and gamer typography fight the canon hard; only the cut-corner capsule shape is portable, not the skin.

## Batch 3 (13-18)
13. isaiahbjork/card-status-list — MAYBE. Dark checklist card is close to canon already; the standout bit is the "SYNCING" row with a glowing gradient trailing edge and spinner, a good syncing-state affordance, but this is a status LIST not a header/status-bar surface.
14. ruixen.ui/avatar-notifications — REJECT. Preview renders as a generic light-theme bell-icon notifications popover; the described blinking status dot is not visible/verifiable in the static shot.
15. hero_ui/heroui-badge — KEEP (reference). Grid of avatar orbs with small numbered badges in three weights (Primary/Secondary/Soft) is a clean reference for count-badge sizing/placement/tone, useful for the unread-count token even though the demo itself is a swatch sheet not a real header.
16. preetsuthar17/system-status-block — MAYBE. Light desktop status panel (API/Database/Auth/Email rows, each an icon + label + a thin colored uptime-tick strip + incident history). The row-with-history-ticks idea could compress into a seat-health strip, but as shown it is a full settings-page block, light theme, needs a full reskin and radical compression.
17. ddoemonn/new-items-pill — KEEP. A floating "↑ 3 new items" capsule overlapping the feed that jumps to newest on tap — this is the unread-count / automation-alert pill idiom almost exactly, light skin aside.
18. ruixen.ui/alert-badge — REJECT. Preview only shows an idle bell button plus "Decrement"/"Clear" test-harness buttons; the live counter/alert states described are not visible to judge.

## Batch 4 (19-24)
19. lavikatiyar/alert-banner — KEEP. Dark-native dismissible toast: green-ring check icon, bold title, muted subtitle, inline Dismiss/View actions on a near-black card with a hairline border. Already close to canon ground, strong automation-alert banner reference.
20. amanshakya1808/notification-center — REJECT. Renders as a tiny light-theme marketing screenshot of an OS notification-center widget with app icons; promo image, not a usable header/status component.
21. ruixen.ui/notifications-1 — KEEP (minimal reference). Just a bell glyph with a small solid dark circular count badge — the simplest possible unread-count treatment, useful as the floor case.
22. karthikmudunuri/animated-badge — KEEP (top pick territory). Dark-ground capsule pill: accent dot, divider, label text, chevron, with a soft glow arc animating in above it — reads as a status/announcement capsule sitting on a near-black field, very close to the dynamic-island-style status capsule brief already wants.
23. arihantcodes_1f7b8c4d/status-badge — MAYBE (reference only). Seven semantic status pills (Pending/Failed/Success/In progress/In review/Expired/Submitted), each icon+label on a tinted soft background. Clean icon+label formula worth stealing for automation-alert/seat-health states, but the multi-hue pastel palette directly fights the single-lime-accent canon.
24. ruixen.ui/capsule-tabs — REJECT for this surface. It is a segmented tab bar with a dot page-indicator, belongs to tab-bar-navigation, not header-status.

## Pool size looked at: 24 (of a candidate set built from 596 by-surface entries + targeted keyword grep over 2,117 references)
