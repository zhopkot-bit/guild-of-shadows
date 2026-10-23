import { RNG } from '../core/rng';

export type NodeType = 'battle' | 'elite' | 'event' | 'chest' | 'camp' | 'boss';

export interface MapNode {
  id: string;
  /** 1..LAYERS+1; последний слой — босс. */
  layer: number;
  index: number;
  type: NodeType;
  next: string[];
}

export const LAYERS = 6; // обычных слоёв; седьмой — босс

/**
 * Вес типов узлов по слоям. Слои 2 и 4 почти целиком боевые: так в каждом забеге есть минимум
 * два боя и босс, а путь из одних сундуков и событий невозможен. Элита — не раньше слоя 3.
 */
const LAYER_WEIGHTS: Record<number, Partial<Record<Exclude<NodeType, 'boss'>, number>>> = {
  1: { battle: 60, event: 40 },
  2: { battle: 100 },
  3: { battle: 40, event: 20, chest: 15, camp: 10, elite: 15 },
  4: { battle: 70, elite: 30 },
  5: { battle: 35, event: 25, chest: 20, camp: 20 },
  6: { battle: 30, event: 20, chest: 15, camp: 35 },
};

function nodeId(layer: number, index: number): string {
  return `${layer}-${index}`;
}

function rollType(rng: RNG, layer: number): NodeType {
  const weights = LAYER_WEIGHTS[layer] ?? { battle: 100 };
  const types = Object.keys(weights) as Array<Exclude<NodeType, 'boss'>>;
  return rng.weighted(types, (t) => weights[t] ?? 0);
}

/**
 * Карта забега в духе Slay the Spire: 6 слоёв по 2–3 узла, у каждого узла 1–2 выхода, затем босс.
 * Один сид — одна карта. Гарантии (проверяются тестом): все узлы достижимы, тупиков нет,
 * слой 1 без лагеря/элиты/сундука, элита не раньше слоя 3, в слое 6 есть лагерь.
 */
export function generateMap(seed: number): MapNode[] {
  const rng = new RNG(seed);
  const layers: MapNode[][] = [];

  for (let layer = 1; layer <= LAYERS; layer++) {
    const count = rng.int(2, 3);
    const nodes: MapNode[] = [];
    for (let i = 0; i < count; i++) nodes.push({ id: nodeId(layer, i), layer, index: i, type: rollType(rng, layer), next: [] });
    layers.push(nodes);
  }
  layers.push([{ id: nodeId(LAYERS + 1, 0), layer: LAYERS + 1, index: 0, type: 'boss', next: [] }]);

  // Перед боссом всегда есть возможность отдохнуть.
  const preBoss = layers[LAYERS - 1] as MapNode[];
  if (!preBoss.some((n) => n.type === 'camp')) (rng.pick(preBoss) as MapNode).type = 'camp';

  for (let l = 0; l < layers.length - 1; l++) {
    const from = layers[l] as MapNode[];
    const to = layers[l + 1] as MapNode[];
    const incoming = new Set<number>();
    from.forEach((node, i) => {
      const set = new Set<number>();
      const j = from.length === 1 ? 0 : Math.round((i * (to.length - 1)) / (from.length - 1));
      set.add(j);
      if (to.length > 1 && rng.chance(0.5)) {
        const side = rng.chance(0.5) ? -1 : 1;
        const alt = Math.min(to.length - 1, Math.max(0, j + side));
        set.add(alt);
      }
      for (const t of set) {
        incoming.add(t);
        node.next.push((to[t] as MapNode).id);
      }
    });
    // Каждый узел следующего слоя должен быть достижим хотя бы из одного узла.
    to.forEach((target, j) => {
      if (incoming.has(j)) return;
      const i = to.length === 1 ? 0 : Math.round((j * (from.length - 1)) / (to.length - 1));
      (from[i] as MapNode).next.push(target.id);
    });
    for (const node of from) node.next = Array.from(new Set(node.next)).sort();
  }

  return layers.flat();
}
