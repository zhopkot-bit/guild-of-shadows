/** Run the unmodified official proxy with a named local TLS certificate and no browser opener.
 * Install first: npm install --prefix work/yandex-sdk --no-save @yandex-games/sdk-dev-proxy@0.0.2
 * Run: node --use-env-proxy tools/qa/yandex-dev-server.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const work = path.join(root, 'work/yandex-sdk');
const proxy = path.join(work, 'node_modules/@yandex-games/sdk-dev-proxy/bin/index.js');
if (!fs.existsSync(proxy)) throw new Error('Install @yandex-games/sdk-dev-proxy@0.0.2 into work/yandex-sdk first');
fs.mkdirSync(work, { recursive: true });
const keyPath = path.join(work, 'localhost.key');
const certPath = path.join(work, 'localhost.crt');
// Generate a fresh short-lived localhost certificate on every server start.
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
  '-out', certPath, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
fs.chmodSync(keyPath, 0o600);
const createServer = https.createServer;
https.createServer = function (options, ...args) {
  return createServer.call(this, { ...options, key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, ...args);
};
// The package's browser opener fails in a headless environment; QA launches Chromium itself.
const noOpen = path.join(work, 'no-open');
fs.writeFileSync(noOpen, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
process.env.BROWSER = noOpen;
process.argv = [process.execPath, proxy, '--path', path.join(root, 'dist'), '--port', process.argv[2] ?? '8080', '--dev-mode', '--log', 'false'];
require(proxy);
