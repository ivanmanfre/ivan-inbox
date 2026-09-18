import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FALLBACK_LANES, laneOptions, resolveLane, useLanes } from './useLanes'
import { CONTENT_LANES } from '../lib/content'
import type { Lane, LanesRead } from '../lib/markets'

const REGISTRY: Lane[] = [
  { client_id: 'arch', display_name: 'Davorin Smit' },
  { client_id: 'ivan', display_name: 'Ivan' },
  { client_id: 'risedtc', display_name: 'Mattan Danino' },
]

function store(seed?: string): Pick<Storage, 'getItem' | 'setItem'> & { written: string | null } {
  let held = seed ?? null
  return {
    written: null,
    getItem: () => held,
    setItem(_k: string, v: string) { held = v; (this as { written: string | null }).written = v },
  }
}

/** The hook, rendered. Server rendering runs no effect, which is exactly the
    first frame: whatever paints here is what a cold open shows before the read
    lands, and it may never be an empty switch. */
function Probe({ read, s }: { read: () => Promise<LanesRead>; s?: Pick<Storage, 'getItem' | 'setItem'> }) {
  const lanes = useLanes(read, s)
  return <div data-lanes={lanes.state}>{laneOptions(lanes.lanes).map(o => <span key={o.id}>{o.label}</span>)}</div>
}

const never = () => new Promise<LanesRead>(() => {})

describe('the lane list', () => {
  it('falls back to the lanes the code has always known while the read is in flight', () => {
    const html = renderToStaticMarkup(<Probe read={never} s={store()} />)
    expect(html).toContain('data-lanes="loading"')
    expect(html).toContain('Ivan')
    expect(html).toContain('Mattan Danino')
    expect(html).toContain('Davorin Smit')
  })

  it('the fallback is the old constant, one entry per lane, in its order', () => {
    expect(FALLBACK_LANES.map(l => l.client_id)).toEqual([...CONTENT_LANES])
    expect(FALLBACK_LANES.every(l => l.display_name.length > 0)).toBe(true)
  })

  it('a cached answer paints on the first frame and says it came from the registry', () => {
    const html = renderToStaticMarkup(<Probe read={never} s={store(JSON.stringify(REGISTRY))} />)
    expect(html).toContain('data-lanes="registry"')
    expect(html).toContain('Davorin Smit')
  })

  it('a cached value that is not a lane list is ignored rather than rendered', () => {
    for (const bad of ['[]', '{"a":1}', 'not json', '[{"client_id":""}]']) {
      const html = renderToStaticMarkup(<Probe read={never} s={store(bad)} />)
      expect(html).toContain('data-lanes="loading"')
    }
  })

  it('a store that throws leaves the switch standing', () => {
    const angry = {
      getItem() { throw new Error('private window') },
      setItem() { throw new Error('private window') },
    }
    const html = renderToStaticMarkup(<Probe read={never} s={angry} />)
    expect(html).toContain('data-lanes="loading"')
    expect(html).toContain('Ivan')
  })
})

describe('which lane a surface shows', () => {
  it('keeps the lane the operator was on when the registry still lists it', () => {
    expect(resolveLane('risedtc', REGISTRY)).toBe('risedtc')
  })

  it('falls to the first listed lane when the one held is gone', () => {
    expect(resolveLane('offboarded', REGISTRY)).toBe('arch')
  })

  it('leaves the held lane alone rather than pointing at nothing when the list is empty', () => {
    expect(resolveLane('ivan', [])).toBe('ivan')
  })

  it('the Segmented shows display names and never a client id', () => {
    const opts = laneOptions(REGISTRY)
    expect(opts.map(o => o.label)).toEqual(['Davorin Smit', 'Ivan', 'Mattan Danino'])
    expect(opts.map(o => o.id)).toEqual(['arch', 'ivan', 'risedtc'])
  })
})
