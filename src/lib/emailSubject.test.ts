import { expect, it } from 'vitest'
import { emailDraftText, splitEmailDraft } from './emailSubject'

it('separates a stored Subject line while preserving the exact body', () => {
  expect(splitEmailDraft('Subject: A useful introduction\r\n\r\nHi Mathew,\n\nExact words.\n')).toEqual({ subject: 'A useful introduction', body: 'Hi Mathew,\n\nExact words.\n' })
  expect(splitEmailDraft('Subject: Introduction\nHi Mathew')).toEqual({ subject: 'Introduction', body: 'Hi Mathew' })
  expect(splitEmailDraft('  **Subject: Introduction**\n\nHi Mathew')).toEqual({ subject: 'Introduction', body: 'Hi Mathew' })
})

it('keeps an email with no explicit subject intact until a subject is supplied', () => {
  expect(splitEmailDraft('Hi Mathew,\n\nExact words.\n')).toEqual({ subject: '', body: 'Hi Mathew,\n\nExact words.\n' })
  expect(emailDraftText('', 'Hi Mathew,\n\nExact words.\n')).toBe('Hi Mathew,\n\nExact words.\n')
  expect(emailDraftText('Introduction', 'Hi Mathew,\n\nExact words.\n')).toBe('Subject: Introduction\n\nHi Mathew,\n\nExact words.\n')
})

it('rejects header injection rather than treating CR/LF as part of the subject', () => {
  expect(() => emailDraftText('Introduction\nBcc: another@example.com', 'Body')).toThrow(/one line/i)
  expect(() => emailDraftText('Introduction\rBcc: another@example.com', 'Body')).toThrow(/one line/i)
})
