/** Join class names; falsy parts drop out. The only helper the primitives share. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** The tones the system knows. Severity tones are LIVE SIGNALS ONLY. */
export type Tone = 'neutral' | 'quiet' | 'accent' | 'clear' | 'attention' | 'urgent'
/** The three densities, expressed as attributes on the document root. */
export type Density = 'phone' | 'comfortable' | 'compact'
