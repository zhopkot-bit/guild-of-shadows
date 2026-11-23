// The standalone edition embeds each public file once in the HTML.
let embedded: Record<string, string> | undefined;

export function assetUrl(path: string): string {
  if (import.meta.env.MODE !== 'offline') return path;
  if (!embedded) {
    const data = document.getElementById('offline-game-resources')?.textContent;
    if (!data) throw new Error('Embedded game resources are missing');
    embedded = JSON.parse(data) as Record<string, string>;
  }
  const root = new URL('.', document.baseURI);
  const url = new URL(path, root);
  const key = decodeURIComponent(url.pathname.slice(root.pathname.length));
  if (!url.href.startsWith(root.href) || !Object.hasOwn(embedded, key)) {
    throw new Error(`Unknown standalone game resource: ${path}`);
  }
  return embedded[key]!;
}
