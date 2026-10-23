import type { ArenaSetup } from '../ui/arena/scene';

/**
 * Арены боя. Фон — окружение без запечённых бойцов (см. tools/art/build_assets.py).
 * Координаты огней найдены автоматически по ярким тёплым пятнам текстуры (свечи и лампады).
 */
const CRYPT_LIGHTS: ArenaSetup['lights'] = [
  { u: 0.915, v: 0.845, size: 0.13, warm: true },
  { u: 0.06, v: 0.795, size: 0.1, warm: true },
  { u: 0.115, v: 0.633, size: 0.08, warm: true },
  { u: 0.169, v: 0.635, size: 0.08, warm: true },
  { u: 0.569, v: 0.963, size: 0.08, warm: true },
  { u: 0.24, v: 0.955, size: 0.09, warm: true },
  { u: 0.4, v: 0.76, size: 0.08, warm: true },
  { u: 0.424, v: 0.536, size: 0.07, warm: true },
  { u: 0.707, v: 0.71, size: 0.07, warm: true },
  { u: 0.851, v: 0.522, size: 0.07, warm: true },
  { u: 0.554, v: 0.604, size: 0.065, warm: true },
  { u: 0.92, v: 0.895, size: 0.07, warm: true },
  { u: 0.189, v: 0.667, size: 0.06, warm: true },
];

export const ARENAS: Record<'crypt' | 'boss', ArenaSetup> = {
  crypt: { background: './art/v17/arena/crypt.webp', lights: CRYPT_LIGHTS, wetFloor: true, mood: 'crypt' },
  boss: { background: './art/v17/arena/crypt_boss.webp', lights: CRYPT_LIGHTS.map((l) => ({ ...l, size: l.size * 0.8 })), wetFloor: true, mood: 'boss' },
};
