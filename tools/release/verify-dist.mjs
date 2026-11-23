import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function verifyDist(distDir, publicDir) {
  const root = resolve(distDir);
  const errors = [];
  const files = [];
  function walk(dir, visit) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) errors.push(`Symlink is not a release asset: ${path}`);
      else if (entry.isDirectory()) walk(path, visit);
      else if (entry.isFile()) visit(path);
    }
  }
  function inside(path) {
    const rel = relative(root, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }
  function reference(ref, from, base = dirname(from)) {
    if (!ref || ref.startsWith('#') || /^(?:data:|https?:|mailto:|blob:|\/\/)/i.test(ref)) return;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) return;
    let path;
    try {
      const decoded = decodeURIComponent(clean);
      if (decoded.startsWith('/') || decoded.includes('\\')) {
        errors.push(`Asset URL must be relative to the game: ${ref} in ${relative(root, from)}`);
        return;
      }
      path = resolve(base, decoded);
    } catch { errors.push(`Invalid URL ${ref} in ${relative(root, from)}`); return; }
    if (!inside(path)) errors.push(`Reference escapes dist: ${ref}`);
    else {
      try { if (!statSync(path).isFile()) throw new Error(); }
      catch { errors.push(`Missing asset ${ref} in ${relative(root, from)}`); }
    }
  }
  try {
    walk(root, (path) => {
      const name = relative(root, path).split(sep).join('/');
      const data = readFileSync(path);
      files.push({ path: name, bytes: data.length, sha256: sha256(data) });
      if (/(?:^|\/)(?:art-sources|node_modules|qa-fixtures|qa-saves|qa-out|masters)(?:\/|$)|\.(?:psd|kra|py|ts|map)$/i.test(name)) {
        errors.push(`Development/source file in dist: ${name}`);
      }
      if (/\.html$/.test(name)) {
        const html = data.toString('utf8');
        for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) reference(match[1], path);
      }
      if (/\.css$/.test(name)) {
        for (const match of data.toString('utf8').matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) reference(match[1], path);
      }
      if (/\.js$/.test(name)) {
        // Literal game asset URLs are relative to the document, not the JS chunk.
        // Dynamic paths are covered by the strict registry and browser requests.
        for (const match of data.toString('utf8').matchAll(/["'`]((?:\.\/|\/)?art\/[^"'`\s${}?#]+\.(?:webp|png|jpg|svg|json|mp3|ogg|wav)(?:[?#][^"'`\s${}]*)?)["'`]/g)) {
          reference(match[1], path, root);
        }
      }
    });
    const index = readFileSync(resolve(root, 'index.html'), 'utf8');
    if (!/<script\b[^>]*type=["']module["'][^>]*src=/i.test(index)) errors.push('index.html has no production module script');
    walk(resolve(publicDir), (source) => {
      const name = relative(resolve(publicDir), source);
      try {
        const target = readFileSync(resolve(root, name));
        if (!target.equals(readFileSync(source))) errors.push(`Public asset differs from source: ${name}`);
      } catch { errors.push(`Public asset missing from dist: ${name}`); }
    });
  } catch (error) { errors.push(error.message); }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { ok: errors.length === 0, errors, files, inventorySha256: sha256(JSON.stringify(files)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dist = 'dist', source = 'public', report, expectedInventory] = process.argv.slice(2);
  const result = verifyDist(dist, source);
  if (expectedInventory) {
    try {
      const expected = JSON.parse(readFileSync(expectedInventory, 'utf8'));
      if (expected.ok !== true || expected.inventorySha256 !== result.inventorySha256) {
        result.errors.push('Downloaded build differs from the verified build inventory');
      }
    } catch (error) { result.errors.push(`Invalid expected inventory: ${error.message}`); }
    result.ok = result.errors.length === 0;
  }
  const json = JSON.stringify(result, null, 2);
  if (report) writeFileSync(report, `${json}\n`);
  console.log(JSON.stringify({ ok: result.ok, files: result.files.length, errors: result.errors }, null, 2));
  if (!result.ok) process.exitCode = 1;
}
