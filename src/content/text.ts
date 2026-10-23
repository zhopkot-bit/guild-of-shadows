/** Русские формы числительных: plural(3, ['осколок', 'осколка', 'осколков']) → 'осколка'. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Валюта Content Bible «Осколки реликвий» (во внутренней модели — essence). */
export const SHARDS_NAME = 'Осколки реликвий';

export function shards(n: number): string {
  return `${n} ${plural(n, ['осколок', 'осколка', 'осколков'])} реликвий`;
}
