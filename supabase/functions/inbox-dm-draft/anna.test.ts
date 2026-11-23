import { expect, it } from 'vitest'
import { ANNA_IDENTITY_INSTRUCTION, LEAH_AUTHOR, LEAH_IDENTITY_INSTRUCTION } from './anna'

it('uses Ivan’s reply wording without a third-person booking handoff', () => {
  expect(ANNA_IDENTITY_INSTRUCTION).toContain("Have a look, and if it sounds like we could give you a hand I'll demo how it works live :)")
  expect(ANNA_IDENTITY_INSTRUCTION).toContain('Never add a third-person booking handoff')
  expect(ANNA_IDENTITY_INSTRUCTION).not.toContain('never imply Anna runs or attends the call alone')
  expect(ANNA_IDENTITY_INSTRUCTION).toContain('Do not claim to be Ivan')
})

it('gives Leah the same Studio rules under her own name, with team demo wording', () => {
  expect(LEAH_AUTHOR).toBe('Leah McMichael')
  expect(LEAH_IDENTITY_INSTRUCTION).toContain('you are Leah McMichael')
  expect(LEAH_IDENTITY_INSTRUCTION).toContain("we'll demo how it works live :)")
  expect(LEAH_IDENTITY_INSTRUCTION).toContain('Do not claim to be Ivan')
  expect(LEAH_IDENTITY_INSTRUCTION).not.toContain('Anna')
  expect(LEAH_IDENTITY_INSTRUCTION.replaceAll('Leah McMichael', 'Anna Sol Manfredi').replaceAll("Leah's", "Anna's").replace("we'll demo", "I'll demo")).toBe(ANNA_IDENTITY_INSTRUCTION)
})
