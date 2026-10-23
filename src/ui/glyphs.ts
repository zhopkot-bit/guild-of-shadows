const NS = 'http://www.w3.org/2000/svg';

/**
 * Контурные иконки интерфейса боя и ростера. Только SVG-пути: никаких символов шрифта,
 * которые на части устройств превращаются в пустые квадраты. Вымышленная геометрия, без
 * узнаваемой реальной символики.
 */
const PATHS = {
  sword: 'M4 20l4-4M7 17l-2-2M6.5 15.5L18 4h2v2L8.5 17.5M14 6l4 4',
  bow: 'M6 3c8 3 11 9 11 18M6 3v18M6 21c8-3 11-9 11-18M3 12h16M16 9l3 3-3 3',
  crossbow: 'M4 12h14M15 9l4 3-4 3M7 5c3 2 3 12 0 14M7 5l-3 7 3 7M12 8v8',
  staff: 'M6 21L16 7M15 4l3-1 1 3-2 3-3-1zM9 15l-2-1M12 11l-2-1',
  claw: 'M6 4c2 4 2 9-1 15M11 4c2 4 2 9-1 15M16 4c2 4 2 9-1 15',
  ember: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 2 4 1-2 1-5 1-8z',
  cover: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4',
  lunge: 'M3 21l8-8M9 11l4-1 7-7-1 7-7 4zM5 15l4 4',
  aimedShot: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12h.01',
  healingLight: 'M12 4v16M4 12h16M7 7l10 10M17 7L7 17',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  wave: 'M2 15c3-4 5-4 8 0s5 4 8 0 3-3 4-2M2 10c3-4 5-4 8 0s5 4 8 0',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2 1 3.5 2.5 4.5V18h9v-3.5C18 13.5 19 12 19 10a7 7 0 0 0-7-7zM9.5 10h.01M14.5 10h.01M10 18v2M14 18v2',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  play: 'M7 5l11 7-11 7z',
  fast: 'M4 6l7 6-7 6zM12 6l7 6-7 6z',
  close: 'M6 6l12 12M18 6L6 18',
  target: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  defender: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  scout: 'M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  shooter: 'M4 12h14M15 9l4 3-4 3M7 5c3 2 3 12 0 14',
  healer: 'M12 4v16M4 12h16',
  crown: 'M4 17l-1-10 5 4 4-6 4 6 5-4-1 10zM5 20h14',
} as const;

export type GlyphName = keyof typeof PATHS;

export function glyph(name: GlyphName, size = 24, stroke = 1.8): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `glyph glyph--${name}`);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
