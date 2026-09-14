import { describe, it, expect } from 'vitest'
import { makePageStorage } from './sessionStorage'

const SESSION = 'sb-abc-auth-token'
const sess = (expires_at: number, tag: string) => JSON.stringify({ access_token: tag, refresh_token: 'r', expires_at })

function harness(localInit: Record<string, string>, workerCopy: string | null) {
  const local = new Map(Object.entries(localInit))
  const worker = { value: workerCopy, writes: 0, deletes: 0 }
  const storage = makePageStorage({
    local: { getItem: k => local.get(k) ?? null, setItem: (k, v) => { local.set(k, v) }, removeItem: k => { local.delete(k) } },
    readWorker: async () => worker.value,
    writeWorker: async v => { worker.value = v; worker.writes += 1 },
    deleteWorker: async () => { worker.value = null; worker.deletes += 1 },
  })
  return { storage, local, worker }
}

describe('makePageStorage — the page session store with the worker copy folded in', () => {
  it('adopts a later-expiring worker copy on the first read of the session key and writes it back locally', async () => {
    const h = harness({ [SESSION]: sess(100, 'old') }, sess(200, 'worker'))
    expect(await h.storage.getItem(SESSION)).toBe(sess(200, 'worker'))
    expect(h.local.get(SESSION)).toBe(sess(200, 'worker'))
  })
  it('never consults or pollutes on a key that is not the session', async () => {
    const h = harness({ [SESSION]: sess(100, 'old') }, sess(200, 'worker'))
    expect(await h.storage.getItem(`${SESSION}-code-verifier`)).toBeNull()
    expect(h.local.has(`${SESSION}-code-verifier`)).toBe(false)
    // the session key still gets its first-read adoption afterwards
    expect(await h.storage.getItem(SESSION)).toBe(sess(200, 'worker'))
  })
  it('reads locally only after the first session read, until the page becomes visible again', async () => {
    const h = harness({ [SESSION]: sess(300, 'local') }, sess(200, 'worker'))
    expect(await h.storage.getItem(SESSION)).toBe(sess(300, 'local'))
    h.worker.value = sess(400, 'worker2')
    expect(await h.storage.getItem(SESSION)).toBe(sess(300, 'local'))
    h.storage.consultWorkerAgain()
    expect(await h.storage.getItem(SESSION)).toBe(sess(400, 'worker2'))
  })
  it('mirrors session writes and removals to the worker, and nothing else', async () => {
    const h = harness({}, null)
    h.storage.setItem(`${SESSION}-code-verifier`, 'v')
    expect(h.worker.writes).toBe(0)
    h.storage.setItem(SESSION, sess(500, 'fresh'))
    await Promise.resolve()
    expect(h.worker.value).toBe(sess(500, 'fresh'))
    h.storage.removeItem(`${SESSION}-code-verifier`)
    expect(h.worker.deletes).toBe(0)
    h.storage.removeItem(SESSION)
    await Promise.resolve()
    expect(h.worker.value).toBeNull()
    expect(h.local.has(SESSION)).toBe(false)
  })
})
