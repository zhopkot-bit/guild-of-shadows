import type { NodeType } from '../expedition/map';

const NS = 'http://www.w3.org/2000/svg';

/** Контурные иконки узлов карты: рисуются одинаково на любом устройстве, шрифты не нужны. */
const PATHS: Record<NodeType, string> = {
  battle: 'M5 19L17 7M14 6l4-1 1 4M19 19L7 7M10 6L6 5 5 9M4 20l2-2M20 20l-2-2',
  elite: 'M12 4a7 7 0 0 0-7 7c0 2.2 1 3.6 2.5 4.5V19h9v-3.5C18 14.6 19 13.2 19 11a7 7 0 0 0-7-7zM9.5 11h.01M14.5 11h.01M10.5 19v-2M13.5 19v-2',
  event: 'M9 9a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8M12 17.5h.01',
  chest: 'M12 3l7 9-7 9-7-9z',
  camp: 'M3 19L12 5l9 14zM12 19v-5',
  boss: 'M4 17l-1-10 5 4 4-6 4 6 5-4-1 10zM5 20h14',
};

export function nodeIcon(type: NodeType): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', type === 'boss' ? '30' : '24');
  svg.setAttribute('height', type === 'boss' ? '30' : '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[type]);
  svg.append(path);
  return svg;
}

export const NODE_NAME: Record<NodeType, string> = {
  battle: 'Бой',
  elite: 'Элита',
  event: 'Событие',
  chest: 'Сундук',
  camp: 'Лагерь',
  boss: 'Босс',
};
