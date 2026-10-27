import { describe, expect, it } from 'vitest'
import { replyAllCc } from './inbox'

describe('replyAllCc', () => {
  it('keeps the colleagues Lou Fasulo put on To and drops our own mailbox', () => {
    expect(replyAllCc([['davorin@madebyarch.com', 'margaret@starform.co', 'jesse@starform.co'], []], 'lou@starform.co'))
      .toEqual(['margaret@starform.co', 'jesse@starform.co'])
  })
  it('drops the reply recipient, duplicates, Ivan and invalid entries, and reads display-name forms', () => {
    expect(replyAllCc([['"Lou" <LOU@starform.co>', 'im@ivanmanfredi.com', 'not-an-address'], 'A <a@x.io>, a@x.io'], 'lou@starform.co'))
      .toEqual(['a@x.io'])
  })
  it('is empty when nobody else is on the thread', () => {
    expect(replyAllCc([null, undefined, []], 'lou@starform.co')).toEqual([])
  })
})
