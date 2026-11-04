import { describe, expect, it } from 'vitest';
import { bossPoseHeightLimit } from '../src/ui/arena/layout';

describe('boss pose framing', () => {
  it('reserves space for both phase canvases at one shared figure height', () => {
    const arenaHeight = 842;
    const phases = [0.667, 0.7994];
    const cap = bossPoseHeightLimit(arenaHeight, phases);
    for (const figureFraction of phases) expect(cap / figureFraction).toBeLessThan(arenaHeight);
    expect(cap).toBe(bossPoseHeightLimit(arenaHeight, phases.reverse()));
  });

  it('does not constrain scenes without usable pose packs', () => {
    expect(bossPoseHeightLimit(375, [])).toBe(Infinity);
    expect(bossPoseHeightLimit(375, [0, NaN, 2])).toBe(Infinity);
  });
});
