/** No SDK mocks or request interception. Requires the official dev-proxy and access to Yandex hosts. */
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'https://localhost:8080/';
const out = process.argv[3] ?? 'qa-out/yandex-live.json';
const localCert = process.env.YANDEX_QA_CERT;
const args = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (localCert) {
  const certificate = new X509Certificate(readFileSync(localCert));
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  args.push(`--ignore-certificate-errors-spki-list=${pin}`); // trust this local development certificate only
}
const report: {
  status: 'passed' | 'blocked' | 'failed'; platform: string | null; sdk: Array<{ url: string; status: number; sha256: string; error?: string }>;
  pageErrors: string[]; error?: string;
} = { status: 'failed', platform: null, sdk: [], pageErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args });
const pending: Promise<void>[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript({ content: "window.__gosLiveEvents = []; window.addEventListener('gos:analytics', function(event) { window.__gosLiveEvents.push(event.detail); });" });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (!/\/sdk\.js(?:\?|$)|\/sdk\/_\/v2\./.test(response.url())) return;
    pending.push((async () => {
      const body = await response.body();
      report.sdk.push({ url: response.url(), status: response.status(), sha256: createHash('sha256').update(body).digest('hex'),
        ...(response.status() >= 400 ? { error: body.toString('utf8').slice(0, 160) } : {}) });
    })());
  });
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.locator('.tab').first().waitFor({ timeout: 15_000 });
  await Promise.all(pending);
  report.platform = await page.evaluate(() => {
    const data = (window as unknown as { __gosLiveEvents: Array<{ event: string; params: { platform?: string } }> }).__gosLiveEvents;
    return data.find((entry) => entry.event === 'game_start')?.params.platform ?? null;
  });
  if (report.sdk.some((entry) => entry.status === 403)) {
    report.status = 'blocked';
    throw new Error('SDK request denied by the environment; local fallback is not an SDK test');
  }
  if (!report.sdk.length || report.sdk.some((entry) => entry.status >= 400) || report.platform !== 'yandex') {
    throw new Error('The real SDK did not initialize; local fallback is not accepted');
  }
  if (report.pageErrors.length) throw new Error('Page errors during SDK initialization');
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
