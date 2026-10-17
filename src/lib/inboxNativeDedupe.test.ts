import { expect, it } from 'vitest'
import { dedupeMessages } from './inbox'
import { msg } from '../d/dms/fixtures'

it('shows one native InMail when the sync also mirrors its body as a DM', () => {
  const sent = msg({ id: 'sent', prospect_id: 'alicia', channel: 'linkedin_inmail', message_type: 'inmail', ai_model: 'arch_referral_package_v1', unipile_message_id: 'native-id', unipile_chat_id: 'chat', sent_at: '2026-10-12T07:38:53Z', message_text: 'Subject: Intro\n\nHello Alicia' })
  const mirror = msg({ ...sent, id: 'mirror', channel: 'linkedin', message_type: 'dm', ai_model: 'manual_mirror', message_text: 'Hello Alicia' })
  expect(dedupeMessages([sent, mirror])).toEqual([sent])
  expect(dedupeMessages([mirror, sent])).toEqual([sent])
  const viewSent = { ...sent, unipile_message_id: undefined }
  const viewMirror = { ...mirror, unipile_message_id: undefined }
  expect(dedupeMessages([viewMirror, viewSent])).toEqual([viewSent])
})

it('keeps different native messages and separate prospect histories', () => {
  const first = msg({ prospect_id: 'alicia', unipile_message_id: 'one', sent_at: '2026-10-12T07:00:00Z' })
  const second = msg({ ...first, id: 'second', unipile_message_id: 'two', sent_at: '2026-10-12T07:01:00Z' })
  const other = msg({ ...first, id: 'other', prospect_id: 'another' })
  expect(dedupeMessages([first, second, other])).toEqual([first, second, other])
})

it('shows Dinos’s split reply once when LinkedIn sync mirrors an individual bubble', () => {
  const sent = msg({ id: 'reply', prospect_id: 'dinos', message_type: 'manual_reply', unipile_chat_id: 'dinos-chat', sent_at: '2026-10-17T00:02:32.508Z', message_text: 'Sounds good! Does 2PM EDT Tuesday work well? \n---\nI’ll send you the invite via email' })
  const mirror = msg({ ...sent, id: 'mirror', message_type: 'dm', ai_model: 'manual_mirror', unipile_message_id: 'J8KyNE90VRKtt2xyFVBS1w', sent_at: '2026-10-17T00:02:38.697Z', message_text: 'Sounds good! Does 2PM EDT Tuesday work well?' })
  expect(dedupeMessages([sent, mirror])).toEqual([sent])
  expect(dedupeMessages([mirror, sent])).toEqual([sent])
})

it('matches all delivered scan bubbles despite sync timestamp and whitespace differences', () => {
  const sent = msg({ id: 'scan', prospect_id: 'dinos', unipile_chat_id: 'chat', unipile_message_id: 'first', sent_at: '2026-08-18T19:04:42.262Z', message_text: 'Incoming: https://resources.risedtc.com/scan/paleonola-3d\n\nIt’s mostly the paid and profit side.\n---\nWe run paid and creative.\n---\nbtw with the brands that qualify' })
  const mirrors = ['Incoming: https://resources.risedtc.com/scan/paleonola-3d\r\n\r\nIt’s mostly the paid and profit side.', 'We run paid and creative.', 'btw with the brands that qualify'].map((message_text, i) => msg({ ...sent, id: `mirror-${i}`, ai_model: 'manual_mirror', unipile_message_id: ['first', 'second', 'third'][i], message_text, sent_at: `2026-08-18T19:04:${44 + i * 6}Z` }))
  expect(dedupeMessages([...mirrors, sent])).toEqual([sent])
})

it('preserves actual manual replies outside the split send, other chats, and other channels', () => {
  const sent = msg({ id: 'reply', prospect_id: 'dinos', unipile_chat_id: 'chat', sent_at: '2026-10-17T00:02:32Z', message_text: 'Sounds good!\n---\nI’ll send you the invite via email' })
  const mirror = msg({ ...sent, id: 'manual', ai_model: 'manual_mirror', unipile_message_id: 'separate', message_text: 'Sounds good!', sent_at: '2026-10-17T00:05:32Z' })
  const otherChat = { ...mirror, id: 'other-chat', unipile_chat_id: 'different', sent_at: sent.sent_at }
  const otherProspect = { ...mirror, id: 'other-prospect', prospect_id: 'someone-else', sent_at: sent.sent_at }
  const email = { ...mirror, id: 'email', channel: 'email' as const, sent_at: sent.sent_at }
  const inbound = { ...mirror, id: 'inbound', direction: 'inbound' as const, sent_at: sent.sent_at }
  const different = { ...mirror, id: 'different', message_text: 'Sounds good! See you then', sent_at: sent.sent_at }
  for (const separate of [mirror, otherChat, otherProspect, email, inbound, different]) {
    expect(dedupeMessages([sent, separate])).toEqual([sent, separate])
  }
})

it('preserves a matching manual message sent before dispatch', () => {
  const sent = msg({ prospect_id: 'dinos', unipile_chat_id: 'chat', sent_at: '2026-10-17T00:02:32Z', message_text: 'Sounds good!\n---\nI’ll send the invite' })
  const earlier = msg({ ...sent, id: 'earlier', ai_model: 'manual_mirror', unipile_message_id: 'earlier-native', sent_at: '2026-10-17T00:01:32Z', message_text: 'Sounds good!' })
  expect(dedupeMessages([earlier, sent])).toEqual([earlier, sent])
})

it('preserves ambiguous identical manual sends rather than hiding both', () => {
  const sent = msg({ prospect_id: 'dinos', unipile_chat_id: 'chat', sent_at: '2026-10-17T00:02:32Z', message_text: 'Sounds good!\n---\nI’ll send the invite' })
  const mirror = msg({ ...sent, id: 'mirror', ai_model: 'manual_mirror', unipile_message_id: 'native-one', sent_at: '2026-10-17T00:02:38Z', message_text: 'Sounds good!' })
  const manual = { ...mirror, id: 'manual', unipile_message_id: 'native-two', sent_at: '2026-10-17T00:03:32Z' }
  expect(dedupeMessages([sent, mirror, manual])).toEqual([sent, mirror, manual])
})
