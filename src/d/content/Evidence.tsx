import { useState } from 'react'
import {
  groupLogByAgent, normalizeAgentLog, normalizeQa, normalizeSourceDetail, taxonomyFields,
  type ContentDraftDetail,
} from '../../lib/content'
import { warsawDayTime } from '../ui/time'

// The evidence under the post, one tab at a time: QA (the rubric's scores and
// the first issue), Source (the call quote), Log (agents, newest last), Fields.
// A tab whose content the row does not carry says so; it is never hidden.
export function qaScores(feedback: string | null): [string, number][] {
  const out: [string, number][] = []
  const re = /^\s*([A-Z][A-Z_ ]+):\s*(\d+)\s*\/\s*10/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(feedback ?? ''))) out.push([m[1].replace(/_/g, ' ').trim(), Number(m[2])])
  return out
}

export function qaIssues(feedback: string | null): string[] {
  const f = feedback ?? ''
  const i = f.indexOf('Issues:')
  if (i < 0) return []
  return f.slice(i + 7).split('\n').map(x => x.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean)
}

const VERDICT: Record<string, string> = { PASS: 'Pass', QA_FAILED_HAND_REVIEW: 'Hand review', REVIEW: 'Review', FAIL: 'Fail' }
export const verdictWord = (v: string | null | undefined) => (v ? VERDICT[v] ?? v.toLowerCase().replace(/_/g, ' ') : 'none')

type Tab = 'qa' | 'src' | 'log' | 'meta'

export function Evidence({ d, initial = 'qa' }: { d: ContentDraftDetail; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial)
  const qa = normalizeQa(d.qa)
  const src = normalizeSourceDetail(d.source_detail)
  const log = normalizeAgentLog(d.agent_log)
  const agents = groupLogByAgent(log).length
  const tax = taxonomyFields(d.taxonomy)
  const scores = qaScores(qa?.feedback ?? null)
  const issues = qaIssues(qa?.feedback ?? null)
  const tabs: [Tab, string, string][] = [
    ['qa', 'QA', qa?.score != null ? `${verdictWord(qa.verdict)} ${qa.score}` : 'none'],
    ['src', 'Source', src?.kind ?? d.source_label ?? ''],
    ['log', 'Log', `${agents} agents`],
    ['meta', 'Fields', ''],
  ]
  return (
    <div className="cn-ev">
      <div className="cn-evh" role="tablist">
        {tabs.map(([k, t, tail]) => (
          <button key={k} type="button" role="tab" aria-selected={k === tab} className={k === tab ? 'cn-on' : ''} onClick={() => setTab(k)}>
            {t}{tail && <em>{tail}</em>}
          </button>
        ))}
      </div>
      <div className="cn-evb" role="tabpanel">
        {tab === 'qa' && (qa ? (
          <>
            {scores.length > 0 ? (
              <div className="cn-qa">
                {scores.map(([k, v]) => (
                  <div key={k}>
                    <small title={k}>{k}</small>
                    <span className="cn-bar" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < v ? (v <= 4 ? 'cn-on cn-lo' : 'cn-on') : ''} />)}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
            ) : <p className="cn-dim">QA scored {qa.score ?? 'nothing'} and left no per-rule scores on this row.</p>}
            {issues[0] && <p className="cn-iss"><small>First issue, of {issues.length}</small>{issues[0]}</p>}
          </>
        ) : <p>QA has not read this draft.</p>)}
        {tab === 'src' && (src ? (
          <>
            <p className="cn-dim">{[src.label ?? d.source_label, src.callTitle].filter(Boolean).join(' · ')}</p>
            {src.quote && <blockquote className="cn-quote">{src.quote}</blockquote>}
            {src.text && <p>{src.text}</p>}
            {src.holds.map((h, i) => <p key={i} className="cn-hr">{h}</p>)}
          </>
        ) : <p>{d.source_label ? `Source: ${d.source_label}. No quote on this row.` : 'This row carries no source.'}</p>)}
        {tab === 'log' && (log.length ? (
          <div className="cn-log"><ul>
            {log.slice(-40).map((e, i) => (
              <li key={i}><b>{e.agent ?? 'Note'}</b>{e.body.split('\n')[0].slice(0, 220)}{e.ts && <small>{warsawDayTime(e.ts)}</small>}</li>
            ))}
          </ul></div>
        ) : <p>No agent has written to this row's log.</p>)}
        {tab === 'meta' && (
          <dl className="cn-kv">
            <dt>Status</dt><dd>{d.status}</dd>
            <dt>Type</dt><dd>{d.type ?? 'none'}</dd>
            {d.funnel_stage && <><dt>Aim</dt><dd>{d.funnel_stage}</dd></>}
            {Object.entries(tax).map(([k, v]) => <FragmentKV key={k} k={k} v={String(v)} />)}
            <dt>Created</dt><dd>{warsawDayTime(d.created_at)}</dd>
            <dt>Updated</dt><dd>{warsawDayTime(d.updated_at)}</dd>
            {d.scheduled_at && <><dt>Scheduled</dt><dd>{warsawDayTime(d.scheduled_at)} Warsaw</dd></>}
            <dt>Id</dt><dd className="cn-mono">{d.id}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return <><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></>
}
