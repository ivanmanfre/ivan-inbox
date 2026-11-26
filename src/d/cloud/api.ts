// The cloud jobs page's network: owner-RLS reads of desk_t3_jobs (origin inbox|reply), the two
// operator RPCs that create a job or a reply (db/20261126p), and the live row feed.
import { supabase } from '../../lib/supabase'
import { JOB_COLS, type CloudJob } from './model'

export async function listCloudJobs(): Promise<CloudJob[]> {
  const { data, error } = await supabase.from('desk_t3_jobs').select(JOB_COLS)
    .in('origin', ['inbox', 'reply']).order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  return (data ?? []) as unknown as CloudJob[]
}

type RpcAnswer = { ok: boolean; job_id?: string; root_job_id?: string; error?: string }

async function call(fn: string, args: Record<string, unknown>): Promise<RpcAnswer> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { ok: false, error: 'network' }
  const d = data as RpcAnswer | null
  return d && typeof d.ok === 'boolean' ? d : { ok: false, error: 'network' }
}

export function startCloudJob(text: string, context: Record<string, unknown> = {}): Promise<RpcAnswer> {
  return call('cloud_job_create', { p_title: '', p_brief: text, p_context: { source: 'inbox', ...context } })
}

/** `clientKey` makes a retry of the same reply return the job it already made (db/20261126p). */
export function replyCloudJob(parentId: string, text: string, clientKey: string): Promise<RpcAnswer> {
  return call('cloud_job_reply', { p_parent: parentId, p_text: text, p_client_key: clientKey })
}

/** Every insert or update of this user's cloud jobs. Returns the unsubscribe. */
export function subscribeCloud(userId: string, on: { row: (j: CloudJob) => void; resubscribed: () => void }): () => void {
  let first = true
  const ch = supabase.channel(`cloud-jobs-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'desk_t3_jobs', filter: `user_id=eq.${userId}` }, p => {
      const row = (p as unknown as { new?: CloudJob }).new
      if (row && row.id && (row.origin === 'inbox' || row.origin === 'reply')) on.row(row)
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') { if (!first) on.resubscribed(); first = false }
    })
  return () => { void supabase.removeChannel(ch) }
}
