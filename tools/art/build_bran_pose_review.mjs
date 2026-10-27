/** Browser layout of unmodified source pictures for art review.
 * No retouching and no source PNG resampling. Run from repository root.
 * CHROME=/usr/bin/chromium node tools/art/build_bran_pose_review.mjs
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
const out=resolve('docs/art-review/bran-poses-v2');mkdirSync(out,{recursive:true});
const source=resolve('art-sources/poses/bran/proposals');
const rows=[
 ['idle','Стойка',557,1390,1],['windup','Замах',640,1427,1],
 ['strike','Удар',525,1350,1],['cast','Прикрытие',565,1385,1],
 ['hit','Урон',750,1390,1],['down','Павший',570,1378,1],['victory','Победа',565,1423,1.09]
];
const url=(path)=>relative(out,path).split('\\').join('/');
const style=`*{box-sizing:border-box}body{margin:0;background:#292c31;color:#eee;font:16px Arial,sans-serif}header{padding:22px 28px;background:#151a20}h1{font-size:27px;margin:0 0 10px;color:#e3c58f}p{margin:6px 0;color:#c2c8ce;line-height:1.4}.row{display:flex}.card{width:360px;flex:0 0 360px;border-right:1px solid #52565c}.label{padding:12px 16px;background:#20252b;font-size:21px}.label span{font-size:14px;color:#b4bdc6;margin-left:12px}.stage{position:relative;height:500px;overflow:hidden;background:#50545b}.stage:after{content:'';position:absolute;left:0;right:0;top:464.06px;border-top:1px solid #ceb172}.pose{position:absolute;max-width:none}.foot{height:58px;padding:12px 16px;font-size:13px;color:#bdc5cb}footer{padding:16px 28px;background:#151a20;color:#c2c8ce;font-size:16px}`;
function card([id,label,px,py,scale]){
 const factor=.28125*scale,w=1086*factor,h=1448*factor,x=180-px*factor,y=464.0625-py*factor;
 return `<article class="card"><div class="label">${label}<span>${id}</span></div><div class="stage"><img class="pose" src="${url(resolve(source,id+'.png'))}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"/></div><div class="foot">${id==='victory'?'Масштаб показа ×1,09;':'Масштаб показа ×1,00;'} точка опоры оценена вручную</div></article>`;
}
const sheet=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${style}</style><header><h1>Бран · семь цельных поз · художественный черновик</h1><p>Канон: оригинальные sprite / portrait / hero-lineup. 27.10.2026 · ТЗ 2.0.</p><p>Исходники 1086×1448. Для сравнения добавлены поля и перенос к общей линии опоры; PNG не изменены. Масштаб требует финальной проверки.</p></header><main class="row">${rows.map(card).join('')}</main><footer>Оценить: лицо · одинаковая экипировка · перенос веса · хват меча · читаемость замаха и удара. Это лист для приёмки, не готовый игровой пакет.</footer></html>`;
writeFileSync(resolve(out,'consistency-sheet.html'),sheet);
const action=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${style}.card{width:540px;flex-basis:540px}.stage{height:750px;transform-origin:top left}.stage img{transform:scale(1.5);transform-origin:0 0}.stage:after{top:696.09px}.foot{height:50px}</style><header><h1>Контраст действия: стойка → замах → удар</h1><p>Предварительная пластика по канону. Во всех трёх — один масштаб исходных пикселей.</p></header><main class="row">${rows.slice(0,3).map(r=>{
 const [id,label,px,py]=r;return `<article class="card"><div class="label">${label}</div><div class="stage"><img class="pose" src="${url(resolve(source,id+'.png'))}" style="left:${270-px*.421875}px;top:${696.09375-py*.421875}px;width:305.4375px;height:407.25px"/></div></article>`;
}).join('')}</main></html>`;
writeFileSync(resolve(out,'action-comparison.html'),action);
const full=url(resolve('public/art/v17/heroes/bran/sprite.webp'));const face=url(resolve('public/art/v17/heroes/bran/portrait.webp'));const lineup=url(resolve('public/art/scenes/hero-lineup.webp'));
const refs=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${style}.refs{display:flex;padding:24px;gap:24px;height:865px}.panel{background:#333941;padding:20px;flex:1}.panel h2{font-size:21px;color:#e3c58f;margin:0 0 14px}.full{height:740px;display:block;margin:auto}.portrait{width:280px;display:block;margin:25px auto}.detail{height:520px;width:330px;overflow:hidden;position:relative;margin:auto}.detail img{position:absolute;height:950px;left:-170px;top:-260px}.lineup{height:210px;object-fit:contain;width:100%}</style><header><h1>Бран · опорный лист из канонических изображений</h1><p>Исходные изображения сохранены без изменений. Увеличенные фрагменты служат справкой; новых деталей здесь не дорисовано.</p></header><div class="refs"><section class="panel"><h2>Полная фигура</h2><img class="full" src="${full}"/></section><section class="panel"><h2>Лицо и крупный наплечник</h2><img class="portrait" src="${face}"/><p>Усталый угловатый ветеран, короткие тёмные волосы, борода. Синий шарф и массивный скруглённый наплечник.</p><img class="lineup" src="${lineup}"/><p>Групповой арт — проверка общего стиля и массивности Брана.</p></section><section class="panel"><h2>Щит, ремни и ткань</h2><div class="detail"><img src="${full}"/></div><p>Тёмно-синий щит-капля: золотой крест и окантовка. Коричневая кожа, потёртая сталь, синий рваный табард.</p><p>Меч — в правой руке, щит — на левой. Герой обращён вправо.</p></section></div></html>`;
writeFileSync(resolve(out,'reference-sheet.html'),refs);
// Export sheets by screenshotting layout; original source files remain untouched.
const root=resolve('.');
const server=createServer((req,res)=>{
 try{const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.png':'image/png','.webp':'image/webp'}[extname(file)]||'application/octet-stream'));res.end(readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--allow-file-access-from-files']});
try{
 for(const [name,width] of [['reference-sheet',1536],['consistency-sheet',2520],['action-comparison',1620]]){
  const page=await browser.newPage({viewport:{width,height:1100},deviceScaleFactor:1});await page.goto(origin+'/'+relative(root,resolve(out,name+'.html')));
  const images=await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode()));return [...document.images].map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight}));});
  if(images.some(i=>!i.loaded))throw new Error('Missing image on '+name);
  const body=page.locator('body');await body.screenshot({path:resolve(out,name+'.png')});await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log('Rendered reference, consistency and action review sheets; source PNGs unchanged.');
