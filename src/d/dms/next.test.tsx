// @vitest-environment jsdom
// Step 8 (#9): the next Needs you thread after an action on the open one, and the bubble editor (#16),
// and rows that show their last message with our draft dimmed under it (#17).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SEATS, type Seat } from '../seats'
import { NOW, drafted, owedNoDraft, threads, waiting } from './fixtures'
import { seatView } from './model'
import { nextNeedsYou } from './next'
import { BubbleEdit, joinBubbles, splitBubbles } from './Draft'
import { DraftRow, type RowCtx } from './threadRows'

afterEach(cleanup)

const rows = [
  ...drafted('a1', { client_id: 'ivan', prospect_name: 'Ana Ruiz' }, 3),
  ...drafted('a2', { client_id: 'ivan', prospect_name: 'Ben Ode' }, 5),
  ...owedNoDraft('a3', { client_id: 'ivan', prospect_name: 'Cal Ma' }, 30),
  ...waiting('a4', { client_id: 'ivan', prospect_name: 'Dee Waits' }),
  ...drafted('r1', { client_id: 'risedtc', prospect_name: 'Rae Rise' }, 4),
]
const all = threads(rows)
const views = Object.fromEntries(SEATS.map(s => [s, seatView(all, s, NOW)])) as Record<Seat, ReturnType<typeof seatView>>
const t = (pid: string) => all.find(x => x.prospect_id === pid)!

describe('next Needs you thread', () => {
  it('takes the row after this one on the same seat, then wraps to the top', () => {
    const order = [...views.ivan.drafted, ...views.ivan.nodraft].map(x => x.prospect_id)
    const after = order[order.indexOf('a1') + 1]
    expect(nextNeedsYou(views, t('a1'))?.prospect_id).toBe(after)
    expect(nextNeedsYou(views, t(order.at(-1)!))?.prospect_id).toBe(order[0])
  })
  it('never picks a thread that waits on them, and moves to the next seat when this one is done', () => {
    const only = threads([...drafted('a1', { client_id: 'ivan' }, 3), ...waiting('a4', { client_id: 'ivan' }), ...drafted('r1', { client_id: 'risedtc', prospect_name: 'Rae Rise' }, 4)])
    const v = Object.fromEntries(SEATS.map(s => [s, seatView(only, s, NOW)])) as Record<Seat, ReturnType<typeof seatView>>
    expect(nextNeedsYou(v, only.find(x => x.prospect_id === 'a1')!)?.prospect_name).toBe('Rae Rise')
  })
  it('after the open row left the list (a verb patched it), the next is still the row after its old place', () => {
    const order = [...views.ivan.drafted, ...views.ivan.nodraft].map(x => x.prospect_id)
    const mid = order[1]
    const gone = threads(rows.filter(m => m.prospect_id !== mid))
    const v = Object.fromEntries(SEATS.map(s => [s, seatView(gone, s, NOW)])) as Record<Seat, ReturnType<typeof seatView>>
    expect(nextNeedsYou(v, t(mid), order)?.prospect_id).toBe(order[2])
  })
  it('returns null when nothing else needs him', () => {
    const one = threads(drafted('a1', { client_id: 'ivan' }, 3))
    const v = Object.fromEntries(SEATS.map(s => [s, seatView(one, s, NOW)])) as Record<Seat, ReturnType<typeof seatView>>
    expect(nextNeedsYou(v, one[0])).toBeNull()
  })
})

describe('bubble editor', () => {
  it('splits on the --- lines and joins back to the same text', () => {
    for (const x of ['a\n---\nb', 'a\n\n---\n\nb\n---\nc', 'one bubble', 'a\n---\n\n---\nc', 'a\n---\n---\nb', 'a\n ----- \nb']) expect(joinBubbles(splitBubbles(x))).toBe(x)
    expect(splitBubbles('Nice one\n---\nHere u go: link\n---\nHave a look').parts).toEqual(['Nice one', 'Here u go: link', 'Have a look'])
  })
  it('draws one box per bubble; ✕ removes that bubble and keeps the rest verbatim', () => {
    const onChange = vi.fn()
    render(<BubbleEdit value={'Nice one Petros\n---\nHere u go: link\n---\nHave a look'} onChange={onChange} label="The draft" max={240} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove bubble 1' }))
    expect(onChange).toHaveBeenCalledWith('Here u go: link\n---\nHave a look')
    fireEvent.change(screen.getByLabelText('The draft, bubble 3'), { target: { value: 'Have a look :)' } })
    expect(onChange).toHaveBeenLastCalledWith('Nice one Petros\n---\nHere u go: link\n---\nHave a look :)')
  })
  it('an edit to one bubble keeps every other separator as written', () => {
    const onChange = vi.fn()
    render(<BubbleEdit value={'a\n ----- \nb\n---\nc'} onChange={onChange} label="The draft" max={240} />)
    fireEvent.change(screen.getByLabelText('The draft, bubble 3'), { target: { value: 'c!' } })
    expect(onChange).toHaveBeenLastCalledWith('a\n ----- \nb\n---\nc!')
    fireEvent.click(screen.getByRole('button', { name: 'Remove bubble 2' }))
    expect(onChange).toHaveBeenLastCalledWith('a\n---\nc')
  })
  it('typing a --- line in a one-bubble draft keeps the caret in the editor, in the new bubble', () => {
    function Live() { const [v, setV] = useState('hello'); return <BubbleEdit value={v} onChange={setV} label="The draft" max={240} /> }
    render(<Live />)
    const box = screen.getByLabelText('The draft') as HTMLTextAreaElement
    box.focus()
    fireEvent.change(box, { target: { value: 'hello\n---\n' } })
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(document.activeElement).toBe(screen.getByLabelText('The draft, bubble 2'))
  })
  it('a one-bubble draft stays one box with no ✕', () => {
    render(<BubbleEdit value="Just one" onChange={() => {}} label="The draft" max={240} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Remove bubble/ })).toBeNull()
  })
})

describe('Needs you row', () => {
  const c = { selected: null, checked: new Set<string>(), open: () => {}, now: NOW, verbs: {} as RowCtx['verbs'], busy: null, setBusy: () => {}, fail: () => {},
    pre: { get: () => ({ s: 'idle' }) } as unknown as RowCtx['pre'], more: () => {}, v4: true } as RowCtx
  it('shows their last message first and our draft dimmed under it', () => {
    const { container } = render(<DraftRow t={t('a1')} c={c} />)
    const lines = [...container.querySelectorAll('.dm-s')].map(e => e.textContent)
    expect(lines[0]).toContain('Sounds good, tell me more about pricing?')
    expect(container.querySelector('.dx-sub')?.textContent).toBe('Draft: Happy to.')
  })
})
