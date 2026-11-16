import { createHandler } from './handler.ts'
import { postgresSink } from './storage.ts'

// Deployment alone cannot enable ingestion: both this binding and the private
// database endpoint row must be explicitly enabled. No provider key is needed.
let binding: Record<string, unknown> = {}
try { binding = JSON.parse(Deno.env.get('UNIPILE_V2_SHADOW_BINDING') ?? '{}') } catch { /* Disabled. */ }
const handler = createHandler({
  enabled: binding?.enabled === true,
  endpointId: typeof binding?.endpointId === 'string' ? binding.endpointId : undefined,
  appId: typeof binding?.appId === 'string' ? binding.appId : undefined,
  accountId: typeof binding?.accountId === 'string' ? binding.accountId : undefined,
  production: typeof binding?.production === 'boolean' ? binding.production : undefined,
  secret: Deno.env.get('UNIPILE_V2_SHADOW_SECRET'),
}, { persist: postgresSink(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) })
Deno.serve(handler)
