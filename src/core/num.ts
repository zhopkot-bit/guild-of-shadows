/**
 * Все игровые величины (золото, доход, цены) идут через этот тип.
 * Для MVP хватает обычного number: он держит до ~1e308, а потеря точности на огромных
 * значениях в idle-игре незаметна. Если эндгейм когда-нибудь выйдет за 1e300 —
 * заменить тип здесь (например, на break_infinity.js) и поправить арифметику в economy.ts.
 */
export type Num = number;

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Короткая запись числа: 1.23K, 45.6M, ... дальше научная нотация. */
export function fmt(n: Num): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) {
    if (n >= 100) return String(Math.floor(n));
    if (n >= 10) return trim(n.toFixed(1));
    return trim(n.toFixed(2));
  }
  let exp = Math.floor(Math.log10(n) / 3);
  let mant = n / Math.pow(1000, exp);
  // Защита от «1000K» после округления.
  if (Number(mant.toFixed(2)) >= 1000) {
    exp += 1;
    mant = n / Math.pow(1000, exp);
  }
  if (exp >= SUFFIXES.length) return n.toExponential(2).replace('e+', 'e');
  const text = mant >= 100 ? String(Math.floor(mant)) : mant >= 10 ? mant.toFixed(1) : mant.toFixed(2);
  return trim(text) + SUFFIXES[exp];
}

/** Длительность: «45с», «12м 30с», «2ч 05м». */
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s}с`;
  if (s < 3600) return `${Math.floor(s / 60)}м ${String(s % 60).padStart(2, '0')}с`;
  return `${Math.floor(s / 3600)}ч ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}м`;
}
