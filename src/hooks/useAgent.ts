import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  ackAlert, ackReminder, fetchAlerts, fetchChat, fetchDailySummaries, fetchReminders, sendChat,
  type AgentAlert, type AgentMessage, type AgentReminder, type AgentSummary,
} from '../lib/agent'

export function useAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [alerts, setAlerts] = useState<AgentAlert[]>([])
  const [reminders, setReminders] = useState<AgentReminder[]>([])
  const [summaries, setSummaries] = useState<AgentSummary[]>([])
  // Unacknowledged alerts older than the fetch window (lib/agent.ts
  // ALERT_WINDOW_DAYS). Surfaced as a count so a 60-day-old pipeline_stall
  // can't sit at the top of the screen pretending to be today's problem.
  const [olderUnsent, setOlderUnsent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // One channel per mount, per the useOps rule: supabase.channel() returns the
  // EXISTING channel for a topic it already holds, so a second useAgent() on
  // screen would bind postgres_changes twice on one channel, throw inside the
  // effect and blank the tree — and either unmount would rip realtime out from
  // under the other (754d32d).
  const topic = `n8nclaw:${useId()}`

  const refresh = useCallback(() => {
    Promise.all([fetchChat(), fetchAlerts(), fetchReminders(), fetchDailySummaries()])
      .then(([msgs, al, rem, sum]) => {
        setMessages(msgs)
        setAlerts(al.alerts)
        setOlderUnsent(al.olderUnsent)
        setReminders(rem)
        setSummaries(sum)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'agent unavailable')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    refresh()
    // Both tables on ONE channel: chat because a WhatsApp reply must land on
    // screen without a pull, alerts because an unacknowledged one is the badge.
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'n8nclaw_chat_messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'n8nclaw_proactive_alerts' }, refresh)
      .subscribe()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [refresh, topic])

  // Send throws on failure and the caller shows it. There is no webhook
  // fallback here on purpose — see the comment on sendChat in lib/agent.ts.
  const send = useCallback(async (text: string) => {
    await sendChat(text)
    refresh()
  }, [refresh])

  const acknowledgeAlert = useCallback(async (id: string) => {
    await ackAlert(id)
    refresh()
  }, [refresh])

  const completeReminder = useCallback(async (id: number, status = 'completed') => {
    await ackReminder(id, status)
    refresh()
  }, [refresh])

  return {
    messages, alerts, olderUnsent, reminders, summaries, loading, error,
    refresh, send, acknowledgeAlert, completeReminder,
  }
}
