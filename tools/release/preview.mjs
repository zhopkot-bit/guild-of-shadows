import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyDist } from './verify-dist.mjs';

export function identity() {
  const build = verifyDist('dist', 'public');
  if (!build.ok) throw new Error(`Invalid production build: ${build.errors.join('; ')}`);
  return {
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    node: process.version,
    generatedAt: new Date().toISOString(),
    buildInventorySha256: build.inventorySha256,
  };
}

export async function withPreview(out, run) {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const mount = '/verification/';
  const base = `http://127.0.0.1:${port}${mount}`;
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', mount, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let failure;
  child.on('error', (error) => { failure = error; });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const closed = once(child, 'close').catch(() => {});
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure || child.exitCode !== null) throw failure ?? new Error(`Preview exited: ${log}`);
      try {
        const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
        await response.arrayBuffer();
        if (response.ok) { ready = true; break; }
      } catch { /* Wait for the production server, not a fixed startup delay. */ }
      await new Promise((done) => setTimeout(done, 100));
    }
    if (!ready) throw new Error(`Preview did not start: ${log}`);
    return await run(base);
  } finally {
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await closed;
    clearTimeout(killTimer);
    writeFileSync(resolve(out, 'preview.log'), log);
  }
}
