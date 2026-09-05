# link-preview — 21st.dev curation

Surface: link cards for YouTube, LinkedIn, Open Graph pages, media cards with thumbnails, and a blocked or failed state.

Pool built: 24 candidates (by-surface.json's `link-preview` seed, 28 noisy entries dominated by hover-card/spotlight-card skins, plus grep over references.json on youtube / media card / thumbnail / embed / og / favicon / citation / linkedin / unfurl / link card / source card / blocked / offline / not found / spotify / tweet / domain / browser bar). Previews opened and judged: 22 (2 of the 24 were unusable — corrupt file, "Component not found" render).

What the current build does wrong (from `../../brain-b-design-elevation-2026-09-04-out/01-build/b/shots/link-preview.png`): a YouTube card already renders fine above the composer (thumbnail + title + channel), but the composer input below still shows the raw pasted URL as plain wrapped text, `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, instead of collapsing it into a card the moment it lands. There is also no visible treatment yet for a LinkedIn post, a bare Open Graph page, or a link that fails to resolve.

## Picks

### 1. Post Card · preetsuthar17 · usage 66
- **Move:** a dark-native social post shell — avatar, name, handle, timestamp up top, then body prose, then a rounded embedded website screenshot sitting below the text as its own nested block, with Like/Save/Share underneath.
- **Lands in the inbox:** this is the direct template for a LinkedIn-post link: the post's own text stays as normal message prose, and the page screenshot renders as a distinct nested card beneath it rather than inline with the words, so Ivan's eye separates "what they said" from "what they linked."
- **Risk:** the demo screenshot fills the card edge to edge; at 390px a tall LinkedIn screenshot will crop awkwardly unless it is cropped to a fixed aspect ratio (16:9 or similar) rather than shown at native height.
- **Preview:** `../01-refs/previews/preetsuthar17__post-card.png`
- **Video:** https://cdn.21st.dev/user_2rWolCuRnJW3DRiuQ5JHrl5kj8a/post-card/default/video.1750812309716.mp4

### 2. Citation · tool-ui · usage 0
- **Move:** favicon + domain + date on one thin line, a bold title below it, then a plain description line — no image, no border weight, just three rows of typographic hierarchy.
- **Lands in the inbox:** this is the Open Graph page card when a site sends no rich thumbnail. Right now the build likely defaults every link to the same big-thumbnail card; this gives a lighter fallback shape so a bare blog post or docs page doesn't inflate to the same visual weight as a YouTube video.
- **Risk:** without a thumbnail the card can read as inert text; the favicon needs enough presence (real icon fetch, not a generic globe glyph) to still say "this is a link" at a glance.
- **Preview:** `../01-refs/previews/tool-ui__citation.png`
- **Video:** none

### 3. Error Message · serafimcloud · usage 0
- **Move:** a compact, already-dark red-tinted card — bold title line, quieter subtitle line, no icon, no illustration, sized like any other message bubble.
- **Lands in the inbox:** the blocked/failed link state. When a URL can't be fetched (dead page, blocked crawler, private LinkedIn post), this renders as "Couldn't load this link" / "The page didn't respond" at the same size as the card it would have replaced, instead of a broken image or an empty box.
- **Risk:** if this shape gets reused for every kind of error in the app, a link failure and a system failure become visually identical; keep the copy specific to "link" so it never gets mistaken for an automation alert.
- **Preview:** `../01-refs/previews/serafimcloud__error-message.png`
- **Video:** none

### 4. Domain Stack (browser28) · ziegfiroyt · usage 0
- **Move:** four browser-chrome address bars fanned back in depth, each narrower and fainter than the one in front, each showing a different subdomain with a small lock glyph.
- **Lands in the inbox:** a way to show a card's domain as real "site chrome" (a thin bar with a lock and the hostname) instead of a generic favicon dot, and, at depth, a way to stack multiple links pasted in one message so Ivan sees "3 links" as a fanned deck before he taps into any one of them.
- **Risk:** the fan-and-fade is a desktop illustration move; at 390px it only earns its keep as the address-bar strip on a single card (hostname + lock, one line), not as an actual 3D stack, or it becomes a decorative gimmick fighting the flat canon.
- **Preview:** `../01-refs/previews/ziegfiroyt__browser28.png`
- **Video:** none

### 5. Social Card · kokonutd · usage 123
- **Move:** a post's own prose stays first-class ("Just launched Kokonut UI! Check out the documentation..."), and the link renders as a small nested inset directly below it — a rounded chip-icon, a bold title, one line of description — sitting inside the same card as the text that introduced it.
- **Lands in the inbox:** this is the fix for the exact bug visible in the current build: when Ivan types "Worth watching before the call: https://youtube.com/..." the sent message should echo his sentence AND immediately collapse the URL into this nested card in the same bubble, instead of leaving the raw link text sitting in the composer.
- **Risk:** nesting a card inside a message bubble adds a second border/radius layer; if the inset isn't visually quieter (flatter, no shadow) than the outer bubble, two nested rounded rectangles will read as a UI bug rather than a design choice.
- **Preview:** `../01-refs/previews/kokonutd__social-card.png`
- **Video:** https://cdn.21st.dev/user_2rQ1QHrJyxpmWMHhqhANzWMc64n/social-card/default/video.mp4

## Runners-up

- **Tweet Card · dillionverma · 0** — author row (avatar, name, verified badge, handle) sitting above a full rich embedded screenshot; same shape as pick 1 but light mode, would need a full dark reskin. `../01-refs/previews/dillionverma__tweet-card.png`
- **Fallback Card · lyanchouss · 0** — an alternate blocked/failed treatment: dark card with a faint binary-matrix texture, a monitor glyph, and "Preview not available" — moodier than pick 3, worth a side-by-side before choosing. `../01-refs/previews/lyanchouss__fallback-card.png`
- **Favicon Badge · edwinvakayil · 0** — circular favicon badge with a label and a staggered spring-entrance animation per icon; a good small motion detail for how a domain identity announces itself on first render. `../01-refs/previews/edwinvakayil__favicon-badge.png`
- **Article Skeleton (skeleton-14) · felipemenezes098 · 0** — grey media-block + title bar + byline placeholder; the shape a link card should hold for the half-second before its OG data resolves. `../01-refs/previews/felipemenezes098__skeleton-14.png`
- **HoverPeek Link Preview · aghasisahakyan1 · 109** — a website screenshot framed in real browser chrome (rounded window, dotted top bar); the frame itself is a nice thumbnail treatment even though the hover-to-reveal trigger is a desktop-only idiom that won't survive on touch. `../01-refs/previews/aghasisahakyan1__link-preview.png`
