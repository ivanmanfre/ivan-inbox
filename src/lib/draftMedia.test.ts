import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// THE PICTURE WRITES. Two contracts pinned here:
//  1. setDraftImage (Ivan's direct write) must refuse a carousel: image_urls=[url]
//     turns a scheduled deck into one photo, and the propagate trigger ships that
//     to the publish queue.
//  2. setDraftMedia / listClientPhotos / uploadDraftPicture: the gated RPC for all
//     lanes, and storage reads/writes made as ANON (the operator's session lists
//     storage as empty with no error, and post-stills refuses its uploads).

type Step = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown; cols?: string }
let steps: Step[] = []
let readRow: Record<string, unknown> | null = null
let updateResult: { data: unknown; error: unknown } = { data: [{ id: 'd1' }], error: null }
let rpcResult: { data: unknown; error: unknown } = { data: { ok: true, media_url: 'u' }, error: null }
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

function builder(table: string) {
  const make = (op: string, payload?: unknown, cols?: string) => {
    const step: Step = { table, op, filters: {}, payload, cols }
    steps.push(step)
    const chain = {
      eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
      is(k: string, v: unknown) { step.filters[`is:${k}`] = v; return chain },
      in(k: string, v: unknown) { step.filters[`in:${k}`] = v; return chain },
      maybeSingle() { return Promise.resolve({ data: readRow, error: null }) },
      select() { return Promise.resolve(updateResult) },
    }
    return chain
  }
  return {
    select: (cols: string) => make('select', undefined, cols),
    update: (payload: unknown) => make('update', payload),
  }
}

const publicUrl = (bucket: string, path: string, o?: { transform?: unknown }) => ({
  data: {
    publicUrl: o?.transform
      ? `https://project.supabase.co/storage/v1/render/image/public/${bucket}/${path}?width=200&quality=70`
      : `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}`,
  },
})

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return Promise.resolve(rpcResult) },
    storage: { from: (b: string) => ({ getPublicUrl: (p: string, o?: { transform?: unknown }) => publicUrl(b, p, o) }) },
  },
}))

const {
  setDraftImage, setDraftMedia, pictureEditable, listClientPhotos, uploadDraftPicture,
  CAROUSEL_REFUSAL, ClientRpcError, CLIENT_OPS_GATE,
} = await import('./content')

beforeEach(() => {
  steps = []; rpcCalls.length = 0
  readRow = { taxonomy: { pillar: 'trust' }, type: 'text' }
  updateResult = { data: [{ id: 'd1' }], error: null }
  rpcResult = { data: { ok: true, media_url: 'u' }, error: null }
})

describe('setDraftImage refuses a carousel (the deck wipe)', () => {
  it('a carousel is refused before any write, with the reason', async () => {
    readRow = { taxonomy: null, type: 'carousel' }
    await expect(setDraftImage('d1', 'https://x/a.jpg')).rejects.toThrow(CAROUSEL_REFUSAL)
    expect(steps.filter(s => s.op === 'update')).toHaveLength(0)
  })
  it('a removal on a carousel is refused too: [] would empty the deck', async () => {
    readRow = { taxonomy: null, type: 'carousel' }
    await expect(setDraftImage('d1', null)).rejects.toThrow(CAROUSEL_REFUSAL)
    expect(steps.filter(s => s.op === 'update')).toHaveLength(0)
  })
  it('a text post writes, and the update itself also carries the type predicate (race-safe)', async () => {
    await setDraftImage('d1', 'https://x/a.jpg')
    const up = steps.find(s => s.op === 'update')!
    expect(up.payload).toEqual({ image_urls: ['https://x/a.jpg'], taxonomy: { pillar: 'trust', no_photo: false } })
    expect(up.filters['in:type']).toEqual(['text', 'single_image'])
    expect(up.filters['is:client_id']).toBe(null)
    expect(steps[0].cols).toContain('type')
  })
  it('if the type changed under it, the empty update is a failure, never a success', async () => {
    updateResult = { data: [], error: null }
    await expect(setDraftImage('d1', null)).rejects.toThrow(/refused the write/)
  })
})

describe('pictureEditable mirrors db/230', () => {
  const d = (status: string, type: string | null, published_at: string | null = null) => ({ status, type, published_at })
  it('never on a carousel or video, either lane', () => {
    for (const lane of ['ivan', 'risedtc', 'arch'] as const) {
      expect(pictureEditable(d('review', 'carousel'), lane)).toBe(false)
      expect(pictureEditable(d('review', 'video'), lane)).toBe(false)
    }
  })
  it('never once published', () => {
    expect(pictureEditable(d('scheduled', 'text', '2026-09-29T08:00:00Z'), 'ivan')).toBe(false)
  })
  it('Ivan: review, approved, scheduled', () => {
    expect(['review', 'approved', 'scheduled', 'idea', 'generating', 'error'].map(s => pictureEditable(d(s, 'text'), 'ivan')))
      .toEqual([true, true, true, false, false, false])
  })
  it('client: review and scheduled only (the board function has no approved)', () => {
    expect(['review', 'approved', 'scheduled'].map(s => pictureEditable(d(s, 'single_image'), 'arch')))
      .toEqual([true, false, true])
  })
})

