import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const [build = 'dist-offline', output = 'offline/Guild-of-Shadows.html'] = process.argv.slice(2);
const readText = file => readFileSync(join(build, file), 'utf8');
const index = readText('index.html');
const scriptTags = [...index.matchAll(/<script\b[^>]*\bsrc="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/gi)];
const cssTags = [...index.matchAll(/<link\b[^>]*\bhref="\.\/(assets\/[^"]+\.css)"[^>]*>/gi)];
assert.equal(scriptTags.length, 1, 'Expected one bundled game script');
assert.equal(cssTags.length, 1, 'Expected one bundled game stylesheet');
const [[scriptTag, scriptPath]] = scriptTags;
const [[cssTag, cssPath]] = cssTags;
const script = readText(scriptPath);
const css = readText(cssPath);
assert(script.includes('offline-game-resources'), 'Build with vite build --mode offline first');
assert(!/\burl\(\s*["']?(?!data:)[^)'"\s]/i.test(css), 'Handle external stylesheet resources before packaging');

const resources = Object.create(null);
const mime = new Map([['.json', 'application/json'], ['.webp', 'image/webp']]);
const bundled = new Set(['index.html', scriptPath, cssPath]);
function collect(directory) {
  for (const entry of readdirSync(join(build, directory), { withFileTypes: true })) {
    const file = directory ? directory + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      collect(file);
    } else if (!bundled.has(file)) {
      const type = mime.get(extname(file).toLowerCase());
      assert(entry.isFile() && type, 'Unexpected file in standalone build: ' + file);
      resources[file] = 'data:' + type + ';base64,' + readFileSync(join(build, file)).toString('base64');
    }
  }
}
collect('');
assert(Object.hasOwn(resources, 'art/v17/art-pack.json'), 'Missing game art registry');

const manifest = JSON.stringify(resources).replace(/</g, '\\u003c');
const html = index
  .replace(cssTag, () => '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style>')
  .replace(scriptTag, () => '<script type="application/json" id="offline-game-resources">' + manifest
    + '</script>\n<script type="module">' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, html);
console.log('Wrote ' + output + ' with ' + Object.keys(resources).length + ' embedded resources (' + Buffer.byteLength(html) + ' bytes).');
