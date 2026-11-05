import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const base = git('merge-base', 'origin/main', 'HEAD')[0]
const changed = new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])
assert(changed.size > 0, 'No repair files found')
for (const file of changed) assert(file.startsWith('src/d/dms/') || file.startsWith('scripts/inbox-ux-'), `Out-of-scope file: ${file}`)
assert.equal(git('diff', '--diff-filter=D', '--name-only', base).length, 0, 'A tracked file was deleted')
execFileSync('git', ['diff', '--check', base], { stdio: 'pipe' })
console.log(`SCOPE PASS: ${changed.size} files; no deleted files or backend changes`)
