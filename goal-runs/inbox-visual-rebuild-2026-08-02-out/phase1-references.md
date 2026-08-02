# Phase 1 — Reference Acquisition (Visual Rebuild)

Goal-run: inbox-visual-rebuild-2026-08-02. All captures below are live retrievals (browser or direct CDN fetch), verified by reading the saved PNG back before writing any description. No reference is scored from memory.

Captures live in `refs/`. All file paths absolute:
`/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-visual-rebuild-2026-08-02-out/refs/`

---

## 1. PRIMARY — Nixtio "Dashboard UI / CHECK BOX" (Dribbble)

- **URL:** https://dribbble.com/shots/25683483-Dashboard-UI
- **Retrieval evidence:** Opened via playwright-driver (Mode 1 inspect, headless Chromium) at 2026-08-01T22:00:05Z. Page rendered the real shot (not a login wall/skeleton) — confirmed visually. Direct CDN image URL extracted from the page's `<img>` srcset: `https://cdn.dribbble.com/userupload/36734261/file/original-822ee72523e5fd7b7d2d1e968054b218.png`. Fetched directly via curl at 2026-08-01T22:00:xx local (macOS). Saved to `refs/nixtio-checkbox.png` — **433,390 bytes, 3200×2400 PNG**. Verified by Read (not a placeholder — full dashboard visible, real pixel content).
- **What's actually in the capture:** A dark dashboard mockup (product "Check Box" by Nixtio/Bogdan Nikitin) on a green backdrop. Top bar: logo mark, three pill-shaped nav buttons ("Check Box", "Monitoring", "Support") + a circular search icon, user name/handle + avatar with a red notification badge on the right. Below: oversized uppercase title "CHECK BOX" flush left, and three filter pills on the right ("Date: Now ⌄", "Product: All ⌄", "Profile: Bogdan ⌄") plus a circular icon button. Left edge: a vertical rail of circular icon buttons (heart, calendar, diamond, gear, plus-add). Main grid: a CUSTOMER card (two metrics — 2,4%▲ Web Surfing / 1,1%▼ Radio Station — over a green/orange line sparkline), a PRODUCT card (two metrics over a dot-matrix/heatmap grid), a large PRODUCT capsule-chart card (paired vertical pill shapes per category with the value numeral printed inside each pill, legend "Resources/Valid/Invalid" + "Total: 1,012" footer), and a PROJECTS TIMELINE card (horizontal gantt-style bars colored by category, each bar starting with a small circular brand icon or avatar cluster and ending with a numeral, dashed day-gridlines, legend "Customer/Product/Web" + "Total: 284" footer).
- **Transferable MOVE:** The whole surface is built from a small vocabulary repeated everywhere — pill chrome (nav, filters, chart bars), a circular glyph slot (icon rail, brand marks in bars, avatars), and a number placed directly inside or immediately beside every mark. Nothing is a bare unlabeled shape.

---

## 2. Linear.app — dense working list (roadmap / initiatives)

- **URL:** https://linear.app
- **Retrieval evidence:** playwright-driver headless capture at 2026-08-01T22:01:17Z (full homepage) + targeted native-resolution crop (viewport 1600×1200, deviceScaleFactor 2) of the "Define the product direction" section. Saved to `refs/linear-initiatives-roadmap.png` — **288,307 bytes, 3200×1500 PNG**. A second crop of the issue-detail hero saved to `refs/linear-issue-detail.png` — **1,102,938 bytes, 3200×1800 PNG**. Both verified by Read.
- **What's actually in the capture:** `linear-initiatives-roadmap.png` — a two-pane view: left, an "Initiatives" tree list (Core Product 99, with nested children Infra stability 28 / Autonomous systems 16 / Mobile apps 8; APAC Expansion 21, with nested Japan Launch 12 / Customer-driven priorities 9) — each row is icon + label + right-aligned count, indentation shows parent/child. Right, a Gantt-style month timeline (Feb–Sep) with named tracks ("UI Refresh", "Split fares", "Autonomy status clarity"), each a horizontal bar spanning a date range with diamond milestone markers and a sub-label underneath the bar ("Core screens", "Polish", "Internal", "Public Beta", "Alpha"). `linear-issue-detail.png` — a single-issue view: left icon+label sidebar nav (Inbox/My issues/Reviews/Pulse, Workspace/Initiatives/Projects, Favorites), center issue body + threaded activity log (avatar + name + timestamp per entry, inline system events like label-added/status-changed), right a compact metadata stack (status/priority/assignee as icon+label rows) and a docked AI side-panel.
- **Transferable MOVE:** Hierarchy is expressed by indentation + a trailing count badge, never by extra chrome (no boxes-within-boxes) — this is how a dense multi-level list stays legible at 300+ rows. Separately: milestones on a timeline are a diamond marker on a bar with the sub-label sitting below the bar, not inside it.

---

## 3. Attio.com — dense working list (CRM record table)

