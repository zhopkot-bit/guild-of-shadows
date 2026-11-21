/** Browser regression for the initialization probe. These documents are fixtures, not an SDK acceptance run. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const probe = fileURLToPath(new URL('./yandex-live.ts', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'gos-sdk-probe-'));
const servers = [];
async function serve(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}

try {
  const game = await serve((req, res) => {
    const url = new URL(req.url, 'http://fixture.test');
    const kind = url.searchParams.get('kind');
    if (url.pathname === '/sdk.js') {
      res.writeHead(kind === 'denied' ? 403 : 200, { 'Content-Type': 'application/javascript' });
      res.end(({ dev: '/* webgames-dev-adapter */', fallback: '/* YandexGamesSDK */' })[kind] ?? '/* fixture */');
      return;
    }
    // Even an apparent game_start on Yandex must not satisfy a draft probe with an unknown script.
    res.setHeader('Content-Type', 'text/html');
    res.end('<script src="/sdk.js?kind=' + encodeURIComponent(kind) + '"></script>' +
      '<div id="app"><main id="screen"></main><nav class="tabbar"><button class="tab">Game</button></nav></div>' +
      (kind === 'fallback' ? '' : '<script>dispatchEvent(new CustomEvent("gos:analytics", {detail:{event:"game_start", params:{platform:"yandex"}}}))</script>'));
  });
  const shell = await serve((req, res) => {
    const url = new URL(req.url, 'http://fixture.test');
    if (url.pathname === '/sdk.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end('/* YandexGamesSDK */');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/sibling') return res.end('<script src="/sdk.js"></script><script>throw Error("fixture sibling")</script>');
    if (url.pathname === '/wrapper') return res.end('<iframe src="' + game + '/' + url.search + '"></iframe>');
    res.end('<script src="/sdk.js"></script><button class="tab">Shell</button>' +
      '<iframe src="/sibling"></iframe><iframe src="/wrapper' + url.search + '"></iframe>');
  });
  for (const [kind, code, status, runtime, http] of [
    ['dev', 1, 'failed', 'official-dev-adapter', 200],
    ['unknown', 1, 'failed', 'unknown', 200],
    ['denied', 2, 'blocked', 'unknown', 403],
    ['fallback', 1, 'failed', 'platform-sdk', 200],
  ]) {
    const path = join(dir, kind + '.json');
    const result = await exec(process.execPath, ['--import', 'tsx', probe, '--draft', shell + '/?kind=' + kind, path])
      .then(() => 0, (error) => error.code);
    const report = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(result, code, JSON.stringify(report));
    assert.equal(report.status, status);
    assert.equal(report.sdkRuntime, runtime);
    assert.equal(report.platform, kind === 'fallback' ? null : 'yandex');
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.platformAcceptance, 'not_run');
    assert.equal(report.gameFrameOrigin, game);
    assert.deepEqual(report.sdk.map((entry) => [entry.url, entry.status]), [[game + '/sdk.js', http]]);
    console.log('PASS nested cross-origin game, ' + kind + ': ' + status);
  }
} finally {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(dir, { recursive: true, force: true });
}
