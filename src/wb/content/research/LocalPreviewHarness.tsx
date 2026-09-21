/* Local-only inspection surface. It reads files through Vite's /@fs dev path;
   there is no production import, auth bypass, or write capability here. */
import { useEffect, useState } from 'react'
import { Head, Screen } from '../../kit'

const root = '/Users/ivanmanfredi/Desktop/Ivan - Content System'
const r1 = `${root}/goal-runs/content-brain-01-evidence-briefs-2026-09-20-out/INITIAL-BATCH-IMPORT.json`
const resources = `${root}/goal-runs/content-brain-02-workspace-generation-2026-09-20-out/inventory/resource-rows.json`

export function LocalPreviewHarness() {
  const [state, setState] = useState<{ briefs: number; resources: number; demos: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void Promise.all([fetch(`/@fs/${r1}`).then(r => r.json()), fetch(`/@fs/${resources}`).then(r => r.json())]).then(([a,b]) => { const briefs = a.batches.flatMap((x: { briefs: unknown[] }) => x.briefs).length; const rows = b.rows as { source: string | null }[]; setState({ briefs, resources: rows.length, demos: rows.filter(x => x.source === 'hypertarget_demo').length }) }).catch(e => setError(e instanceof Error ? e.message : 'Local preview files could not load.')) }, [])
  return <Screen className="a-ct"><Head title="Local editorial preview" sub="Local files only. This does not verify authentication or production behavior." />{error ? <p className="a-ct-sub">{error}</p> : !state ? <p className="a-ct-sub">Reading Run 1 and inventory fixtures…</p> : <div className="a-body"><p className="a-ct-sub">{state.briefs} frozen brief records · {state.resources} scoped resource rows · {state.demos} demo rows. Use this as a layout/data-count inspection only.</p></div>}</Screen>
}
