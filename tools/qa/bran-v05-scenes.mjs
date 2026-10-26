/** Live game scene inspection. Forces sampled poses; not a natural-combat video.
 * CHROME=/usr/bin/chromium node tools/qa/bran-v05-scenes.mjs [base] [save] [out]
 */
import { chromium } from 'playwright-core';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
const [base='http://127.0.0.1:5173/',save='qa-saves/battle.json',out='qa-out/bran-v05-scenes']=process.argv.slice(2);
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});
 await context.addInitScript(serial=>{const s=JSON.parse(serial);s.lastSeen=Date.now();localStorage.setItem('gos.save',JSON.stringify(s));},readFileSync(save,'utf8'));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}?qa=1`);
 await page.waitForFunction(()=>window.__gosArena?.stats().units.some(u=>u.id==='h1'&&u.rig));
 await page.waitForSelector('.action--attack',{timeout:60000});
 await page.evaluate(async()=>{
  const url=performance.getEntriesByType('resource').map(e=>e.name).find(u=>new URL(u).pathname==='/src/ui/arena/scene.ts');
  if(!url)throw new Error('Scene module not loaded');
  const {ArenaScene}=await import(url),original=ArenaScene.prototype.stats;
  ArenaScene.prototype.stats=function(){window.__branScene=this;return original.call(this);};
  try{window.__gosArena.stats();}finally{ArenaScene.prototype.stats=original;}
 });
 await page.evaluate(async()=>{await window.__branScene.die('h1');});
 await page.waitForFunction(()=>{const s=window.__branScene,a=s.actors.get('h1');return(s.time-a.clip.start)*s.speed>=1;});
 const death=await page.evaluate(()=>window.__gosArena.stats().units.find(u=>u.id==='h1'));
 await page.screenshot({path:`${out}/death.png`});
 await page.evaluate(async()=>{await window.__branScene.revive('h1');});
 const revived=await page.evaluate(()=>window.__gosArena.stats().units.find(u=>u.id==='h1'));
 await page.screenshot({path:`${out}/revive.png`});
 const lifecycle={ok:death.clip==='death'&&revived.clip==='idle'&&revived.alpha===1,death,revived,method:'Live ArenaScene methods at manual turn, not combat HP events'};
 await page.evaluate(()=>{window.__branScene.paused=true;});
 const rows=[];let index=0;
 for(const clip of ['idle','attack','cast','hit','death','victory']){
  const duration=await page.evaluate(clip=>window.__branScene.actors.get('h1').rig.rig.info(clip).duration,clip),count=Math.ceil(duration*12);
  for(let frame=0;frame<=count;frame++){
   const fraction=Math.min(frame/count,.999);
   const row=await page.evaluate(({clip,fraction})=>{
    const s=window.__branScene,a=s.actors.get('h1');s.play('h1',clip);a.clip.start=s.time-a.rig.rig.info(clip).duration*fraction/s.speed;s.render();
    let label=document.getElementById('qa-clip');if(!label){label=document.createElement('div');label.id='qa-clip';label.style.cssText='position:fixed;left:10px;top:64px;z-index:99999;background:#111c;color:white;font:16px sans-serif;padding:8px';document.body.append(label);}
    label.textContent=`Bran v0.5: ${clip} — sampled pose preview`;
    return {clip,fraction,backend:s.stats().backend,errors:[...s.errors]};
   },{clip,fraction});
   await page.screenshot({path:`${out}/frame-${String(index++).padStart(4,'0')}.png`,clip:{x:0,y:60,width:650,height:530}});
   if(frame===0||frame===Math.floor(count/2)||frame===count)await page.screenshot({path:`${out}/${clip}-${frame===0?'start':frame===count?'end':'mid'}.png`});
   rows.push(row);
  }
 }
 const ok=lifecycle.ok&&errors.length===0&&rows.every(r=>r.errors.length===0);
 writeFileSync(`${out}/scenes.json`,JSON.stringify({ok,lifecycle,errors,rows,method:'Sampled poses in live renderer, not combat sequencing or FPS benchmark'},null,2));
 console.log(JSON.stringify({ok,captures:rows.length,lifecycle:lifecycle.ok,errors}));if(!ok)process.exitCode=1;
}finally{await browser.close();}
