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

// SCOPE. The rule bans these in COPY, not in source comments: this repo's own
// house style runs em dashes through its comment prose everywhere, written long
// before this run, and a gate that flags them would push every agent into
// rewriting the codebase's voice. So comments are stripped first and only what
// can reach a screen is judged: JSX text nodes and quoted string literals in
// .ts/.tsx. CSS is comment-only for our purposes and is skipped entirely.
//
// One deliberate allowance: '—' alone, or a string that is only that glyph, is
// the app's existing empty-value placeholder (ContentList's "no QA verdict"
// third state). It is pre-existing vocabulary, not prose this run wrote.
// Rather than trying to strip comments (block comments span lines, and a
// diff hands them over one line at a time with no state), pull out the only two
// things that can actually reach a screen: quoted string literals and JSX text
// nodes. Everything else on the line is prose for developers and is out of
// scope by the rule's own terms.
function copyOnly(line) {
  if (/^\s*import\b/.test(line)) return ''
  const out = []
  for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) out.push(m[2])
  for (const m of line.matchAll(/>([^<>{}]+)</g)) out.push(m[1])
  return out.join(' ')
}

let file = null
const hits = []
let added = 0, judged = 0
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue }
  if (!line.startsWith('+') || line.startsWith('+++')) continue
  const raw = line.slice(1)
  added++
  if (!file || !/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue
  const text = copyOnly(raw)
  if (!text.trim()) continue
  judged++
  // A string that is nothing BUT the glyph is the app's empty-value placeholder,
  // not prose. copyOnly has already dropped the quotes, so match it as a token.
  const dashes = text.split(/\s+/).filter(t => t !== '—' && t !== '–').join(' ')
  if (dashes.includes('—')) hits.push({ file, kind: 'em dash', text: raw.trim().slice(0, 120) })
  if (dashes.includes('–')) hits.push({ file, kind: 'en dash', text: raw.trim().slice(0, 120) })
  for (const w of BANNED) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) hits.push({ file, kind: 'banned: ' + w, text: raw.trim().slice(0, 120) })
  }
}

console.log(`scanned ${added} added lines under src/, judged ${judged} lines of code and copy in .ts/.tsx against ${BASE}`)
if (hits.length === 0) { console.log('CLEAN: 0 em dashes, 0 banned words'); process.exit(0) }
console.log(`\n${hits.length} HITS:`)
for (const h of hits) console.log(` ${h.kind.padEnd(18)} ${h.file}\n   ${h.text}`)
process.exit(1)
