/* ==========================================================================
   S06 — STYLES. The style roster, read live, previewed per lane.

   Copied from `src/exp/v2c/StylesList.tsx` and the `StyleRoster`,
   `stripMarkdown`, `blurbOf` and `drawableThumb` pieces of
   `src/exp/v2c/ContentSections.tsx`. Same fetch, same per-lane preview
   computation, same strings; the view is rebuilt on the design system.

   THIS SURFACE WRITES NOTHING. It is a read-only roster, so no row here is a
   button and no card carries an action — the only controls on the screen are
   the lane switch and the filter.
   ========================================================================== */
import { useRef, useState } from 'react'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useContent, useStyleRoster } from '../../hooks/useContent'
import {
  CONTENT_LANES, LANE_LABEL, LANE_POSSESSIVE, type ContentDraft, type ContentLane,
} from '../../lib/content'
import {
  cleanStyleTitle, previewKeyFor, previewsByStyle, type StylePrompt,
} from '../../lib/styles'
import {
  applyFilters, buildFacets, splitFacets, STYLE_PROMINENT, styleSpecs,
  type FilterState,
} from '../../lib/contentFilters'
import { relTime } from '../../exp/v2c/fmt'
import { SectionCard, Segmented } from '../../ds'
import { Bar, Body, Head, Screen } from '../kit'
import { Failed, FilteredEmpty, PullIndicator } from './parts'
import { FilterRow } from './filters'
import './content.css'

// The inline markdown a prompt body is written in. STRIPPED, never rendered:
// this is a card blurb, not a document, and the shipped card printed
// "**Version 3.0 — 2026-07-10 Black Box rewrite…**" asterisks and all.
// A lone `_` is deliberately left alone — these bodies are full of snake_case
// column names, and unpairing those would corrupt real values.
function stripMarkdown(line: string): string {
  return line.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '').trim()
}

// First ~2 non-heading lines of the prompt body, at most 180 characters.
// Heading and rule lines are DROPPED whole (they are structure, not prose);
// the strip above only cleans what survives that filter.
function blurbOf(body: string | null): string | null {
  if (!body) return null
  const lines = body.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('---'))
    .map(stripMarkdown)
    .filter(Boolean)
  const s = lines.slice(0, 2).join(' ')
  return s ? (s.length > 180 ? `${s.slice(0, 179)}…` : s) : null
}

// A Google Drive /file/…/view URL is a SHARE PAGE — HTML, not an image — so the
// browser blocks it and the <img> draws the broken glyph. Six of the sixteen
// example thumbs on this surface were exactly that. The row is not repaired
// here (image_urls is written elsewhere); the thumb is dropped, because a
// broken glyph claims a published example that cannot be shown.
function drawableThumb(u: string): boolean {
  return !/^https?:\/\/(?:[a-z0-9-]+\.)*drive\.google\.com\/file\//i.test(u)
}

function StyleCard({ p, preview }: {
  p: StylePrompt
  preview: { count: number; imageUrls: string[] } | undefined
}) {
  const thumbs = preview ? preview.imageUrls.filter(drawableThumb) : []
  const blurb = blurbOf(p.body)
  return (
    <SectionCard
      label={p.family}
      tail={<span className="a-dim a-mono">{relTime(p.updated_at)}</span>}
      className="a-st-card"
    >
      <div className="a-st-t">{cleanStyleTitle(p.title)}</div>
      {blurb && <div className="a-st-b">{blurb}</div>}
      {preview
        ? (
          <>
            <div className="a-ct-sub">
              {preview.count} published {preview.count === 1 ? 'post' : 'posts'}
            </div>
            {thumbs.length > 0 && (
              <div className="a-st-i">
                {/* Second guard, because the first one only knows the shapes we
                    have already met: anything else that fails to decode removes
                    ITSELF rather than leaving a broken-image glyph in the strip. */}
                {thumbs.map((u, i) => (
                  <img
                    src={u} alt="" key={`${u}-${i}`}
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                ))}
              </div>
            )}
          </>
        )
        : <div className="a-ct-sub">No published example in this lane yet.</div>}
    </SectionCard>
  )
}

function StyleRoster({ roster, laneRows, lane, loading, error, refresh }: {
  roster: StylePrompt[]
  laneRows: ContentDraft[]
  lane: ContentLane
  loading: boolean
  error: string | null
  refresh: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  // Computed from the PUBLISHED rows of the lane you are in, so the same roster
  // reads differently per lane — which is the honest outcome.
  const previews = previewsByStyle(laneRows)
  const specs = styleSpecs(previews as Map<string, unknown>, previewKeyFor)
  const { prominent, demoted } = splitFacets(buildFacets(roster, specs), STYLE_PROMINENT)
  const shown = applyFilters(roster, specs, filters)

  // Never a hardcoded fallback list: three historical hardcoded catalogues were
  // each wrong the day after they were written.
  if (error) return <Failed what="The style roster" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && roster.length === 0) return <div className="a-ct-sub">Reading the style roster…</div>

  return (
    <div className="a-stack">
      <div className="a-ct-sub">
        Read fresh every time, never a fixed list. Examples come from{' '}
        {LANE_POSSESSIVE[lane]} published rows, so an empty preview is a designed
        state — a wrong one would be a lie.
      </div>
      <Bar>
        <FilterRow
          prominent={prominent} demoted={demoted}
          state={filters} setState={setFilters}
          shown={shown.length} loaded={roster.length} total={null} noun="styles"
          inline
        />
      </Bar>
      {shown.length === 0
        ? <FilteredEmpty noun="styles" onClear={() => setFilters({})} />
        : (
          <div className="a-st-list">
            {shown.map(p => (
              // previewKeyFor, never normalizeStyleKey: the families collide on
              // 'before-after' and a family-blind key hands the image family's
              // examples to the structure card.
              <StyleCard key={p.slug} p={p} preview={previews.get(previewKeyFor(p))} />
            ))}
          </div>
        )}
    </div>
  )
}

export function StylesList({ lane, setLane }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
}) {
  const roster = useStyleRoster()
  const { drafts } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => roster.refresh())

  return (
    <Screen className="a-ct">
      <Head title="Styles" />
      <Bar>
        <Segmented
          label="Lane"
          markerId="a-st-lane"
          value={lane}
          onChange={k => setLane(k as ContentLane)}
          options={CONTENT_LANES.map(k => ({ id: k, label: LANE_LABEL[k] }))}
        />
      </Bar>
      <Body innerRef={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <StyleRoster
          roster={roster.rows} laneRows={drafts} lane={lane}
          loading={roster.loading} error={roster.error} refresh={roster.refresh}
        />
      </Body>
    </Screen>
  )
}
