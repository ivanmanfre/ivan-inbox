/* ==========================================================================
   S07 — STRATEGY. The one work surface that WRITES what it shows.

   Copied from `src/exp/v2c/StrategyView.tsx`. Every hook, the whole
   `lib/strategy` line-shape vocabulary, the auto-grow textarea, the save/
   discard pair, the dirty guard on the lane switch and the read-only filter
   spec are the ones that file had; the view is rebuilt on the design system.

   Two things changed shape and both are named in NOTES:
     · the two native `confirm()` calls (remove a written section, switch lane
       while dirty) are the app's own confirm now, so a destructive question is
       asked the same way here as everywhere else,
     · reorder, add and remove run on the ds spring under `AnimatePresence`,
       so a section that leaves is animated out instead of vanishing mid-frame.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fetchFilterSpec, type FilterRule, type FilterSpec } from '../../lib/strategy'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useStrategy } from '../../hooks/useStrategy'
import {
  addSection, blankCount, lineShape, moveSection, removeSection, sectionIsBlank, updateSection,
} from '../../lib/strategy'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import { laneOptions, resolveLane, useLanes } from '../../hooks/useLanes'
import { useConfirm } from '../chrome/ConfirmSheet'
import { Badge, Button, Card, IconButton, Input, Segmented, spring } from '../../ds'
import { Bar, Body, Group, Head, Screen } from '../kit'
import { Failed, PullIndicator, relAge } from './parts'
import { AudienceBlock } from './AudienceBlock'
import { OutreachBlock } from './OutreachBlock'
import { ProposalsBlock } from './ProposalsBlock'
import { EvidenceBlock } from './evidence/EvidenceBlock'
import { evidenceFixtureBypassActive } from '../../lib/contentEvidence'
import { BenchmarkBlock } from './BenchmarkBlock'
import { ReachBlock } from './ReachBlock'
import { ThemesBlock } from './ThemesBlock'
import { LeadMagnetsView } from './leadmagnets'
import { MarketsView } from './markets'
import { ClientDirectionPanel, DemoPanel, ResearchPanel, ResultsPanel as EditorialResultsPanel, ThisWeekPanel as EditorialThisWeekPanel } from './research/ResearchWorkspace'
import './content.css'
import './strategy-evidence.css'

// A textarea that grows to its content, because a strategy section is 2 lines
// or 20 and a fixed box makes the 20-line one a 4-line scroll port. Measured on
// every value change rather than on input, so a lane switch (which replaces the
// value without an input event) resizes too.
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

// A strategy is read far more often than it is typed, so the resting state is
// TYPESET, not a textarea. One click swaps in the editor. Three line shapes
// carry all the hierarchy, and each is inferable from the text itself — no
// markup for Ivan to remember and no second format to keep in sync:
//
//   RUN OF CAPS — rest    a group heading ("BUYERS — 1 post of 5")
//   Label — value         the label is the thing being decided
//   - item                a list item
//
// Classification lives in lib/strategy (pure, unit-tested); this only decides
// what each shape looks like.
function BodyLine({ line }: { line: string }) {
  const shape = lineShape(line)
  switch (shape.kind) {
    case 'gap':
      return <div className="a-strat-gap" />
    case 'item':
      return (
        <div className="a-strat-li">
          <span className="a-strat-bullet" aria-hidden>·</span>
          <span>{shape.text}</span>
        </div>
      )
    case 'head':
      return (
        <div className="a-strat-head">
          <span className="a-eyebrow">{shape.label}</span>
          {shape.rest && <span className="a-strat-headrest">{shape.rest}</span>}
        </div>
      )
    case 'kv':
      return (
        <div className="a-strat-kv">
          <span className="a-strat-k">{shape.label}</span>
          <span>{shape.rest}</span>
        </div>
      )
    default:
      return <div className="a-strat-p">{shape.text}</div>
  }
}

function StrategySection({ s, first, last, onPatch, onMove, onRemove, onAddAfter }: {
  s: { key: string; title: string; body: string }
  first: boolean
  last: boolean
  onPatch: (patch: { title?: string; body?: string }) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onAddAfter: () => void
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)
  useAutoGrow(bodyRef, editing ? s.body : '')
  const blank = sectionIsBlank(s)
  const confirm = useConfirm()

  // Focus lands at the END, not at character 0: clicking a section to append a
  // line and landing at the top is the wrong guess almost every time.
  useEffect(() => {
    if (!editing) return
    const el = bodyRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  return (
    <motion.div layout transition={spring} className="a-strat-card" data-blank={blank ? '' : undefined}>
      <Card
        title={
          <Input
            label="Section title"
            labelHidden
            className="a-strat-t"
            value={s.title}
            placeholder="Section title"
            onChange={e => onPatch({ title: e.target.value })}
          />
        }
        tail={
          <span className="a-strat-ctl">
            {/* Unwritten is the state worth SEEING — the tab exists because Ivan
                is flying without these. A blank section says so on its face
                instead of looking identical to a written one. */}
            {blank && <Badge tone="neutral" variant="ring">unwritten</Badge>}
            <IconButton icon="up" label="Move up" size="sm" disabled={first} onClick={() => onMove(-1)} />
            <IconButton icon="down" label="Move down" size="sm" disabled={last} onClick={() => onMove(1)} />
            <IconButton icon="add" label="Add a section below" size="sm" onClick={onAddAfter} />
            <IconButton
              icon="close" label="Remove this section" size="sm"
              onClick={async () => {
                // W3-20: the only destructive control in this cluster, so it
                // never fires bare, a blank section confirms too now, same
                // as ReactionDesk's Kill, just with a message that does not
                // claim lost text when there was none to lose.
                const ok = await confirm({
                  title: `Remove "${s.title || 'this section'}"?`,
                  message: blank ? 'Nothing is written in it yet.' : 'Its text is not recoverable.',
                  confirmText: 'Remove',
                  danger: true,
                })
                if (!ok) return
                onRemove()
              }}
            />
          </span>
        }
      >
        {editing ? (
          <textarea
            ref={bodyRef}
            className="ds-textarea a-strat-b"
            aria-label="Section body"
            value={s.body}
            rows={2}
            placeholder="One line per decision. CAPS heads a group, Label, value, - for a list."
            onChange={e => onPatch({ body: e.target.value })}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <div
            className="a-strat-read"
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}
          >
            {s.body.trim()
              ? s.body.split('\n').map((line, i) => <BodyLine key={i} line={line} />)
              : <div className="a-dim-2">Click to write this one.</div>}
          </div>
        )}
      </Card>
    </motion.div>
  )
}

