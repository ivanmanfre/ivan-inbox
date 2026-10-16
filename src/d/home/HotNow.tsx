import { useCallback, useEffect, useState } from 'react'
import { fetchHotNow, hotNowProof, skipHotNow, type HotNowCard } from '../../lib/hotNow'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawHm } from '../ui/time'
import { HotNowReview } from './HotNowReview'
import './hotnow.css'
export function useHotNow() {
 const [cards,setCards]=useState<HotNowCard[]>([]),[now,setNow]=useState(Date.now)
 const load=useCallback(()=>{fetchHotNow().then(setCards).catch(()=>{})},[])
 useEffect(()=>{load();const poll=setInterval(load,120000),tick=setInterval(()=>setNow(Date.now()),30000);window.addEventListener('focus',load);window.addEventListener('wb-rows-changed',load);return()=>{clearInterval(poll);clearInterval(tick);window.removeEventListener('focus',load);window.removeEventListener('wb-rows-changed',load)}},[load])
 return {cards:cards.filter(c=>Date.parse(c.post_by)>now && now-Date.parse(c.validation.validated_at)<=3600000),now,reload:load}
}
export function HotNow() {
 const {cards,now,reload}=useHotNow(),[selected,setSelected]=useState<{card:HotNowCard;evidence:boolean}|null>(null),[all,setAll]=useState(false),[busy,setBusy]=useState<string|null>(null)
 const confirm=useDConfirm(),toast=useToast()
 async function skip(c:HotNowCard){if(!await confirm({title:'Skip this hot post?',message:'The draft is archived and the story will not appear again.',confirmText:'Skip',verb:'confirm',danger:true}))return;setBusy(c.draft_id);try{await skipHotNow(c);reload();window.dispatchEvent(new Event('wb-rows-changed'))}catch(e){toast.show({message:e instanceof Error?e.message:'Skip failed.',tone:'failed'})}finally{setBusy(null)}}
 return <>{cards.length>0&&<section aria-label="Hot now" className="hn-list">{(all?cards:cards.slice(0,2)).map(c=><article className="hn" key={c.event_id} data-hot-now data-lane={c.lane} aria-busy={busy===c.draft_id}>
 <div className="hn-top"><strong>Hot now</strong><span>SwishDM <span className="hn-person">for Jonathan</span></span><time dateTime={c.post_by}>Review by {warsawHm(c.post_by)} Warsaw</time></div>
 <h2>{c.headline}</h2><p className="hn-why">{c.validation.buyer_reason}</p>
 <div className="hn-bottom"><span className="hn-proof">{hotNowProof(c.validation)}</span><div className="hn-acts"><button className="d-btn hn-quiet" onClick={()=>setSelected({card:c,evidence:true})}>View evidence</button><button className="d-btn hn-quiet" disabled={busy===c.draft_id} onClick={()=>skip(c)}>Skip</button><button className="d-btn d-btn-p" onClick={()=>setSelected({card:c,evidence:false})}>Review post</button></div></div>
 </article>)}{cards.length>2&&<button className="d-btn hn-quiet" onClick={()=>setAll(!all)}>{all?'Show fewer':`View all ${cards.length} stories`}</button>}</section>}
 {selected&&<HotNowReview card={selected.card} evidenceFirst={selected.evidence} now={now} onClose={()=>setSelected(null)} onChanged={reload}/>}</>
}
