import { chromium } from 'playwright';
import fs from 'node:fs';
const raw = fs.readFileSync('.session.json','utf8');
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await c.newPage();
await p.addInitScript(r=>localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', r), raw);
await p.goto('http://localhost:5431/#exp/v2/content',{waitUntil:'domcontentloaded'});
for(let i=0;i<40;i++){const s=await p.evaluate(()=>({sk:document.querySelectorAll('.sk').length,len:document.body.innerText.length}));if(s.sk===0&&s.len>2000)break;await p.waitForTimeout(500);}
await p.waitForTimeout(1500);
console.log('len',await p.evaluate(()=>document.body.innerText.length),'pills',await p.evaluate(()=>document.querySelectorAll('.ct-fpills').length));
console.log(JSON.stringify(await p.evaluate(()=>{
  let el = document.querySelector('.ct-fpills');
  const chain=[];
  while(el && chain.length<12){
    const cs=getComputedStyle(el);
    chain.push({cls:(typeof el.className==='string'?el.className:'').slice(0,40), tag:el.tagName, w:Math.round(el.getBoundingClientRect().width), cw:el.clientWidth, sw:el.scrollWidth, disp:cs.display, ox:cs.overflowX, minW:cs.minWidth, flex:cs.flex});
    el = el.parentElement;
  }
  return chain;
}),null,1));
await b.close();
