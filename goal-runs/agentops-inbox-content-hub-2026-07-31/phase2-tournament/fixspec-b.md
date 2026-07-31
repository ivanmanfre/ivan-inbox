# Finalist B fix spec (ONE pass, scope: src/exp/cand-b/ only)
Read judge-verdicts.md first. Verify with `npx tsc --noEmit -p tsconfig.app.json`. Commit nothing.
1. Alert humanization (StudioScreen.tsx): alert_type → human label chip ("PIPELINE_STALL"→"Pipeline stall", underscores→spaces, sentence-case, keep amber chip); strip markdown asterisks from body via pure helper; VERIFY 4-line clamp actually applies in every alert render path (hub inline card + any other).
2. Severity discipline: zero-count stat tiles number in neutral --text3; severity color only when count>0. Shorten "Approved-unsched…" label to fit ("Approved, no date").
3. Double disclosure: trailing chevron only — remove inline '›' from row text ("Chat with n8nClaw", "Daily summary").
4. Styles rows chip idiom (hub gallery + StylesGridScreen): uppercase chip for type/format labels; title full width, meta (chip+time) own row below — kill wrap-squeeze.
5. Studio glyph: swap ❖ for stroke-consistent ◇ (single glyph, outlined register).
6. Resources empty state: designed quiet row "No published resources yet" instead of hiding section at 0.
7. #studio hash: Shell accepts '#studio' on load/hashchange and nav writes it (keep '#settings'→studio salvage).
8. No transient zeros: tiles/counts render skeleton/blank until the hook's loading is false — never "0" while loading.
9. Queue card thumbnails: ContentCard shows image_urls[0] thumb when present (thumb left, title full width, meta row under — match A's card anatomy).
