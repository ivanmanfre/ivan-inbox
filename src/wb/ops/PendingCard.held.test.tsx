/* ==========================================================================
   A comment the gate accepted but HELD (2026-09-23).

   The volume lane's gate answers "approved: <name> - held in the queue, the
   volume lane is still switched off" when its kill switch is off. The card read
   that as a plain approve and Ivan took the held comments for posted ones. A
   held accept renders amber with its own label and the gate's sentence under
   it, and offers no second approve; a plain accept keeps the card as it was.
   ========================================================================== */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PendingCard } from './PendingCard'
import { classifyGateReply, GATE_HELD_LABEL, type GateVerdict, type OpsDraft } from '../../lib/ops'

const HELD_REPLY = 'approved: zoë hartsfield 👻 - held in the queue, the volume lane is still switched off (volume_auto_commenting).'

const outbound: OpsDraft = {
  id: 'vol-1', client_id: 'ivan', kind: 'comment_outbound', slack_channel: '',
  body: 'so true', created_at: '2026-09-22T13:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
  context: {
    lane: 'volume', feed_id: 'feed-1', target_name: 'zoë hartsfield',
    approve_url: 'https://n8n.example.test/webhook/volume-gate?id=feed-1',
    skip_url: 'https://n8n.example.test/webhook/volume-gate?id=feed-1&skip=1',
  },
}

const render = (held?: GateVerdict) =>
  renderToStaticMarkup(<PendingCard draft={outbound} refresh={() => {}} held={held} />)

describe('PendingCard — a held accept is not a success', () => {
  it('shows the amber held state with the gate sentence, and no second approve', () => {
    const v = classifyGateReply(HELD_REPLY)
    const html = render(v)
    expect(html).toContain(GATE_HELD_LABEL)
    expect(html).toMatch(/data-tone="attention"[^]*Approved · held — lane is switched off/)
    expect(html).toContain('held in the queue, the volume lane is still switched off')
    expect(html).not.toContain('data-tone="clear"')
    expect(html).not.toContain('Approve &amp; queue')
  })

  it('leaves a plain accept and the untouched card exactly as they were', () => {
    const plain = classifyGateReply('approved: Loretta Brooks - it will drain with the rest, 4 min apart, inside 13-21 UTC.')
    expect(plain.held).toBeFalsy()
    const html = render(plain.held ? plain : undefined)
    expect(html).not.toContain('held — lane is switched off')
    expect(html).toContain('Approve &amp; queue')
    expect(render()).toBe(html)
  })
})