// ---- Live ICP filter spec ---------------------------------------------------
// READ-ONLY, and published by the harvest engine itself (db/043). The only way
// to guarantee the filters move whenever they move is to render what the engine
// wrote on its last run rather than a copy maintained by hand. `captured_at` is
// shown for exactly that reason: a spec with no timestamp cannot be trusted to
// be current. Every gate is printed verbatim, regexes included. They look dense
// because they ARE dense, and a prettified paraphrase would be the same drift
// problem wearing a nicer font.
function FilterSpecBlock({ lane }: { lane: ContentLane }) {
  const [rows, setRows] = useState<FilterSpec[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setRows(null); setError(null)
    fetchFilterSpec(lane).then(data => { if (live) setRows(data) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Filters could not load.') })
    return () => { live = false }
  }, [lane, tick])
  if (error) return <Failed what="This lane's outreach filters" message={error} onRetry={() => setTick(t => t + 1)} />
  if (rows === null) return <div className="a-ct-sub">Reading this lane’s filters…</div>
  if (!rows.length) {
    return (
      <div className="a-ct-sub">
        No outreach filter spec is available for {LANE_LABEL[lane]} in this read.
      </div>
    )
  }
  return (
    <>
      {rows.map(r => {
        const groups: string[] = []
        for (const x of r.spec) if (!groups.includes(x.group)) groups.push(x.group)
        return (
          <Group
            key={r.client_id + r.run_tag}
            label="Live outreach filters"
            tail={<span className="a-dim a-mono">{r.client_id} · read {relAge(r.captured_at)}</span>}
            pad
          >
            <div className="a-ct-sub">
              Published by the engine on its last run, not written here. Change a gate in the
              harvester and this line changes with it.
            </div>
            {groups.map(g => (
              <div className="a-fs-g" key={g}>
                <div className="a-eyebrow">{g}</div>
                {r.spec.filter((x: FilterRule) => x.group === g).map((x, i) => (
                  <div className="a-fs-r" key={i}>
                    <div className="a-fs-l">{x.label}</div>
                    <div className="a-fs-v">{x.value ?? <span className="a-dim-2">No reading</span>}</div>
                    {x.note ? <div className="a-fs-n">{x.note}</div> : null}
                    {/* The raw pattern is reference, not reading. It stays
                        collapsed so the block scans as a table; a 300-character
                        class printed inline turns the surface into a wall. */}
                    {x.rule && x.rule !== x.value ? (
                      <details className="a-fs-d">
                        <summary>pattern</summary>
                        <code className="a-fs-c">{x.rule}</code>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </Group>
        )
      })}
    </>
  )
}

export function StrategyView({ lane, setLane }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
}) {
  const st = useStrategy(lane)
  // The tenants this operator may see come from client_registry through
  // operator_lanes, so onboarding a client adds a lane here with no deploy.
  const lanes = useLanes()
  // W5 REACHABILITY (content-evidence-03 Phase 2 fix pass): the independent
  // checker opens a `?evidenceFixture=<state>` URL with a fresh browser
  // profile and clicks nothing, so a URL carrying that param has to land
  // directly on the Evidence tab rather than the default Recommendations
  // one. DEV-only and tree-shaken exactly like `contentEvidence.ts`'s own
  // fixture lever — the inline `import.meta.env.DEV &&` here is what lets
  // Rollup fold the whole branch (and `evidenceFixtureBypassActive`'s call)
  // out of a `NODE_ENV=production` build.
  const [view, setView] = useState(() => (
    import.meta.env.DEV && typeof window !== 'undefined'
      && evidenceFixtureBypassActive(import.meta.env.DEV, window.location.search)
      ? 'evidence' : (typeof location !== 'undefined' && (() => { const q = new URLSearchParams(location.hash.split('?')[1] ?? ''); return q.get('sources') === '1' || q.get('section') === 'sources' })() ? 'research' : 'this-week')
  ))
  const [refreshTick, setRefreshTick] = useState(0)
  const [proposalDirty, setProposalDirty] = useState(false)
  const rowsRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()
  // Pull-to-refresh would discard unsaved edits, so it is wired to a refresh
  // that refuses while dirty rather than being wired to nothing (a dead pull
  // gesture reads as a broken surface).
  const ptr = usePullToRefresh(rowsRef, () => {
    if (view === 'notes') { if (!st.dirty) st.refresh() }
    else if (!proposalDirty) setRefreshTick(t => t + 1)
  })
  useEffect(() => { if (rowsRef.current) rowsRef.current.scrollTop = 0 }, [view, lane])
  // A lane the registry no longer lists would leave the switch with nothing
  // selected and every block fetching a seat it may not read. The shell holds
  // one lane for all four content surfaces, so correcting it here corrects it
  // everywhere. Inert while the three shipped lanes are the registry's answer.
  useEffect(() => {
    if (lanes.state !== 'registry') return
    const next = resolveLane(lane, lanes.lanes)
    if (next !== lane) setLane(next as ContentLane)
  }, [lane, lanes.state, lanes.lanes, setLane])

  const head = (
    <>
    <Head
      title="Strategy"
      sub={st.dirty ? 'Unsaved notes' : 'Recommendations and evidence'}
    />
    <Bar>
        <Segmented
          label="Lane"
          markerId="a-strat-lane"
          value={lane}
          onChange={async k => {
            if (st.saving) return
            // Switching lane remounts against a different row. Doing that with
            // unsaved text would drop it silently.
            if (st.dirty || proposalDirty) {
              const ok = await confirm({
                title: 'You have unsaved edits on this lane.',
                message: 'Switch lane and lose them?',
                confirmText: 'Switch and lose them',
                danger: true,
              })
              if (!ok) return
            }
            setProposalDirty(false)
            setLane(k as ContentLane)
          }}
          options={laneOptions(lanes.lanes)}
        />
    </Bar>
    <Bar>
      <Segmented label="Strategy views" className="a-strategy-nav" markerId="a-strategy-view"
        value={view} onChange={setView} options={[
          { id: 'this-week', label: 'This week' },
          { id: 'research', label: 'Research' },
          { id: 'results', label: 'Results' },
          { id: 'direction', label: 'Client direction' },
        ]} />
    </Bar>
    </>
  )

  const blanks = blankCount(st.sections)

  return (
    <Screen className="a-ct" lanes={lanes.state}>
      {head}
      <Body innerRef={rowsRef} className="a-strat">
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <details className="a-strategy-disclosure"><summary>More: demos, legacy analysis and private notes</summary><div className="a-research-actions"><Button size="sm" variant="quiet" onClick={() => setView('demos')}>Demos</Button><Button size="sm" variant="quiet" onClick={() => setView('recommendations')}>Legacy suggestions</Button><Button size="sm" variant="quiet" onClick={() => setView('evidence')}>Evidence archive</Button><Button size="sm" variant="quiet" onClick={() => setView('competitors')}>Competitors</Button><Button size="sm" variant="quiet" onClick={() => setView('magnets')}>Lead magnets</Button><Button size="sm" variant="quiet" onClick={() => setView('outreach')}>Outreach</Button><Button size="sm" variant="quiet" onClick={() => setView('markets')}>Markets</Button><Button size="sm" variant="quiet" onClick={() => setView('notes')}>{st.dirty ? 'Notes •' : 'Notes'}</Button></div></details>
        {view === 'this-week' && <div className="a-strategy-panel"><EditorialThisWeekPanel key={`${lane}-${refreshTick}`} lane={lane} /></div>}
        {view === 'research' && <div className="a-strategy-panel"><ResearchPanel key={`${lane}-${refreshTick}`} lane={lane} /></div>}
        {view === 'results' && <div key={`${lane}-${refreshTick}`} className="a-strategy-results">
          <EditorialResultsPanel lane={lane} />
          <ReachBlock lane={lane} />
          <BenchmarkBlock lane={lane} view="results" />
          <details className="a-strategy-disclosure"><summary>Explore subjects, hooks and formats</summary><ThemesBlock lane={lane} /></details>
          <details className="a-strategy-disclosure"><summary>Audience and recommendation outcomes</summary><AudienceBlock lane={lane} /></details>
        </div>}
        {view === 'direction' && <ClientDirectionPanel lane={lane} />}
        {view === 'demos' && <DemoPanel lane={lane} />}
        {view === 'recommendations' && <div className="a-strategy-panel"><ProposalsBlock key={lane} lane={lane} refreshKey={refreshTick} onDirtyChange={setProposalDirty} /></div>}
        {view === 'evidence' && <div key={`${lane}-${refreshTick}`} className="a-strategy-panel"><EvidenceBlock lane={lane} /></div>}
        {view === 'competitors' && <BenchmarkBlock key={`${lane}-${refreshTick}`} lane={lane} view="competitors" />}
        {view === 'magnets' && <LeadMagnetsView key={`${lane}-${refreshTick}`} lane={lane} />}
        {view === 'markets' && <MarketsView key={`${lane}-${refreshTick}`} lane={lane} />}
        {view === 'outreach' && <div key={`${lane}-${refreshTick}`} className="a-strategy-panel"><OutreachBlock lane={lane} /></div>}
        {view === 'notes' && <>
        <div className="a-ct-sub">Private editorial notes{st.updatedAt ? ` · saved ${relAge(st.updatedAt)}` : ''}. These notes are not connected to the generator. Review dated claims against Competitors and Results before using them.</div>
        {st.error ? <Failed what="This lane's notes" message={st.error} onRetry={st.refresh} loadedAt={null} /> : st.loading ? (
          <div className="a-ct-sub a-strat-hold">Loading…</div>
        ) : (
          <>
            <div className="a-ct-sub">
              {blanks > 0
                ? `${blanks} of ${st.sections.length} sections still unwritten.`
                : `${st.sections.length} sections, all written.`}
              {' '}Only you can see these notes.
            </div>
            <AnimatePresence initial={false}>
              {st.sections.map((s, i) => (
                <StrategySection
                  key={s.key}
                  s={s}
                  first={i === 0}
                  last={i === st.sections.length - 1}
                  onPatch={patch => st.setSections(cur => updateSection(cur, s.key, patch))}
                  onMove={dir => st.setSections(cur => moveSection(cur, s.key, dir))}
                  onRemove={() => st.setSections(cur => removeSection(cur, s.key))}
                  onAddAfter={() => st.setSections(cur => addSection(cur, s.key))}
                />
              ))}
            </AnimatePresence>
            <div className="a-strat-add">
              <Button icon="add" onClick={() => st.setSections(cur => addSection(cur, null))}>
                Add a section
              </Button>
            </div>
          </>
        )}
        <details className="a-strategy-disclosure"><summary>Live outreach filters for {LANE_LABEL[lane]}</summary><FilterSpecBlock key={lane} lane={lane} /></details>
        </>}
        <div className="a-strat-foot" aria-hidden />
      </Body>
      {/* The save bar exists only when there is something to save — a
          permanently docked bar with a greyed button teaches nothing and costs
          56px of a phone screen on every visit. */}
      <AnimatePresence>
        {st.dirty && (
          <motion.div
            className="a-strat-save"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
          >
            <span className={st.saveError ? 'a-sev-urgent' : 'a-dim'}>
              {st.saveError ?? 'Unsaved changes'}
            </span>
            <div className="a-bar-spacer" />
            <Button variant="quiet" disabled={st.saving} onClick={st.refresh}>Discard</Button>
            <Button variant="primary" busy={st.saving} disabled={st.saving} onClick={() => { void st.save() }}>
              {st.saving ? 'Saving…' : 'Save'}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Screen>
  )
}
