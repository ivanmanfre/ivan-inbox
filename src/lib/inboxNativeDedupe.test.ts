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
