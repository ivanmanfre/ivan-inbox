import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session-gate.json','utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:900} })
await ctx.addInitScript(([k,s])=>{ localStorage.setItem(k, JSON.stringify(s)) }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', sess])
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
await p.goto('http://localhost:4540/#exp/brain-b/strategy?skin=b', { waitUntil:'networkidle' })
await p.waitForTimeout(2500)
const { root } = await cdp.send('DOM.getDocument')
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.a-strat-t .ds-input' })
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })
for (const r of m.matchedCSSRules) {
  const props = r.rule.style.cssProperties.filter(x=>x.name==='color')
  if (props.length) console.log(r.rule.selectorList.text, '=>', JSON.stringify(props))
}
console.log('--- inherited ---')
for (const inh of (m.inherited||[])) for (const r of (inh.matchedCSSRules||[])) {
  const props = r.rule.style.cssProperties.filter(x=>x.name==='color')
  if (props.length) console.log('INH', r.rule.selectorList.text, '=>', JSON.stringify(props))
}
await b.close()
