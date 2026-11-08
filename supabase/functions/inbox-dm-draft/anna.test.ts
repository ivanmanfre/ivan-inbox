import { expect, it } from 'vitest'
import { ANNA_IDENTITY_INSTRUCTION } from './anna'

it('uses Ivan’s reply wording without a third-person booking handoff', () => {
  expect(ANNA_IDENTITY_INSTRUCTION).toContain("Have a look, and if it sounds like we could give you a hand I'll demo how it works live :)")
  expect(ANNA_IDENTITY_INSTRUCTION).toContain('Never add a third-person booking handoff')
  expect(ANNA_IDENTITY_INSTRUCTION).not.toContain('never imply Anna runs or attends the call alone')
  expect(ANNA_IDENTITY_INSTRUCTION).toContain('Do not claim to be Ivan')
})
