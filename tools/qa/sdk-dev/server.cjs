/** Official @yandex-games/sdk-dev-proxy@0.0.2, with local TLS and no browser opener.
 * Based on the T1 QA launcher at 3f897cde; SDK and proxy responses are unmodified.
 * Install: npm install --prefix work/yandex-sdk --cache ./work/npm-cache --no-save @yandex-games/sdk-dev-proxy@0.0.2
 * Run: node --use-env-proxy tools/qa/sdk-dev/server.cjs [port] [build-directory]
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const work = path.join(root, 'work/yandex-sdk');
const proxy = path.join(work, 'node_modules/@yandex-games/sdk-dev-proxy/bin/index.js');
const build = path.resolve(root, process.argv[3] ?? 'dist-yandex');
if (!fs.existsSync(proxy)) throw new Error('Install @yandex-games/sdk-dev-proxy@0.0.2 into work/yandex-sdk first');
if (!fs.existsSync(path.join(build, 'index.html'))) throw new Error('Run npm run build:yandex first');
const keyPath = path.join(work, 'localhost.key');
const certPath = path.join(work, 'localhost.crt');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
  '-out', certPath, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
fs.chmodSync(keyPath, 0o600);
const createServer = https.createServer;
https.createServer = function (options, ...args) {
  return createServer.call(this, { ...options, key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, ...args);
};
const noOpen = path.join(work, 'no-open');
fs.writeFileSync(noOpen, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
process.env.BROWSER = noOpen;
process.argv = [process.execPath, proxy, '--path', build, '--port', process.argv[2] ?? '8080', '--dev-mode', '--log', 'false'];
require(proxy);
