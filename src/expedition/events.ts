import type { RNG } from '../core/rng';
import type { HeroIdentity } from '../core/types';

/**
 * События экспедиции — Content Bible v1.1, листы Events / Event_Choices (EV01–EV06).
 * Все исходы детерминированы и показываются игроку до выбора; скрытых бросков нет.
 */
export type Effect =
  | { k: 'essence'; v: number }
  | { k: 'gold'; v: number }
  /** Абсолютное изменение HP каждого живого героя (в единицах Content Bible, до HP_SCALE). Минимум 1 HP. */
  | { k: 'hp'; v: number }
  /** Доля макс. HP (наследие v1; используется сундуками/лагерем). */
  | { k: 'partyHp'; v: number }
  | { k: 'relic' }
  | { k: 'ambush' }
  | { k: 'atkBuff'; v: number };

export interface Outcome {
  weight: number;
  text: string;
  effects: Effect[];
}

export interface Choice {
  id: string;
  label: string;
  outcomes: Outcome[];
  /** Вариант доступен, только если этот канонический герой жив в отряде (например, разведка Миры). */
  requires?: { identity: HeroIdentity; hint: string };
}

export interface EventDef {
  id: string;
  title: string;
  text: string;
  choices: Choice[];
}

const one = (text: string, effects: Effect[]): Outcome[] => [{ weight: 1, text, effects }];

export const EVENTS: readonly EventDef[] = [
  {
    id: 'EV01',
    title: 'Заваленный проход',
    text: 'Обрушившиеся каменные плиты перекрыли короткий путь. Мира присматривается к трещинам в стене.',
    choices: [
      { id: 'A', label: 'Мира находит безопасный проход', requires: { identity: 'mira', hint: 'Нужна Мира в отряде' }, outcomes: one('Мира находит лаз между плитами — отряд проходит без потерь.', []) },
      { id: 'B', label: 'Расчистить плиты силой (+20 золота, −15 HP каждому)', outcomes: one('Плиты поддаются, но отряд изрядно побит. За завалом — брошенный кошель.', [{ k: 'gold', v: 20 }, { k: 'hp', v: -15 }]) },
      { id: 'C', label: 'Отступить и обойти', outcomes: one('Обход занимает время, но маршрут продолжается.', []) },
    ],
  },
  {
    id: 'EV02',
    title: 'Заброшенная кузница',
    text: 'В руинах кузницы остались припасы. У остывшего горна дремлет пепельный чародей.',
    choices: [
      { id: 'A', label: 'Одолеть чародея (+30 золота, +2 осколка реликвий, −12 HP каждому)', outcomes: one('Чародей повержен, но пепельный заряд успел обжечь отряд.', [{ k: 'gold', v: 30 }, { k: 'essence', v: 2 }, { k: 'hp', v: -12 }]) },
      { id: 'B', label: 'Забрать только припасы (+10 золота)', outcomes: one('Тихо собираете припасы и уходите.', [{ k: 'gold', v: 10 }]) },
    ],
  },
  {
    id: 'EV03',
    title: 'Раненый странник',
    text: 'У ступеней склепа лежит раненый исследователь с картой следующего участка.',
    choices: [
      { id: 'A', label: 'Помочь и исцелить (+18 HP каждому)', outcomes: one('Странник делится травами и укромным местом для отдыха.', [{ k: 'hp', v: 18 }]) },
      { id: 'B', label: 'Обменять сведения (+1 осколок реликвий)', outcomes: one('Странник отдаёт осколок древней реликвии за пару советов.', [{ k: 'essence', v: 1 }]) },
      { id: 'C', label: 'Пройти мимо', outcomes: one('Вы идёте дальше.', []) },
    ],
  },
  {
    id: 'EV04',
    title: 'Обвал катакомб',
    text: 'Каменная арка перекрыла основной путь; сбоку видна опасная лазейка.',
    choices: [
      { id: 'A', label: 'Обойти безопасно (+10 золота, +1 осколок реликвий)', outcomes: one('Обходной коридор приводит к старому тайнику.', [{ k: 'gold', v: 10 }, { k: 'essence', v: 1 }]) },
      { id: 'B', label: 'Пробить проход (+30 золота, +2 осколка реликвий, −12 HP каждому)', outcomes: one('Проход пробит, по пути — богатая находка и ушибы.', [{ k: 'gold', v: 30 }, { k: 'essence', v: 2 }, { k: 'hp', v: -12 }]) },
    ],
  },
  {
    id: 'EV05',
    title: 'Спор следопытов',
    text: 'Два проводника спорят о повороте; на земле различимы следы и старые отметки маршрута.',
    choices: [
      { id: 'A', label: 'Выбрать безопасный маршрут (+10 золота)', outcomes: one('Надёжная тропа выводит к следующему залу.', [{ k: 'gold', v: 10 }]) },
      { id: 'B', label: 'Использовать разведданные (+2 осколка реликвий)', requires: { identity: 'mira', hint: 'Нужна Мира в отряде' }, outcomes: one('Мира читает следы и находит короткий путь к тайнику.', [{ k: 'essence', v: 2 }]) },
    ],
  },
  {
    id: 'EV06',
    title: 'Повреждённый голем',
    text: 'Древний голем охраняет осколки реликвии; его ядро нестабильно.',
    choices: [
      { id: 'A', label: 'Осторожно отключить (+15 золота, +1 осколок реликвий)', outcomes: one('Голем замирает, осколок ваш.', [{ k: 'gold', v: 15 }, { k: 'essence', v: 1 }]) },
      { id: 'B', label: 'Разобрать ядро (+10 золота, +3 осколка реликвий, −10 HP каждому)', outcomes: one('Ядро вспыхивает при разборке, но добыча того стоила.', [{ k: 'gold', v: 10 }, { k: 'essence', v: 3 }, { k: 'hp', v: -10 }]) },
    ],
  },
];

/** id событий v1.4 из сохранённых забегов. */
const LEGACY_EVENT: Record<string, string> = { trap: 'EV04', altar: 'EV06', camp: 'EV03', traveler: 'EV03' };

export function eventDef(id: string): EventDef {
  const def = EVENTS.find((e) => e.id === (LEGACY_EVENT[id] ?? id));
  if (!def) throw new Error(`Неизвестное событие: ${id}`);
  return def;
}

/** Событие, которого ещё не было в этом забеге (если все показаны — любое). */
export function pickEvent(rng: RNG, used: readonly string[]): EventDef {
  const fresh = EVENTS.filter((e) => !used.includes(e.id));
  return rng.pick(fresh.length > 0 ? fresh : EVENTS);
}

export function outcomesFor(choice: Choice): Outcome[] {
  return choice.outcomes;
}
