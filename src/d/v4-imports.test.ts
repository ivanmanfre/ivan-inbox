// T6 (SPEC-dms §3.1, §4.2): a Brief 4 view file never imports a write. Every write stays in the
// containers that already own it; v4 files get closures as props.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WRITES = /\b(approveDraft|composeReply|discardLegs|markSpam|deleteThread|snoozeDraft|setFollowUp|scheduleDm|restoreDraft|saveDraft\w*|markThreadRead|requestDmDraft|useDmVerbs|useWarmVerbs|saveOperatorNote|escalateDraftToClient|cancelScheduledDm|dispatchJob|cancelJob)\b/

function v4Files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) v4Files(p, out)
    else if (/[\\/]v4[\\/][^\\/]+\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

describe('T6 · v4 files import no write function', () => {
  const files = v4Files(join(__dirname))
  it('finds the v4 view files', () => { expect(files.length).toBeGreaterThan(8) })
  it.each(files.map(f => [f.slice(f.indexOf('/d/') + 1), f]))('%s', (_n, f) => {
    const imports = readFileSync(f, 'utf8').split('\n').filter(l => /^\s*import\b/.test(l)).join('\n')
    expect(imports).not.toMatch(WRITES)
  })
})
