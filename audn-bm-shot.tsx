// TEMPORARY screenshot harness — deleted before any commit. Renders the
// benchmark block from the three live payloads (fetched server-side with the
// service key, saved to audn-bm-payloads.json) so the block can be LOOKED AT
// without a signed-in session. No network from this page.
import { createRoot } from 'react-dom/client'
import './src/ds'
import { BenchmarkView } from './src/wb/content/BenchmarkBlock'
import payloads from './audn-bm-payloads.json'
import type { ContentLane } from './src/lib/content'
import type { Benchmark } from './src/lib/benchmark'

const lane = (new URLSearchParams(location.search).get('lane') ?? 'ivan') as ContentLane
const data = (payloads as Record<string, Benchmark>)[lane]

createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 12, maxWidth: 1240, margin: '0 auto' }}>
    <BenchmarkView lane={lane} state={{ kind: 'ready', data }} />
  </div>,
)
