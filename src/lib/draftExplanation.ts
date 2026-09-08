function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((s): s is string => s !== null) : []
}

// This is an explicit display projection. Raw reasoning, operator notes, query
// details and snippets never become fallback copy, even on older rows.
export function normalizeDraftExplanation(value: unknown) {
  const evidence = object(value)
  const brief = object(evidence.brief)
  const sources: { title: string; url: string }[] = []
  const seen = new Set<string>()
  for (const research of Array.isArray(evidence.research) ? evidence.research : []) {
    const hits = object(research).hits
    for (const hit of Array.isArray(hits) ? hits : []) {
      const source = object(hit)
      const href = text(source.url)
      if (!href) continue
      try {
        const url = new URL(href)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue
        seen.add(url.href)
        sources.push({ title: text(source.title) ?? url.hostname, url: url.href })
      } catch { /* A malformed citation must not break the draft. */ }
    }
  }
  return {
    theyMean: text(brief.they_mean), move: text(brief.the_move), limits: text(brief.limits_to_name),
    unresolved: texts(brief.unresolved), facts: texts(evidence.facts), sources,
    // Preserve the exact body, including whitespace, for per-leg edit detection.
    generatedText: typeof evidence.generated_text === 'string' && evidence.generated_text.length
      ? evidence.generated_text : null,
  }
}

export function draftExplanationFreshness(generatedText: string | null, savedText: string, displayedText: string) {
  if (displayedText !== savedText || (generatedText !== null && generatedText !== savedText)) return 'edited'
  return generatedText === null ? 'unknown' : 'original'
}
