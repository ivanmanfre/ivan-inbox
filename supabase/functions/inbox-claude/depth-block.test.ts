import { describe, expect, it } from 'vitest'
import { ALLOWLIST } from './allowlist.ts'
import { DEPTH_BLOCK, DEPTH_BLOCK_CHARS } from './depth-block.ts'
import { ALLOWLIST as ASSEMBLER_ALLOWLIST } from './assembler.ts'

// AMENDMENTS A2 is the reason this file exists. There is NO server-side tenancy
// enforcement on claude-brain-query's recall mode: a live probe with client_ids
// omitted returned 3 ProSWPPP rows out of 5. The scoping lives entirely in this
// prose, so the prose gets asserted like code.

describe('depth block — the allowlist cannot drift from the assembler', () => {
  it('reads the same constant object the assembler reads', () => {
    // Not "deep equal" — the SAME reference. Two equal-looking literals in two
    // files is exactly the drift DEPTH-SPEC §7 asks to make impossible.
    expect(ASSEMBLER_ALLOWLIST).toBe(ALLOWLIST)
  })

  it('names every allowlisted client and no other', () => {
    for (const c of ALLOWLIST) expect(DEPTH_BLOCK).toContain(`"${c}"`)
    for (const other of ['proswppp', 'risedtc', 'agencyops', 'lemonade']) {
      // They may be named as things to REFUSE, never inside a query.
      const inQuery = new RegExp(`client_ids?["'\\s:=\\[(]*[^\\n]*${other}`, 'i')
      const queryLines = DEPTH_BLOCK.split('\n').filter((l) => l.includes('client_id'))
      for (const line of queryLines) expect(inQuery.test(line)).toBe(false)
    }
  })
})

describe('depth block — A2.1: the scoped form is the only form shown', () => {
  const lines = DEPTH_BLOCK.split('\n')

  it('every claude-brain-query body that takes client_ids carries them', () => {
    // The recall/episodic recipes are the leak path. client_proposals scopes by
    // client_slug instead and is exempt by contract, so it is checked separately.
    const bodies = DEPTH_BLOCK.match(/-d '\{[^']*\}'/g) ?? []
    expect(bodies.length).toBeGreaterThanOrEqual(3)
    for (const b of bodies) {
      const scoped = b.includes('"client_ids"') || b.includes('"client_slug"')
      expect(scoped, `unscoped body: ${b}`).toBe(true)
    }
  })

  it('every PostgREST curl scopes by client_id', () => {
    const blocks = DEPTH_BLOCK.split(/\n(?=R\d )/).filter((b) => b.includes('/rest/v1/claude_memory'))
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const b of blocks) expect(b).toMatch(/client_id=(eq|in)\./)
  })

  it('contains zero unscoped examples anywhere', () => {
    // Phase 5 runs this same assertion against the DEPLOYED text. The unit is the
    // recipe: every mode that ACCEPTS client_ids must be shown carrying them, and
    // there must be no second, unscoped illustration of the same call further down.
    const recipes = DEPTH_BLOCK.split(/\n(?=R\d )/)
    for (const r of recipes) {
      for (const mode of ['"recall"', '"episodic"']) {
        if (!r.includes(mode)) continue
        expect(r, `recipe shows ${mode} unscoped`).toContain('"client_ids"')
      }
    }
    // And no line anywhere hands the model a client_ids list that isn't the allowlist.
    const lists = DEPTH_BLOCK.match(/"client_ids"\s*:\s*\[[^\]]*\]/g) ?? []
    expect(lists.length).toBeGreaterThan(0)
    for (const l of lists) {
      expect(JSON.parse(l.slice(l.indexOf('[')))).toEqual([...ALLOWLIST])
    }
    expect(lines.length).toBeGreaterThan(20)
  })
})

describe('depth block — A2.2/A2.3/A2.4: the honesty clauses', () => {
  it('names the graph modes UNSAFE and tells the model to decline them', () => {
    expect(DEPTH_BLOCK).toContain('NOT AVAILABLE')
    expect(DEPTH_BLOCK).toMatch(/UNSAFE/)
    for (const mode of ['connections', 'neighbors', 'related_to']) {
      expect(DEPTH_BLOCK).toContain(mode)
    }
    expect(DEPTH_BLOCK).toContain('p_client_ids:null')
  })

  it('tells the model to ALWAYS pass client_ids and says nothing enforces it', () => {
    expect(DEPTH_BLOCK).toContain('ALWAYS send client_ids')
    expect(DEPTH_BLOCK).toMatch(/Nothing on the server enforces this/)
  })

  it('tells the model to state when a depth query ran', () => {
    expect(DEPTH_BLOCK).toContain('SAY when you ran one')
    expect(DEPTH_BLOCK).toContain('Never claim you checked memory unless you actually ran one of these.')
  })
})

describe('depth block — secret handling (DEPTH-SPEC §3.5)', () => {
  it('references the key by name only and forbids printing it', () => {
    expect(DEPTH_BLOCK).toContain('$SUPABASE_SERVICE_KEY')
    expect(DEPTH_BLOCK).toContain('Never echo, print, expand, cat or')
  })

  it('embeds no JWT-shaped literal', () => {
    // Every Bash call the model makes is synced to Supabase by a PostToolUse hook,
    // so a key literal here would be written to durable storage every depth call.
    expect(DEPTH_BLOCK).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
  })
})

describe('depth block — size', () => {
  it('reports its own length so the assembler can reserve it', () => {
    expect(DEPTH_BLOCK_CHARS).toBe(DEPTH_BLOCK.length)
    // DEPTH-SPEC §3.4 estimated ~1,150 chars. It is bigger than that with the A2
    // clauses folded in; the number that matters is that the assembler reserves
    // the real one rather than the estimate.
    expect(DEPTH_BLOCK_CHARS).toBeGreaterThan(1_000)
    expect(DEPTH_BLOCK_CHARS).toBeLessThan(8_000)
  })
})
