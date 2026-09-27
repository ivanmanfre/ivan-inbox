// Warsaw is Ivan's clock. Every time the frame prints is Warsaw time, labelled.
const TZ = 'Europe/Warsaw'

const DOW = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })
// en-US month names ('Sep', never ICU's newer en-GB 'Sept'), day first by hand.
const DAYN = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric' })
const MON = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short' })
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

const d = (t: string | number | Date) => (t instanceof Date ? t : new Date(t))

/** 'Sun' */
export const warsawDow = (t: string | number | Date) => DOW.format(d(t))
/** '27 Sep' */
export const warsawDm = (t: string | number | Date) => `${DAYN.format(d(t))} ${MON.format(d(t))}`
/** '10:50' */
export const warsawHm = (t: string | number | Date) => HM.format(d(t))
/** '2026-09-27', for same-day tests */
export const warsawDay = (t: string | number | Date) => DAY.format(d(t))
/** 'Sun 27 Sep, 10:50' */
export const warsawDayTime = (t: string | number | Date) => `${warsawDow(t)} ${warsawDm(t)}, ${warsawHm(t)}`
/** 'Today' / 'Yesterday' / 'Fri 25 Sep' */
export function warsawDayWord(t: string | number | Date, now: number = Date.now()): string {
  const k = warsawDay(t)
  if (k === warsawDay(now)) return 'Today'
  if (k === warsawDay(now - 86_400_000)) return 'Yesterday'
  return `${warsawDow(t)} ${warsawDm(t)}`
}