- **URL:** https://attio.com/platform/data
- **Retrieval evidence:** playwright-driver headless capture at 2026-08-01T22:04:16Z, then a native-resolution crop (1600×1200 viewport, deviceScaleFactor 2) of the in-page product screenshot. Saved to `refs/attio-deals-table.png` — **623,071 bytes, 3200×1500 PNG**. Verified by Read.
- **What's actually in the capture:** A "Deals" record table inside a workspace shell (left rail: Quick actions, Notifications, Tasks, Notes, Emails, Reports, Automations, then a "Records" group listing People/Companies/Deals/Partnerships/Invoices). Table toolbar: "All deals ⌄" view-switcher pill, Sort and Filter pill-buttons, View settings / Import-Export. Table columns: a leading checkbox column, "Deal" (small brand/app favicon icon + company name, e.g. Retool, DigitalOcean, Stripe, Square, Loom, Superhuman, Notion, Webflow, Miro, Linear), "Type" (colored categorical pill: One-time/Recurring/Trial/Exclusive, each a distinct pastel color), "Potential value (USD)" (right-aligned currency), "Point of contact" (small circular avatar + name), "Source" (colored pill: Outreach/Referral/Event/Inbound).
- **Transferable MOVE:** Every row's identity column pairs a small brand/entity glyph directly against the name (not in a separate column), and every categorical field renders as a colored pill rather than plain text — so scanning down any column reads as color first, text second. Numeric and avatar columns stay plain (right-aligned currency, bare avatar+name) so the categorical pills are the only "loud" element in a row.

---

## 4. Raycast.com — filter-pill / command-list pattern

- **URL:** https://raycast.com
- **Retrieval evidence:** playwright-driver headless capture at 2026-08-01T22:04:59Z, native-resolution crop (1600×1200, deviceScaleFactor 2) of the command-palette hero screenshot. Saved to `refs/raycast-command-palette.png` — **726,425 bytes, 3200×1700 PNG**. Verified by Read.
- **What's actually in the capture:** A macOS menu-bar-framed screenshot of the Raycast command palette in clipboard-history mode. Top of the palette: a search input ("Type to filter entries…") plus an "All Types ⌄" dropdown-pill filter on the right. Below: a master list on the left grouped under a "Today" section header, each row an icon + label (image dimensions, hex-color swatch + code, URLs, a file snippet); the currently-selected row is highlighted and drives a full preview pane on the right (a color swatch enlarged, plus an "Information" key/value block: Application, Content Type, Copied-at). Footer: a persistent action bar showing the current mode ("Clipboard History"), the primary action with its keyboard shortcut (↵ "Copy to Clipboard"), and a secondary "Actions ⌘K" hint. Below the window, a dock of rounded-square mode-switcher icons.
- **Transferable MOVE:** The filter is a single dropdown pill sitting inline with the search box, not a separate row of chips — and the footer action bar is bound to whatever row is currently selected (icon + label + its keyboard shortcut), so the "what happens if I hit enter" answer is always visible without hunting for a button.

---

## 5. Vercel Analytics (vercel.com/analytics) — metric-card anatomy + chart-forward card

- **URL:** https://vercel.com/analytics
- **Retrieval evidence:** playwright-driver headless capture at 2026-08-01T22:06:24Z, two native-resolution crops (1600×1200, deviceScaleFactor 2). Saved to `refs/vercel-metric-cards.png` — **175,318 bytes, 3200×1400 PNG** — and `refs/vercel-chart-route-table.png` — **135,451 bytes, 3200×1700 PNG**. Both verified by Read.
- **What's actually in the capture:** `vercel-metric-cards.png` — two cards. Left: "First Contentful Paint" with a "Last 7 Days ⌄" filter pill, a P75/P90/P95/P99 legend (dots), a big colored numeral (1.01s) with a delta pill (-30%), a horizontal bar whose fill color is threshold-based (green segment then two gray "budget" segments), and below it three ranked mini-lists (Poor/To Improve/Great, each with a colored status icon, a count in the header, and route+count rows). Right: a "Real Experience Score" card — a circular ring gauge with the score (99) printed inside the ring, a "+25%" delta badge beside the title, then three sub-metric columns (label caption + big colored numeral + a threshold-colored horizontal bar with a dot marking current position), plus one full-width row for Cumulative Layout Shift. `vercel-chart-route-table.png` — a "Function Invocations" card: a stacked-area chart with a categorical dot-legend top-right (2xx/4xx/5xx), and directly below the chart (same card) a dense table — Route / Error Rate / Latency / Requests — where the route rows reuse the same visual language as the chart above.
- **Transferable MOVE:** A metric's health is shown by the FILL COLOR of its own progress bar hitting a threshold zone (green/amber/red), not by a separate badge — the bar doubles as the verdict. And a chart card is allowed to carry a dense table directly underneath it in the same card, with the table rows keyed to the chart's categories — the chart and the working list are one object, not two.

---

## 6. Illiyin Studio — "SaaS & Analytics Dark Dashboard" / "Landzy" (Dribbble)

