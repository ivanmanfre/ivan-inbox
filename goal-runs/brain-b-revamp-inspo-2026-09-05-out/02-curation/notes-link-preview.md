# notes-link-preview — batch verdicts

## Batch 1 (6)
- dillionverma__tweet-card — light-mode Twitter embed: avatar+name+verified handle row, body text, then a rich screenshot card below. Move (author identity block over a nested rich-media card) maps well to a LinkedIn post preview if reskinned dark. KEEP as a shape reference, skin must go.
- tool-ui__citation — favicon+domain+date line, bold title, description, clean bordered card. This is almost exactly the OG-page preview shape we need. Light mode but trivially portable. STRONG KEEP.
- vercel-crawled__inline-citation — inline "openai.com +4" pill expands into a paginated (1/5) source browser with back/forward arrows and a quote. Interesting expand-in-place move but more about a multi-source browsing affordance than a single link card. Secondary, maybe runner-up.
- educalvolpz__ai-citation — numbered superscript footnote badges in prose. This is inline-citation-in-text styling, closer to thread-answer surface than link-preview cards. REJECT for this surface (off-target family).
- serafimcloud__error-message — dark-native red-tinted "Something went wrong" card, title+subtitle. Exact match for the blocked/failed link state. STRONG KEEP.
- edwinvakayil__favicon-badge — circular favicon badge with label, staggered spring entrance per icon. Good small move for how a domain/favicon announces itself on a card. KEEP as candidate, likely runner-up or a supporting detail not a full card.

## Batch 2 (6)
- cnippet.dev__v-card-14 — "Recent Orders Overview" icon-badge + title + desc + "View Orders" chevron link. Generic light-mode promo/nav card, not a link-preview idiom. REJECT.
- cnippet.dev__v-card-15 — "Documentation" header-divider card, desc, "View docs" link row. Same family as above, generic. REJECT.
- ravikatiyar162__card-26 — preview file corrupt/unreadable (not a valid image). REJECT (unusable).
- ruixen.ui__waveform-player — preview renders "Component not found". REJECT (unusable).
- jatin-yadav05__spotify-card — plain waveform bars + Play button, light mode, minimal. Weak but on-point for an audio/podcast-link media card. Marginal keep as a runner-up only.
- ziegfiroyt__browser28 (Domain Stack) — four browser-address-bar chrome strips fanned back in depth (decreasing scale/opacity), each showing a subdomain with a lock icon. Distinctive, on-brand-adjacent move: a stack of "site chrome" cards reads instantly as web/domain identity without needing a favicon fetch. STRONG KEEP — good candidate for how an OG/website card announces its domain, or for a stacked multi-link moment.

## Batch 3 (6)
- lyanchouss__fallback-card — dark card, faint binary-matrix texture, monitor-glyph icon, "Preview not available" caption. Dark-native, exactly the blocked/failed-fetch state we need for a link that couldn't be unfurled. STRONG KEEP.
- bundui__empty8 — light "No Internet Connection" wifi-off icon + title + desc + "Try Again" button. Generic app-level offline screen, not link-specific. Marginal, mostly redundant with fallback-card. Runner-up at best.
- felipemenezes098__skeleton-14 (Article Skeleton) — grey media-block placeholder + title bar + avatar/meta row + text lines, light mode. Good shape for the moment before an OG/YouTube card resolves (loading state adjacent to the blocked state the brief asks for). Keep as candidate.
- kokonutd__social-card — full post card (avatar/name/handle/timestamp, body text) with a NESTED inset link card (icon+title+description) inside the post, then like/comment/share/bookmark row below. Exactly the shape of a message that contains prose plus an embedded link card. STRONG KEEP.
- preetsuthar17__post-card — dark-mode X/Twitter-style post: avatar+name+handle+time, body copy, embedded website screenshot in a rounded media card below, Like/Save/Share row. Best dark-native social-post reference seen so far. STRONG KEEP.
- manuarora700__link-preview — hover over inline text reveals a floating rich image card (movie poster) anchored above the link. Desktop hover idiom with no touch equivalent; the floating-anchored-card render is intriguing but this is fundamentally a hover trick. REJECT (desktop-only idiom), note the anchored-floating-card idea as a maybe-later long-press affordance.
