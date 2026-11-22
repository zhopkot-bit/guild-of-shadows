import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { verifyDist } from './verify-dist.mjs';
import { e2eErrors } from './verify-e2e.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gos-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  const source = join(root, 'public');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'art'), { recursive: true });
  mkdirSync(join(source, 'art'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<script type="module" src="./assets/app.js"></script><link href="./assets/app.css" rel="stylesheet">');
  writeFileSync(join(dist, 'assets/app.js'), 'console.log("./art/hero.webp");');
  writeFileSync(join(dist, 'assets/app.css'), 'body { background: url(../art/hero.webp); }');
  writeFileSync(join(dist, 'art/hero.webp'), 'fixture-image');
  writeFileSync(join(source, 'art/hero.webp'), 'fixture-image');
  return { root, dist, source };
}

test('inventory hashes identify the exact build and detect changed bytes', (t) => {
  const { dist, source } = fixture(t);
  const first = verifyDist(dist, source);
  assert.equal(first.ok, true);
  assert.equal(first.files.length, 4);
  writeFileSync(join(dist, 'assets/app.js'), 'console.log("changed");');
  assert.notEqual(verifyDist(dist, source).inventorySha256, first.inventorySha256);
});

test('missing assets fail even when only a dynamic public path uses them', (t) => {
  const { dist, source } = fixture(t);
  unlinkSync(join(dist, 'art/hero.webp'));
  const result = verifyDist(dist, source);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('Public asset missing')));
});

test('literal JS URLs must resolve even when absent from the source registry', (t) => {
  const { dist, source } = fixture(t);
  writeFileSync(join(dist, 'assets/app.js'), 'console.log("./art/missing.webp");');
  assert(verifyDist(dist, source).errors.some((error) => error.includes('missing.webp')));
});

test('HTML, CSS and JS asset URLs must work below a platform subdirectory', (t) => {
  const { dist, source } = fixture(t);
  writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
  writeFileSync(join(dist, 'assets/app.css'), 'body { background: url(/art/hero.webp); }');
  writeFileSync(join(dist, 'assets/app.js'), 'console.log("/art/hero.webp");');
  const { errors } = verifyDist(dist, source);
  for (const file of ['index.html', 'assets/app.css', 'assets/app.js']) {
    assert(errors.some((error) => error.includes('must be relative') && error.endsWith(file)), file);
  }
});

test('QA saves and reports copied from public cannot enter the production inventory', (t) => {
  const { dist, source } = fixture(t);
  for (const folder of ['qa-saves', 'qa-out']) {
    for (const dir of [dist, source]) {
      mkdirSync(join(dir, folder, 'release'), { recursive: true });
      writeFileSync(join(dir, folder, 'release/battle.json'), '{}');
    }
  }
  const { errors } = verifyDist(dist, source);
  for (const folder of ['qa-saves', 'qa-out']) {
    assert(errors.includes(`Development/source file in dist: ${folder}/release/battle.json`));
  }
});

test('changed public assets and broken HTML/CSS references reject the build', (t) => {
  const { dist, source } = fixture(t);
  writeFileSync(join(dist, 'art/hero.webp'), 'wrong');
  writeFileSync(join(dist, 'assets/app.css'), 'body { background: url(../art/missing.webp); }');
  unlinkSync(join(dist, 'assets/app.js'));
  const result = verifyDist(dist, source);
  assert(result.errors.some((error) => error.includes('differs from source')));
  assert(result.errors.some((error) => error.includes('missing.webp')));
  assert(result.errors.some((error) => error.includes('app.js')));
});

test('source files and paths escaping the archive are rejected', (t) => {
  const { dist, source } = fixture(t);
  writeFileSync(join(dist, 'debug.ts'), 'source');
  writeFileSync(join(dist, 'assets/app.css'), 'body { background: url(../../outside.webp); }');
  const result = verifyDist(dist, source);
  assert(result.errors.some((error) => error.includes('Development/source')));
  assert(result.errors.some((error) => error.includes('escapes dist')));
});

function completeReport() {
  return { viewport: '1366x768', issues: [], steps: [
    'новая игра: экран гильдии', 'экран героя: {}', 'экспедиция начата: карта',
    'ручная атака по выбранной цели', 'ручное умение', 'перезагрузка посреди боя: {}',
    'подготовка к боссу: щиты', 'бой с Костяным королём', 'фаза II Костяного короля',
    'итоги: победа', 'золото: до 1 → после итогов 2',
    'возврат в гильдию: activeRun=null, экспедиций завершено 1',
  ] };
}

test('complete E2E report passes but a logged issue fails', () => {
  const report = completeReport();
  assert.deepEqual(e2eErrors(report, '1366x768'), []);
  report.issues.push('missing texture');
  assert(e2eErrors(report, '1366x768').some((error) => error.includes('missing texture')));
});

test('incomplete cycle, wrong viewport and malformed reports cannot pass', () => {
  assert(e2eErrors({ issues: [], steps: [] }, '1366x768').length > 0);
  assert(e2eErrors(completeReport(), '667x375').length > 0);
  assert(e2eErrors(null, '1366x768').length > 0);
  const report = completeReport();
  report.steps = report.steps.filter((step) => !step.startsWith('фаза II'));
  assert(e2eErrors(report, '1366x768').some((error) => error.includes('фаза II')));
});

test('E2E CLI returns failure for issues and for a missing report', (t) => {
  const { root } = fixture(t);
  const path = join(root, 'report.json');
  const report = completeReport();
  report.issues.push('pageerror');
  writeFileSync(path, JSON.stringify(report));
  const run = (file) => spawnSync(process.execPath, ['tools/release/verify-e2e.mjs', file, '1366x768']);
  assert.equal(run(path).status, 1);
  assert.equal(run(join(root, 'missing.json')).status, 1);
});

test('downloaded build must match the original inventory, including JS bytes', (t) => {
  const { root, dist, source } = fixture(t);
  const expected = join(root, 'inventory.json');
  writeFileSync(expected, JSON.stringify(verifyDist(dist, source)));
  const actual = join(root, 'downloaded.json');
  const run = () => spawnSync(process.execPath, ['tools/release/verify-dist.mjs', dist, source, actual, expected]);
  assert.equal(run().status, 0);
  writeFileSync(join(dist, 'assets/app.js'), 'console.log("tampered");');
  assert.equal(run().status, 1);
});
