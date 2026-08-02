// One collapsed row per tool call: glyph, tool name, one-line preview of the
// argument that identifies it. Ported from the reference's tool-summaries.ts as
// plain data (a map is not a dependency), with the reference's output panel cut —
// Railway's stream-json only forwards `tool_use` blocks on the /chat/stream path,
// never `tool_result`, so there is nothing honest to put in one (spec §2.5).

export type ToolSummary = { icon: string; label: string; preview: string }

const ICONS: Record<string, string> = {
  Read: '▤', Edit: '✎', Write: '✎', MultiEdit: '✎', NotebookEdit: '✎',
  Bash: '›', Glob: '⌕', Grep: '⌕', WebFetch: '↗', WebSearch: '⌕',
  Task: '◈', TodoWrite: '☑',
}

function str(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

// Absolute paths eat the whole row and the useful half is on the right.
export function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length <= 2 ? p : parts.slice(-2).join('/')
}

function firstLine(s: string, max = 90): string {
  const one = s.split('\n')[0].trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export function summarizeTool(tool: string, input: unknown): ToolSummary {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const icon = ICONS[tool] ?? '·'
  const path = str(o.file_path) || str(o.path) || str(o.notebook_path)
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { icon, label: tool, preview: path ? shortPath(path) : '—' }
    case 'Bash':
      return { icon, label: 'Bash', preview: firstLine(str(o.description) || str(o.command)) || '—' }
    case 'Glob':
      return { icon, label: 'Glob', preview: str(o.pattern) || '—' }
    case 'Grep': {
      const pat = str(o.pattern)
      const where = str(o.glob) || str(o.path)
      return { icon, label: 'Grep', preview: where ? `${pat} · ${shortPath(where)}` : pat || '—' }
    }
    case 'WebFetch':
      return { icon, label: 'Fetch', preview: str(o.url) || '—' }
    case 'WebSearch':
      return { icon, label: 'Search', preview: str(o.query) || '—' }
    case 'Task':
      return { icon, label: 'Agent', preview: firstLine(str(o.description)) || '—' }
    case 'TodoWrite': {
      const todos = Array.isArray(o.todos) ? o.todos.length : 0
      return { icon, label: 'Todos', preview: todos ? `${todos} item${todos === 1 ? '' : 's'}` : '—' }
    }
    default:
      return { icon, label: tool, preview: firstLine(JSON.stringify(input ?? null) ?? '') || '—' }
  }
}

// Consecutive calls to the same tool collapse into one strip. A burst of nine
// Reads is one fact ("it read nine files"), not nine facts, and the reference
// built ToolGroup for exactly this.
export type ToolRun = { tool: string; ids: string[] }

export function groupRuns(calls: { id: string; tool: string }[]): ToolRun[] {
  const out: ToolRun[] = []
  for (const c of calls) {
    const last = out[out.length - 1]
    if (last && last.tool === c.tool) last.ids.push(c.id)
    else out.push({ tool: c.tool, ids: [c.id] })
  }
  return out
}

// Pretty-print for the expanded row. JSON.stringify with two spaces is exactly
// what the reference does; there is no formatter dependency here either.
export function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input ?? null, null, 2)
  } catch {
    return String(input)
  }
}