- **URL:** https://dribbble.com/shots/23673869-SaaS-Analytics-Dark-Dashboard
- **Retrieval evidence:** Located via live Dribbble search (playwright-driver, query "dark dashboard") at 2026-08-01T22:08:20Z; direct CDN image URL extracted from the page: `https://cdn.dribbble.com/userupload/13144156/file/original-68bc41ace00369069250433c2abcdc60.png`, fetched via curl. Saved to `refs/illiyin-saas-dark-dashboard.png` — **1,804,149 bytes, 3200×2400 PNG**. Verified by Read (real content, not a skeleton).
- **What's actually in the capture:** A dark "Landzy" product dashboard. Left rail: logo, grouped nav (MAIN: Dashboard active/highlighted, Analytics; ACCOUNT: Product, Order, Notifications with a red unread dot, Integration, Resources, Messages; OTHER MENU: Account, Settings, Help) — each row icon + label, section groups as small uppercase eyebrow labels. Main hero: an "Overview" card on a purple radial-glow background with sparkle accents — big numeral "$32,520.01", a green "▲1.37%" delta pill, a dotted-leader list ("California ⋯⋯⋯ 15.010", "Melbourne ⋯⋯⋯ 8.012", etc., each with a location-pin icon), and a purple-stroked radar/spider chart (10–80 axis scale) to its right. Beside it, a bar chart card ("This month +$1235,00") with monthly bars (Jan/Feb/Mar) and a hover tooltip callout ("Mar 2023 — Value $3,4…"). Below: three metric cards (Total Revenue $6,101.01 / Total Transactions 1021 / Total Customer 914), each with a circular gradient icon-avatar, title, big numeral, colored delta pill (green up / red down), a "This week +N" caption, and its own small embedded bar-sparkline in the card's corner.
- **Transferable MOVE:** List rows use a dotted leader line between the label and the right-aligned value (like a table of contents) instead of a rule or extra column — reads cleanly with no grid. And each metric card owns its own miniature chart in-card (not a link-out to a bigger chart module), so the card is self-contained evidence, not just a number.

---

## Consolidated moves table

Superset of the 9 Nixtio-only moves (verified against the live capture — none contradicted, all confirmed as written) plus new moves extracted from the other five references.

| # | Move | Source | Verified against live capture |
|---|------|--------|-------------------------------|
| M1 | Oversized uppercase display title as screen anchor | Nixtio | Confirmed — "CHECK BOX" is the largest text on the screen, flush left, uppercase, bold |
| M2 | Data-viz-as-hero on overview surfaces | Nixtio | Confirmed — every card in the hero grid is a chart/metric, no plain text block |
| M3 | Metric anatomy: direction glyph + big tabular numeral + micro-caption + eyebrow | Nixtio | Confirmed — CUSTOMER/PRODUCT cards: ▲/▼ glyph, "2,4%" numeral, "Web Surfing" caption, "CUSTOMER" eyebrow |
| M4 | Legend + `Total:` footer per chart card | Nixtio | Confirmed — capsule chart ("Total: 1,012") and timeline ("Total: 284") both close with a legend + total footer |
| M5 | Filters as `label: value ⌄` pills | Nixtio | Confirmed — "Date: Now ⌄", "Product: All ⌄", "Profile: Bogdan ⌄" |
| M6 | Entity identity inside the data mark | Nixtio | Confirmed — brand icons/avatars sit at the start of each timeline bar |
| M7 | Pill chrome / floating nav / circular icon rail | Nixtio | Confirmed — pill nav buttons top bar; circular icon rail down the left edge |
| M8 | Categorical colour with legend, separate from severity | Nixtio | Confirmed — green/orange/white = Valid/Invalid/Resources and Customer/Product/Web, not error/warning states |
| M9 | The number lives inside the mark | Nixtio | Confirmed — capsule-chart pills have the value numeral printed inside the pill shape itself |
| M10 | Hierarchy by indentation + trailing count badge, no extra chrome | Linear | New — nested Initiatives tree list |
| M11 | Milestone = diamond marker on a timeline bar, sub-label sits below the bar | Linear | New — roadmap Gantt view |
| M12 | Entity glyph inline before the name; every categorical field is a colored pill, not text | Attio | New — Deals table |
| M13 | Filter as one inline dropdown pill next to search; footer action bar is bound to the selected row (icon + label + its keyboard shortcut) | Raycast | New — command palette |
| M14 | A metric's progress bar FILL COLOR communicates its threshold zone (green/amber/red) — the bar doubles as the verdict, no separate badge needed | Vercel | New — Web Vitals cards |
| M15 | A chart card can carry a dense keyed table directly beneath it in the same card; table rows share the chart's categorical colors | Vercel | New — Function Invocations card |
| M16 | Dotted leader line connects a label to a right-aligned value in a list row (no vertical rule, no extra column) | Illiyin | New — location breakdown list |
| M17 | Metric card embeds its own miniature chart/sparkline in-corner — self-contained evidence, not a link-out | Illiyin | New — Total Revenue/Transactions/Customer cards |

**17 moves total** (M1–M9 verified from Nixtio, M10–M17 new from the five supporting references).
