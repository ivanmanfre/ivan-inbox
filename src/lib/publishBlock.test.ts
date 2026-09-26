import { describe, expect, it } from 'vitest'
import {
  applyPublishBlocks, publishBlockReason, publishBlocksByDraft, publishStoppedLine, queueErrorText,
} from './publishBlock'
import { groupByStage, type ContentDraft, type ScheduledQueueRow } from './content'

const DRAFT = '9380f88b-c80f-56d0-bce5-85806c5ab647'

const q = (over: Partial<ScheduledQueueRow> = {}): ScheduledQueueRow => ({
  id: 'q1', clickup_task_id: DRAFT, post_text: 'x', scheduled_at: '2026-09-08T08:45:00+00:00',
  posted_at: null, status: 'blocked', platform: 'linkedin', is_repost: false,
  error_message: 'publish_lint_fail: stacked_declarations', created_at: '2026-09-07T23:10:00Z',
  post_kind: 'reach', unipile_share_url: null, ...over,
})

const d = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: DRAFT, client_id: null, status: 'scheduled', scheduled_at: '2026-09-08T08:45:00+00:00',
  source_post_id: null, published_at: null,
  ...over,
} as ContentDraft)

describe('publish blocks: the Sep 8 post', () => {
  it('turns the lint code into words, never the raw code', () => {
    const r = publishBlockReason('publish_lint_fail: stacked_declarations')
    expect(r).toBe('the lint flagged stacked short declarations')
    expect(publishStoppedLine(r)).toBe('Publishing stopped: the lint flagged stacked short declarations.')
    expect(publishBlockReason('publish_lint_fail: stacked_declarations, elliptical_contrast'))
      .toBe('the lint flagged stacked short declarations and elliptical contrast')
    expect(publishBlockReason('publish_lint_fail: some_new_rule')).not.toContain('_')
  })

  it('maps the blocked queue row to its draft, and skips posted or live rows', () => {
    expect(publishBlocksByDraft([q()]).get(DRAFT)).toBe('the lint flagged stacked short declarations')
    expect(publishBlocksByDraft([q({ status: 'pending', error_message: null })]).size).toBe(0)
    expect(publishBlocksByDraft([q({ posted_at: '2026-09-08T09:00:00Z' })]).size).toBe(0)
    expect(publishBlocksByDraft([q({ clickup_task_id: '86agzh915' })]).size).toBe(0)
  })

  it('re-files the stopped draft under Errors so the tab counts it', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    const base = groupByStage([d()], now)
    expect(base.stuck).toHaveLength(1)
    const out = applyPublishBlocks(base, publishBlocksByDraft([q()]))
    expect(out.error.map(r => r.id)).toEqual([DRAFT])
    expect(out.stuck).toHaveLength(0)
  })

  it('leaves a published post alone', () => {
    const out = applyPublishBlocks(
      groupByStage([d({ status: 'published', published_at: '2026-09-08T09:00:00Z' })]),
      publishBlocksByDraft([q()]))
    expect(out.error).toHaveLength(0)
    expect(out.published).toHaveLength(1)
  })

  it('humanises the queue strip line and leaves written sentences alone', () => {
    expect(queueErrorText(q())).toBe('Publishing stopped: the lint flagged stacked short declarations.')
    expect(queueErrorText(q({ status: 'posted', error_message: 'deleted by Ivan’s call' })))
      .toBe('deleted by Ivan’s call')
  })
})
