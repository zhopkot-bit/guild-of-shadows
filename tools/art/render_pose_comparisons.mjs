// Review sheets use the exported WebP at one fixed scale per character.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve('public/art/v17');
const output = resolve('docs/art-review/technical-integration-2026-10-30');
const spec = JSON.parse(readFileSync('art-sources/poses/technical-layout.json', 'utf8')).characters;
mkdirSync(output, { recursive: true });
const server = createServer((req, res) => {
  try {
    const f = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!f.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', extname(f) === '.webp' ? 'image/webp' : 'application/octet-stream');
    res.end(readFileSync(f));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--disable-dev-shm-usage'] });
try {
  for (const [name, entry] of Object.entries(spec)) {
    const pack = JSON.parse(readFileSync(resolve(root, entry.runtime, 'poses.json'), 'utf8'));
    const scale = .4;
    const cards = entry.poses.map(p => `<section><strong>${p}</strong><div class="view"><div class="floor" style="top:${pack.pivot[1] * pack.frameHeight * scale}px"></div><img src="http://127.0.0.1:${server.address().port}/${entry.runtime}/${pack.poses[p]}" style="width:${pack.frameWidth * scale}px;height:${pack.frameHeight * scale}px"></div></section>`).join('');
    const page = await browser.newPage({ viewport: { width: 1880, height: 950 } });
    await page.setContent(`<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#171d23;color:#f4f4f4;font:16px sans-serif}h1{margin:0;padding:16px;font-size:24px}p{margin:0;padding:0 16px 12px;color:#bbb}.grid{display:grid;grid-template-columns:repeat(4,470px)}section{height:356px;position:relative;border:1px solid #777;background:#555;overflow:hidden}strong{display:block;background:#30383e;padding:5px}.view{height:308px;position:relative;overflow:hidden}img{position:absolute;top:0;left:50%;transform:translateX(-50%)}.floor{position:absolute;left:0;right:0;border-top:1px solid #f7b353;z-index:2}</style><h1>${name} — игровые позы</h1><p>Один масштаб и линия опоры для всех поз этого набора; представлены игровые WebP.</p><div class="grid">${cards}</div>`);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    await page.locator('body').screenshot({ path: `${output}/${name}-runtime-sheet.png`, timeout: 30000 });
    writeFileSync(`${output}/${name}-runtime-info.json`, JSON.stringify({ character: name, pack: entry.runtime, scale, frame: [pack.frameWidth, pack.frameHeight], pivot: pack.pivot }, null, 2) + '\n');
    await page.close();
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
