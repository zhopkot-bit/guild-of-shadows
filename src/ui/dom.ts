import { assetUrl } from '../content/asset-url';

export type Child = Node | string | number | null | false | undefined;
type Props = Record<string, unknown>;

/** Мини-хелпер для создания DOM: h('button', { class: 'btn', onclick: fn }, 'Текст'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (tag === 'img' && key === 'src') el.setAttribute(key, assetUrl(String(value)));
      else if (import.meta.env.MODE === 'offline' && key === 'style') {
        // Map backgrounds and other public art referenced by inline styles.
        const style = String(value).replace(/url\(\s*(['"]?)((?:\.\/)?art\/[^'")]+?)\1\s*\)/gi,
          (_match: string, _quote: string, path: string) => 'url("' + assetUrl(path) + '")');
        el.setAttribute(key, style);
      } else if (key === 'class') el.className = String(value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
