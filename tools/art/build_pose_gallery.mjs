/** Layout-only gallery of exported poses; never modifies source images. Run from repository root. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,dirname,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
const [id,packFile,outDir,title]=process.argv.slice(2);
const root=resolve('.'), out=resolve(outDir), pack=JSON.parse(readFileSync(packFile,'utf8'));
mkdirSync(out,{recursive:true});
const link=p=>relative(out,resolve(p)).split('\\').join('/');
const names={idle:'Стойка',aim:'Прицеливание',shoot:'Выстрел',windup:'Замах',strike:'Удар',cast:'Прикрытие',hit:'Получение урона',down:'Павшая',victory:'Победа'};
const style=`*{box-sizing:border-box}body{margin:0;background:#20252b;color:#eee;font:17px Arial,sans-serif}header,footer{padding:20px 28px;background:#141a20}h1{color:#e3c58f;margin:0 0 10px;font-size:28px}p{margin:6px 0;color:#c5ccd4}.grid{display:grid;grid-template-columns:repeat(4,1fr)}article{border:1px solid #6b7177}.label{padding:12px 18px;background:#30373d}.label small{float:right;color:#b9c3cb}.stage{height:500px;position:relative;background:#555b61}.stage:after{position:absolute;content:'';left:0;right:0;top:${pack.pivot[1]*100}%;border-top:1px solid #d5ba83}.stage img{display:block;width:100%;height:100%;object-fit:contain}.refs{display:flex;gap:28px;padding:24px}.refs section{flex:1;padding:20px;background:#343b42}.refs img{max-width:100%;object-fit:contain}.full{height:760px}.face{height:380px}.lineup{height:270px}`;
const card=([pose,file])=>`<article><div class="label">${names[pose]??pose}<small>${pose}</small></div><div class="stage"><img src="${link(resolve(dirname(packFile),Array.isArray(file)?file[0]:file))}"></div></article>`;
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${style}</style><header><h1>${title}</h1><p>Одинаковый холст ${pack.frameWidth}×${pack.frameHeight}, общий масштаб показа, линия опоры. Экспорт WebP; исходные PNG сохранены отдельно.</p></header><div class="grid">${Object.entries(pack.poses).map(card).join('')}</div><footer>Лист для сравнения поз и технической проверки. Ручная художественная ретушь не заявляется выполненной.</footer></html>`;
writeFileSync(resolve(out,'pose-sheet.html'),html);
const refs=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${style}</style><header><h1>${title} · канонические референсы</h1><p>Оригинальные sprite.webp, portrait.webp и hero-lineup.webp; изображения не перерисованы.</p></header><div class="refs"><section><h2>Полная фигура</h2><img class="full" src="${link(`public/art/v17/heroes/${id}/sprite.webp`)}"></section><section><h2>Каноническое лицо</h2><img class="face" src="${link(`public/art/v17/heroes/${id}/portrait.webp`)}"><h2>Общий стиль и масштаб</h2><img class="lineup" src="${link('public/art/scenes/hero-lineup.webp')}"></section></div></html>`;
writeFileSync(resolve(out,'reference-sheet.html'),refs);
const pages=['pose-sheet','reference-sheet'];
if(id==='mira'){
 const figure=(path,label)=>`<article><div class="label">${label}</div><img src="${link(path)}"></article>`;
 writeFileSync(resolve(out,'attack-comparison.html'),`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${style}.attacks{display:flex}.attacks article{width:50%;background:#555b61}.attacks img{display:block;width:100%;height:960px;object-fit:contain}</style><header><h1>Мира · правка клинка</h1><p>V9 принята: клинок продолжает ось рукояти без Г-образного излома.</p></header><div class="attacks">${figure('art-sources/poses/mira/alternatives/strike-v7-blade-rejected.png','V7 · до правки клинка')}${figure('art-sources/poses/mira/proposals/strike.png','V9 · принято')}</div>`);
 pages.push('attack-comparison');
}
const server=createServer((req,res)=>{
 try{const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.png':'image/png','.webp':'image/webp'}[extname(file)]??'application/octet-stream'));res.end(readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await chromium.launch({executablePath:process.env.CHROME??'/usr/bin/chromium'});
try{for(const name of pages){const p=await b.newPage({viewport:{width:name==='hand-detail'?800:1600,height:1200}});await p.goto('http://127.0.0.1:'+server.address().port+'/'+relative(root,resolve(out,name+'.html')));await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await p.locator('body').screenshot({path:resolve(out,name+'.png')});await p.close();}}finally{await b.close();await new Promise(r=>server.close(r));}
console.log(`Rendered ${outDir}`);
