// Shared stubs for the inbox-dm-draft research tests: Deno env, a proxy answer, an Apify item, a config-reading db.
export const denoEnv = { RAILWAY_CLAUDE_URL: 'https://proxy.test', RAILWAY_CLAUDE_API_KEY: 'proxy-key' } as Record<string, string>
;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => denoEnv[k] } }
export const claude = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }] }))
export const apify = (items: unknown[]) => new Response(JSON.stringify(items))
export const item = (first: string, last: string, slug: string, jobs: [string, string, boolean][]) => ({
  id: `ACoA-${slug}`, publicIdentifier: slug, firstName: first, lastName: last, headline: `${jobs[0]?.[1]} at ${jobs[0]?.[0]}`,
  experience: jobs.map(([companyName, position, current]) => ({ companyName, position, endDate: current ? { text: 'Present' } : { text: '2020' } })),
})
export const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: 'apify-token' } }) }) }) }) }
