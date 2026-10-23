import type { RNG } from '../core/rng';
import type { HeroClass } from '../core/types';

export type Effect =
  | { k: 'essence'; v: number }
  /** Доля макс. HP каждого живого героя: плюс — лечение, минус — урон (но не ниже 5%). */
  | { k: 'partyHp'; v: number }
  | { k: 'relic' }
  | { k: 'ambush' }
  | { k: 'atkBuff'; v: number }
  | { k: 'recruit' };

export interface Outcome {
  weight: number;
  text: string;
  effects: Effect[];
}

export interface Choice {
  id: string;
  label: string;
  outcomes: Outcome[];
  /** Если в живом отряде есть этот класс — используются эти исходы вместо обычных. */
  ifClass?: { cls: HeroClass; outcomes: Outcome[]; hint: string };
}

export interface EventDef {
  id: string;
  title: string;
  icon: string;
  text: string;
  choices: Choice[];
}

export const EVENTS: readonly EventDef[] = [
  {
    id: 'trap',
    title: 'Ловушка в коридоре',
    icon: '🕸',
    text: 'Узкий проход перекрыт нажимными плитами. За ними блестит тайник.',
    choices: [
      {
        id: 'disarm',
        label: 'Обезвредить',
        outcomes: [
          { weight: 1, text: 'Механизм заклинило, отряд задело осколками.', effects: [{ k: 'partyHp', v: -0.15 }] },
          { weight: 1, text: 'Получилось! В тайнике лежит эссенция.', effects: [{ k: 'essence', v: 3 }] },
        ],
        ifClass: {
          cls: 'rogue',
          hint: 'Плут справится наверняка',
          outcomes: [{ weight: 1, text: 'Плут щёлкает механизм одним движением и забирает тайник.', effects: [{ k: 'essence', v: 3 }] }],
        },
      },
      {
        id: 'dash',
        label: 'Пробежать',
        outcomes: [{ weight: 1, text: 'Пробежали, но поцарапались. Зато подобрали осколки.', effects: [{ k: 'partyHp', v: -0.1 }, { k: 'essence', v: 2 }] }],
      },
      { id: 'skip', label: 'Обойти стороной', outcomes: [{ weight: 1, text: 'Обход занимает время, но ничего не происходит.', effects: [] }] },
    ],
  },
  {
    id: 'altar',
    title: 'Алтарь теней',
    icon: '🗿',
    text: 'Чёрный камень шепчет. Он ждёт дара.',
    choices: [
      {
        id: 'sacrifice',
        label: 'Пожертвовать кровь (−20% HP отряда)',
        outcomes: [{ weight: 1, text: 'Алтарь принимает дар и открывает реликвию.', effects: [{ k: 'partyHp', v: -0.2 }, { k: 'relic' }] }],
      },
      {
        id: 'pray',
        label: 'Помолиться',
        outcomes: [
          { weight: 1, text: 'Тёплый свет исцеляет отряд.', effects: [{ k: 'partyHp', v: 0.25 }] },
          { weight: 1, text: 'Тени отвечают болью.', effects: [{ k: 'partyHp', v: -0.1 }] },
        ],
      },
      { id: 'leave', label: 'Уйти', outcomes: [{ weight: 1, text: 'Вы уходите, не оглядываясь.', effects: [] }] },
    ],
  },
  {
    id: 'camp',
    title: 'Заброшенный лагерь',
    icon: '⛺',
    text: 'Остывший костёр, брошенные вещи. Кто-то ушёл в спешке.',
    choices: [
      {
        id: 'search',
        label: 'Обыскать',
        outcomes: [
          { weight: 7, text: 'Находите припасы и эссенцию.', effects: [{ k: 'essence', v: 2 }] },
          { weight: 3, text: 'Это была приманка. Засада!', effects: [{ k: 'ambush' }] },
        ],
      },
      { id: 'rest', label: 'Отдохнуть', outcomes: [{ weight: 1, text: 'Короткий привал возвращает силы.', effects: [{ k: 'partyHp', v: 0.2 }] }] },
    ],
  },
  {
    id: 'traveler',
    title: 'Раненый путник',
    icon: '🧳',
    text: 'У стены сидит человек. Он прижимает руку к боку и просит воды.',
    choices: [
      {
        id: 'help',
        label: 'Помочь',
        outcomes: [
          { weight: 9, text: 'Путник благодарит и делится находкой.', effects: [{ k: 'essence', v: 3 }] },
          { weight: 1, text: 'Путник оказался бывалым бойцом и просится в гильдию.', effects: [{ k: 'recruit' }] },
        ],
      },
      { id: 'pass', label: 'Пройти мимо', outcomes: [{ weight: 1, text: 'Вы идёте дальше.', effects: [] }] },
    ],
  },
];

export function eventDef(id: string): EventDef {
  const def = EVENTS.find((e) => e.id === id);
  if (!def) throw new Error(`Неизвестное событие: ${id}`);
  return def;
}

/** Событие, которого ещё не было в этом забеге (если все показаны — любое). */
export function pickEvent(rng: RNG, used: readonly string[]): EventDef {
  const fresh = EVENTS.filter((e) => !used.includes(e.id));
  return rng.pick(fresh.length > 0 ? fresh : EVENTS);
}

export function outcomesFor(choice: Choice, partyHasClass: (cls: HeroClass) => boolean): Outcome[] {
  if (choice.ifClass && partyHasClass(choice.ifClass.cls)) return choice.ifClass.outcomes;
  return choice.outcomes;
}
