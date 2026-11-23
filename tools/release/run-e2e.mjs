import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { e2eErrors } from './verify-e2e.mjs';
import { identity, withPreview } from './preview.mjs';

const [directory = 'qa-out/release/e2e', width = '1366', height = '768'] = process.argv.slice(2);
const out = resolve(directory);
mkdirSync(out, { recursive: true });
// A previous successful report must never satisfy a failed/new run.
if (existsSync(resolve(out, 'e2e-report.json'))) throw new Error(`Use a fresh E2E output directory: ${out}`);
const report = { ...identity(), viewport: `${width}x${height}`, ok: false, errors: [] };
try {
  await withPreview(out, async (base) => {
    const result = await new Promise((done, reject) => {
      const child = spawn(process.execPath, ['tools/qa/e2e.mjs', base, out, width, height], {
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 360_000,
        env: { ...process.env, CHROME: process.env.CHROME ?? chromium.executablePath() },
      });
      let log = '';
      child.stdout.on('data', (chunk) => { log += chunk; process.stdout.write(chunk); });
      child.stderr.on('data', (chunk) => { log += chunk; process.stderr.write(chunk); });
      child.on('error', reject);
      child.on('close', (code, signal) => { writeFileSync(resolve(out, 'runner.log'), log); done({ code, signal }); });
    });
    if (result.code !== 0) report.errors.push(`E2E runner failed: ${JSON.stringify(result)}`);
    try { report.errors.push(...e2eErrors(JSON.parse(readFileSync(resolve(out, 'e2e-report.json'), 'utf8')), report.viewport)); }
    catch (error) { report.errors.push(`E2E report missing or invalid: ${error.message}`); }
  });
} catch (error) { report.errors.push(error.stack ?? error.message); }
report.ok = report.errors.length === 0;
writeFileSync(resolve(out, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
