// Voice gate for strings this run added. Reads the branch diff against the merge
// base, pulls ADDED lines only, and flags em dashes plus the banned vocabulary
// from content_prompts `forbidden-language`.
//
// Scope note: this checks the app's own UI copy and comments. Prospect-facing
// copy is out of scope for the run entirely, so a hit here is always ours to fix.
//
//   node voice-lint.mjs [--base main]
import { execSync } from 'node:child_process'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('base', 'main')
const REPO = '/Users/ivanmanfredi/Desktop/ivan-inbox'

// From forbidden-language: the banned-word table's AI tells. Matched
// case-insensitively on word boundaries.
const BANNED = [
  'delve', 'leverage', 'landscape', 'harness', 'seamless', 'robust', 'tapestry',
  'multifaceted', 'pivotal', 'holistic', 'synergy', 'paradigm', 'empower',
  'elevate', 'foster', 'utilize', 'curate', 'endeavour', 'realm', 'catalyst',
  'testament', 'intricate', 'supercharge', 'unlock', 'transformative',
  'game-changer', 'cutting-edge', 'best-in-class', 'unparalleled',
]

const diff = execSync(`git -C ${REPO} diff ${BASE}...HEAD --unified=0 -- 'src/*'`, { maxBuffer: 64 * 1024 * 1024 }).toString()

let file = null
const hits = []
let added = 0
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue }
  if (!line.startsWith('+') || line.startsWith('+++')) continue
  const text = line.slice(1)
  added++
  if (text.includes('—')) hits.push({ file, kind: 'em dash', text: text.trim().slice(0, 120) })
  if (text.includes('–')) hits.push({ file, kind: 'en dash', text: text.trim().slice(0, 120) })
  for (const w of BANNED) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) hits.push({ file, kind: 'banned: ' + w, text: text.trim().slice(0, 120) })
  }
}

console.log(`scanned ${added} added lines under src/ against ${BASE}`)
if (hits.length === 0) { console.log('CLEAN: 0 em dashes, 0 banned words'); process.exit(0) }
console.log(`\n${hits.length} HITS:`)
for (const h of hits) console.log(` ${h.kind.padEnd(18)} ${h.file}\n   ${h.text}`)
process.exit(1)
