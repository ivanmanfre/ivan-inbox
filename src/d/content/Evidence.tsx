import {
  groupLogByAgent, normalizeAgentLog, normalizeQa, normalizeSourceDetail, selfContainedHtml,
  type ContentDraftDetail,
} from '../../lib/content'
import { useSectionState } from '../../hooks/useSectionState'
import { HtmlPreview } from '../../wb/takeover'
import { AgentRegister, QaRegister } from '../../wb/draft/register'
import { FieldsTab, NoteBox, SourceTab } from './EvidenceTabs'

// The evidence under the post, one tab at a time: QA (the rubric's bars, the
// first issue, then today's full register), Artifact (the self-contained
// authored_html, when there is one), Source, Log (today's per-agent register
// plus the note composer on Ivan's rows), Fields. A tab whose content the row
// does not carry says so; it is never hidden.
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

type Tab = 'qa' | 'art' | 'src' | 'log' | 'meta'

/** Every evidence tab today's window carries (QA with the full register, Artifact, Source, Log with the note composer, Fields); the picked tab is remembered like today's (content.draftwindow). */
export function Evidence({ d, initial = 'qa', noteable = false, onNote }: { d: ContentDraftDetail; initial?: Tab; noteable?: boolean; onNote?: () => void }) {
  const [sect, setSect] = useSectionState('content.draftwindow')
  const qa = normalizeQa(d.qa)
  const src = normalizeSourceDetail(d.source_detail)
  const log = normalizeAgentLog(d.agent_log)
  const agents = groupLogByAgent(log).length
  const scores = qaScores(qa?.feedback ?? null)
  const issues = qaIssues(qa?.feedback ?? null)
  const authored = (d.authored_html ?? '').trim()
  const art = selfContainedHtml(authored)
  const tabs: [Tab, string, string][] = [
    ['qa', 'QA', qa?.score != null ? `${verdictWord(qa.verdict)} ${qa.score}` : 'none'],
    ...(art ? [['art', 'Artifact', ''] as [Tab, string, string]] : []),
    ['src', 'Source', src?.kind ?? d.source_label ?? ''],
    ['log', 'Log', log.length ? `${agents} agent${agents === 1 ? '' : 's'}` : 'note only'],
    ['meta', 'Fields', ''],
  ]
  const stored = sect.open[0] as Tab | undefined
  const tab: Tab = tabs.some(t => t[0] === stored) ? (stored as Tab) : tabs.some(t => t[0] === initial) ? initial : 'qa'
  const setTab = (k: Tab) => setSect(p => ({ ...p, open: [k] }))
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
            <div className="cn-reg app wb ds-shell"><QaRegister qa={qa} /></div>
          </>
        ) : <p>No gate has scored this row.</p>)}
        {tab === 'art' && art && <div className="cn-reg app wb ds-shell"><HtmlPreview html={authored} title="Post as it will appear" /></div>}
        {tab === 'src' && <SourceTab d={d} />}
        {tab === 'log' && (
          <>
            {log.length ? <div className="cn-reg app wb ds-shell"><AgentRegister log={log} /></div>
              : !noteable && <p>No agent activity recorded on this row.</p>}
            {noteable && <NoteBox id={d.id} onDone={onNote ?? (() => undefined)} />}
          </>
        )}
        {tab === 'meta' && <FieldsTab d={d} />}
      </div>
    </div>
  )
}