describe('setDraftMedia', () => {
  it('calls the gated RPC; a removal sends an empty URL', async () => {
    await setDraftMedia('d1', 'https://x/a.jpg')
    await setDraftMedia('d1', null)
    expect(rpcCalls).toEqual([
      { fn: 'operator_set_draft_media', args: { p_gate: CLIENT_OPS_GATE, p_draft_id: 'd1', p_url: 'https://x/a.jpg' } },
      { fn: 'operator_set_draft_media', args: { p_gate: CLIENT_OPS_GATE, p_draft_id: 'd1', p_url: '' } },
    ])
  })
  it("a refusal throws the server's code with a picture-specific sentence", async () => {
    rpcResult = { data: { ok: false, error: 'bad_status', status: 'idea' }, error: null }
    const e = await setDraftMedia('d1', 'https://x/a.jpg').catch(x => x)
    expect(e).toBeInstanceOf(ClientRpcError)
    expect(e.code).toBe('bad_status')
    expect(e.message).toMatch(/picture/)
    expect(e.message).not.toMatch(/re-dated/)
  })
  it('a carousel refusal from the database reads as the carousel sentence', async () => {
    rpcResult = { data: { ok: false, error: 'not_single_photo', type: 'carousel' }, error: null }
    await expect(setDraftMedia('d1', 'https://x/a.jpg')).rejects.toThrow(CAROUSEL_REFUSAL)
  })
  it('a transport error (e.g. the function is not applied yet) throws, never resolves', async () => {
    rpcResult = { data: null, error: { message: 'Could not find the function public.operator_set_draft_media' } }
    await expect(setDraftMedia('d1', null)).rejects.toThrow(/Could not find the function/)
  })
})

describe('client library and uploads go out as ANON', () => {
  const ANON = 'anon-key-under-test'
  let calls: { url: string; init: RequestInit }[] = []
  let reply: () => Response
  beforeEach(() => {
    calls = []
    reply = () => new Response(JSON.stringify([
      { name: 'davorin-1.jpg' }, { name: 'onepost' }, { name: '.emptyFolderPlaceholder' }, { name: 'Team.PNG' },
    ]), { status: 200 })
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return Promise.resolve(reply()) })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it("lists the client's folder root with the anon bearer, images only", async () => {
    const out = await listClientPhotos('arch-agency')
    expect(calls[0].url).toBe('https://project.supabase.co/storage/v1/object/list/client-photos')
    const h = calls[0].init.headers as Record<string, string>
    expect(h.Authorization).toBe(`Bearer ${ANON}`)
    expect(h.apikey).toBe(ANON)
    expect(JSON.parse(String(calls[0].init.body)).prefix).toBe('arch-agency')
    expect(out.map(p => p.name)).toEqual(['davorin-1.jpg', 'Team.PNG'])
    expect(out[0].url).toBe('https://project.supabase.co/storage/v1/object/public/client-photos/arch-agency/davorin-1.jpg')
    expect(out[0].thumb).toContain('/render/image/public/client-photos/arch-agency/davorin-1.jpg')
  })
  it('a refused list throws instead of showing an empty library', async () => {
    reply = () => new Response('{}', { status: 403 })
    await expect(listClientPhotos('arch-agency')).rejects.toThrow(/403/)
  })

  const file = (name: string, type: string, size = 10) => {
    const f = new File([new Uint8Array(size)], name, { type })
    return f
  }
  it("Ivan's upload goes to post-stills/onepost as anon, never upserting", async () => {
    reply = () => new Response('{"Key":"x"}', { status: 200 })
    const url = await uploadDraftPicture('ivan', 'abcdef12-3456', file('My Photo.JPG', 'image/jpeg'))
    expect(calls[0].url).toMatch(/^https:\/\/project\.supabase\.co\/storage\/v1\/object\/post-stills\/onepost\/abcdef12-\d+-my-photo\.jpg$/)
    const h = calls[0].init.headers as Record<string, string>
    expect(h.Authorization).toBe(`Bearer ${ANON}`)
    expect(h['x-upsert']).toBe('false')
    expect(url).toMatch(/\/object\/public\/post-stills\/onepost\/abcdef12-\d+-my-photo\.jpg$/)
  })
  it("a client's upload lands in the board's own one-off folder", async () => {
    reply = () => new Response('{"Key":"x"}', { status: 200 })
    const url = await uploadDraftPicture('risedtc', 'abcdef12-3456', file('a.png', 'image/png'))
    expect(calls[0].url).toMatch(/\/object\/client-photos\/risedtc-com\/onepost\/abcdef12-\d+-a\.png$/)
    expect(url).toMatch(/\/object\/public\/client-photos\/risedtc-com\/onepost\//)
  })
  it('refuses a non-image or an oversized file before any request', async () => {
    await expect(uploadDraftPicture('ivan', 'd1', file('a.pdf', 'application/pdf'))).rejects.toThrow(/not an image/)
    await expect(uploadDraftPicture('ivan', 'd1', file('a.jpg', 'image/jpeg', 16 * 1024 * 1024))).rejects.toThrow(/15 MB/)
    expect(calls).toHaveLength(0)
  })
  it('a refused upload throws', async () => {
    reply = () => new Response('{"error":"exists"}', { status: 409 })
    await expect(uploadDraftPicture('arch', 'd1', file('a.jpg', 'image/jpeg'))).rejects.toThrow(/409/)
  })
})
