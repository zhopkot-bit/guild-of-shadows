/** Initialization probe. The --draft mode targets the embedded game on the Yandex launch page. */
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Frame, type Page, type Request, type Response } from 'playwright-core';

const { values, positionals } = parseArgs({ options: { draft: { type: 'boolean' } }, allowPositionals: true });
if (positionals.length > 2 || (values.draft && !positionals[0])) {
  throw new Error('Usage: yandex-live.ts [--draft] <launch-url> [report.json]');
}
const [base = 'https://localhost:8080/', out = 'qa-out/yandex-live.json'] = positionals;
const args = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (process.env.YANDEX_QA_CERT) {
  const certificate = new X509Certificate(readFileSync(process.env.YANDEX_QA_CERT));
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  args.push('--ignore-certificate-errors-spki-list=' + pin);
}

type Runtime = 'official-dev-adapter' | 'platform-sdk' | 'unknown';
type SdkResponse = { url: string; status: number; sha256?: string; error?: string };
type GameSignals = { platform: string | null; errors: string[] };
declare global { interface Window { __gosLiveProbe: GameSignals } }

const report: {
  scope: 'initialization-only'; platformAcceptance: 'not_run'; sdkRuntime: Runtime;
  status: 'passed' | 'blocked' | 'failed'; platform: string | null; sdk: SdkResponse[];
  gameFrameOrigin?: string; pageErrors: string[]; error?: string;
} = { scope: 'initialization-only', platformAcceptance: 'not_run', sdkRuntime: 'unknown', status: 'failed', platform: null, sdk: [], pageErrors: [] };

const gameNavigation = '#app > main#screen + nav.tabbar button.tab';
async function findGameFrame(page: Page): Promise<Frame> {
  if (!values.draft) {
    await page.locator(gameNavigation).first().waitFor({ state: 'attached', timeout: 15_000 });
    return page.mainFrame();
  }
  // The launch shell can attach the game after DOMContentLoaded or wrap it in another iframe.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off('frameattached', watch);
      reject(new Error('Game UI did not appear in an iframe. Check the draft launch URL and access.'));
    }, 30_000);
    function watch(frame: Frame) {
      if (frame === page.mainFrame()) return;
      void frame.locator(gameNavigation).first().waitFor({ state: 'attached', timeout: 30_000 }).then(() => {
        clearTimeout(timeout);
        page.off('frameattached', watch);
        resolve(frame);
      }, () => { /* A platform frame may detach before the game starts. */ });
    }
    page.on('frameattached', watch);
    page.frames().forEach(watch);
  });
}

function isSdkScript(request: Request): boolean {
  if (request.resourceType() !== 'script') return false;
  for (let hop: Request | null = request; hop; hop = hop.redirectedFrom()) {
    if (/\/sdk\.js$|\/sdk\/_\/v2\.[^/]+\.js$/.test(new URL(hop.url()).pathname)) return true;
  }
  return false;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => {
    const signals: GameSignals = { platform: null, errors: [] };
    window.__gosLiveProbe = signals;
    window.addEventListener('gos:analytics', (event) => {
      const { detail } = event as CustomEvent;
      if (detail?.event === 'game_start') signals.platform = detail.params?.platform ?? null;
    });
    window.addEventListener('error', (e) => signals.errors.push(e.message));
    window.addEventListener('unhandledrejection', (e) => signals.errors.push(String(e.reason?.message ?? e.reason)));
  });
  const page = await context.newPage();
  const responses: Response[] = [];
  page.on('response', (response) => {
    if (isSdkScript(response.request()) && !(response.status() >= 300 && response.status() < 400)) responses.push(response);
  });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const frame = await findGameFrame(page);
  const signals = await frame.evaluate(() => window.__gosLiveProbe);
  report.platform = signals.platform;
  report.pageErrors = signals.errors;
  if (values.draft) report.gameFrameOrigin = new URL(frame.url()).origin;

  for (const response of responses.filter((res) => !res.request().serviceWorker() && res.frame() === frame)) {
    const url = new URL(response.url());
    // Draft launch links may carry access parameters. Only record the script origin and path.
    const entry: SdkResponse = { url: url.origin + url.pathname, status: response.status() };
    report.sdk.push(entry);
    try {
      const body = await response.body();
      entry.sha256 = createHash('sha256').update(body).digest('hex');
      if (!response.ok()) continue;
      if (body.includes(Buffer.from('webgames-dev-adapter'))) report.sdkRuntime = 'official-dev-adapter';
      else if (report.sdkRuntime === 'unknown' && body.includes(Buffer.from('YandexGamesSDK'))) report.sdkRuntime = 'platform-sdk';
    } catch {
      entry.error = 'Could not read SDK script body';
    }
  }
  if (report.sdk.some(({ status }) => status === 403)) {
    report.status = 'blocked';
    throw new Error('SDK script in the game frame returned HTTP 403');
  }
  if (!report.sdk.length || report.sdk.some((entry) => entry.status >= 400 || entry.error)) {
    throw new Error('SDK script did not load in the game frame');
  }
  if (report.sdkRuntime === 'unknown') throw new Error('Unrecognized SDK script in the game frame');
  if (values.draft && report.sdkRuntime !== 'platform-sdk') throw new Error('Draft probe found the development adapter in the game iframe');
  if (report.platform !== 'yandex') throw new Error('The game did not report starting on YandexPlatform');
  if (report.pageErrors.length) throw new Error('JavaScript errors in the game frame during initialization');
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
