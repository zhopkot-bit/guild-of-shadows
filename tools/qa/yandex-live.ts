/** Initialization probe. The --draft mode targets the embedded game on the Yandex launch page. */
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type APIRequestContext, type Frame, type Page, type Request, type Response } from 'playwright-core';

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
type SdkReference = { url: string; status?: number; sha256?: string };
type GameSignals = { platform: string | null; errors: string[] };
declare global { interface Window { __gosLiveProbe: GameSignals } }

const report: {
  scope: 'initialization-only'; platformAcceptance: 'not_run'; sdkRuntime: Runtime;
  status: 'passed' | 'blocked' | 'failed'; platform: string | null; sdk: SdkResponse[];
  launchOrigin?: string; gameFrameOrigin?: string; sdkReferences?: SdkReference[];
  pageErrors: string[]; error?: string;
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

function sdkPath(request: Request): string | undefined {
  if (request.resourceType() !== 'script') return;
  for (let hop: Request | null = request; hop; hop = hop.redirectedFrom()) {
    const { pathname } = new URL(hop.url());
    if (pathname === '/sdk.js' || /^\/sdk\/_\/v2\.[0-9a-f]+\.js$/i.test(pathname)) return pathname;
  }
}

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

async function confirmPlatformScript(api: APIRequestContext, observed: ReadonlyMap<string, string>) {
  const references: SdkReference[] = [];
  report.sdkReferences = references;
  for (const [path, observedHash] of observed) {
    const ref: SdkReference = { url: 'https://games.s3.yandex.net' + path };
    references.push(ref);
    try {
      const response = await api.get(ref.url, { timeout: 15_000 });
      ref.status = response.status();
      if (!response.ok()) continue;
      ref.sha256 = sha256(await response.body());
      if (ref.sha256 === observedHash) {
        report.sdkRuntime = 'platform-sdk';
        return;
      }
    } catch { /* Try the versioned bundle if the current loader cannot be compared. */ }
  }
  if (!references.some((ref) => ref.sha256)) {
    report.status = 'blocked';
    throw new Error('Official Yandex CDN reference unavailable; SDK origin could not be verified');
  }
  throw new Error('Game SDK bytes did not match the official Yandex CDN reference');
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
  const responses: Array<{ path: string; response: Response }> = [];
  page.on('response', (response) => {
    const path = sdkPath(response.request());
    if (path && !(response.status() >= 300 && response.status() < 400)) responses.push({ path, response });
  });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const frame = await findGameFrame(page);
  const signals = await frame.evaluate(() => window.__gosLiveProbe);
  report.platform = signals.platform;
  report.pageErrors = signals.errors;
  if (values.draft) {
    report.launchOrigin = new URL(page.url()).origin;
    report.gameFrameOrigin = new URL(frame.url()).origin;
  }

  const platformScripts = new Map<string, string>();
  for (const { path, response } of responses) {
    if (response.request().serviceWorker() || response.frame() !== frame) continue;
    const url = new URL(response.url());
    // Draft launch links may carry access parameters. Only record the script origin and path.
    const entry: SdkResponse = { url: url.origin + url.pathname, status: response.status() };
    report.sdk.push(entry);
    try {
      const body = await response.body();
      entry.sha256 = sha256(body);
      if (!response.ok()) continue;
      if (body.includes(Buffer.from('webgames-dev-adapter'))) report.sdkRuntime = 'official-dev-adapter';
      else if (body.includes(Buffer.from('YandexGamesSDK'))) platformScripts.set(path, entry.sha256);
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
  if (report.sdkRuntime === 'unknown' && platformScripts.size === 0) throw new Error('Unrecognized SDK script in the game frame');
  if (values.draft && report.sdkRuntime === 'official-dev-adapter') throw new Error('Draft probe found the development adapter in the game iframe');
  if (report.platform !== 'yandex') throw new Error('The game did not report starting on YandexPlatform');
  if (report.pageErrors.length) throw new Error('JavaScript errors in the game frame during initialization');
  if (values.draft) await confirmPlatformScript(context.request, platformScripts);
  else if (report.sdkRuntime === 'unknown' && platformScripts.size > 0) report.sdkRuntime = 'platform-sdk';
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
