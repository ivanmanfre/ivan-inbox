import { describe, expect, it } from 'vitest'
import { formatInput, groupRuns, shortPath, summarizeTool } from './toolSummaries'

describe('summarizeTool', () => {
  it('identifies a file tool by its tail path, not its absolute one', () => {
    expect(summarizeTool('Read', { file_path: '/Users/x/Desktop/ivan-inbox/src/hooks/useInbox.ts' }))
      .toEqual({ icon: '▤', label: 'Read', preview: 'hooks/useInbox.ts' })
    expect(shortPath('a.ts')).toBe('a.ts')
    expect(shortPath('src/a.ts')).toBe('src/a.ts')
  })

  it('prefers a bash description over the raw command', () => {
    expect(summarizeTool('Bash', { command: 'npm run build', description: 'Build the app' }).preview)
      .toBe('Build the app')
    expect(summarizeTool('Bash', { command: 'ls -la' }).preview).toBe('ls -la')
  })

  it('shows grep pattern plus where it looked', () => {
    expect(summarizeTool('Grep', { pattern: 'channel(', glob: 'src/**/*.ts' }).preview)
      .toBe('channel( · **/*.ts')
  })

  it('never renders an empty row', () => {
    for (const tool of ['Read', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite']) {
      expect(summarizeTool(tool, {}).preview).toBe('—')
    }
  })

  it('degrades a tool it has never heard of instead of throwing', () => {
    const s = summarizeTool('SomeNewTool', { a: 1 })
    expect(s.label).toBe('SomeNewTool')
    expect(s.icon).toBe('·')
    expect(s.preview).toContain('"a"')
  })

  it('truncates a multi-line command to one line', () => {
    const s = summarizeTool('Bash', { command: 'line one\nline two' })
    expect(s.preview).toBe('line one')
  })
})

describe('groupRuns', () => {
  it('collapses consecutive calls to the same tool', () => {
    const runs = groupRuns([
      { id: '0:0', tool: 'Read' }, { id: '1:0', tool: 'Read' },
      { id: '2:0', tool: 'Edit' }, { id: '3:0', tool: 'Read' },
    ])
    expect(runs).toEqual([
      { tool: 'Read', ids: ['0:0', '1:0'] },
      { tool: 'Edit', ids: ['2:0'] },
      { tool: 'Read', ids: ['3:0'] },
    ])
  })

  it('is empty for no calls', () => {
    expect(groupRuns([])).toEqual([])
  })
})

describe('formatInput', () => {
  it('pretty-prints and survives a value it cannot stringify', () => {
    expect(formatInput({ a: 1 })).toBe('{\n  "a": 1\n}')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => formatInput(circular)).not.toThrow()
  })
})
