import type { RescueChapter, RescueRoute } from '../core/types';
import { moduleDef, RESCUE_MODULE } from '../expedition/modules';
import type { Run } from '../expedition/run';
import { h } from './dom';

export const rescueRoutes = {
  stairs: {
    title: 'Удержать лестницу',
    art: { src: './art/posts/forge.webp', alt: 'Кузница, где для отряда приготовили щит' },
    cost: 'Принять бой, пока каменщики несут раненых наверх.',
    discovery: 'Последнего раненого подхватывают на лестнице. «Лида осталась у склепа, — выдыхает он. — Я слышал, как она заперла дверь изнутри».',
    thanks: 'Каменщик снимает щит с ворот. «Лида прикрыла меня своим. Теперь твоя очередь».',
  },
  winch: {
    title: 'Запустить лебёдку',
    art: { src: './art/posts/library.webp', alt: 'Архив, где каменщики оставили карту' },
    cost: 'Снять с тормоза голема. Его ядро треснуло и может обжечь руки.',
    discovery: 'Клеть поднимается с людьми. На её полу белеет план склепа. «Лидин почерк, — говорит один из каменщиков. — Она осталась у двери».',
    thanks: 'На столе в гильдии разложили план из клети. Каменщики отметили караулы на пути к Лиде.',
  },
} as const;

export function guildRescue(chapter: RescueChapter) {
  if (chapter.stage === 'search') return {
    title: 'Три удара',
    art: { src: './art/v17/guild/citadel.webp', alt: 'Готическая цитадель гильдии' },
    line: 'Бран трижды бьёт рукоятью по плите. Снизу отвечают два раза. «Моя смена. Лида ещё там». Из пустой караульной доносится такой же ответ.',
    action: 'Ответить на стук',
  };
  if (chapter.stage === 'trail') return {
    title: 'Лида у Тронного склепа',
    art: rescueRoutes[chapter.route].art,
    line: rescueRoutes[chapter.route].thanks,
    action: 'Отправиться за Лидой',
  };
  return {
    title: 'Лида дома',
    art: { src: './art/posts/tavern.webp', alt: 'Свет в окнах трактира гильдии' },
    line: 'Утром из-под кухни снова раздаются три удара. Бран роняет ложку. «Ступеньку чиню!» — кричит снизу Лида.',
    action: 'Отправиться в экспедицию',
  };
}

export function routeGift(route: RescueRoute): string {
  const gift = moduleDef(RESCUE_MODULE[route]);
  return `${gift.name}. ${gift.text}.`;
}

export function rescueNote(title: string, text: string, route?: RescueRoute): HTMLElement {
  return h('div', { class: 'rescue-note', 'data-rescue-outcome': route },
    h('strong', null, title), h('p', null, text));
}

export function mapRescue(run: Run): HTMLElement | null {
  const chapter = run.rescue;
  if (!chapter) return null;
  if (chapter.stage === 'search') {
    if (!chapter.outcome) return null;
    const text = run.nodesCleared === 1 ? rescueRoutes[chapter.outcome].discovery
      : 'Каменщики уже на пути в гильдию. На поверхности они помогут снарядить отряд для поисков Лиды.';
    return rescueNote('Смена выбралась', text, chapter.outcome);
  }

  const trail = run.nodesCleared >= 4
    ? 'На последней арке три зарубки. Из-за двери склепа доносится голос Лиды. Остался караул короля.'
    : run.nodesCleared >= 2
      ? 'На развилке — стрелка белым мелом и оттиск ладони. Лида оставляла метки тем, кто пойдёт следом.'
      : `Найдите Лиду у Тронного склепа и победите короля. ${routeGift(chapter.route)}`;
  const note = rescueNote('По следу Лиды', trail);
  note.dataset.rescueStage = 'trail';
  return note;
}

export function rescueDebrief(run: Run): HTMLElement | null {
  const chapter = run.rescue;
  if (!chapter) return null;
  if (chapter.stage === 'trail') return run.result === 'victory'
    ? rescueNote('Лида вернулась', 'Железная перчатка падает на пол. Ложный стук обрывается. Лида отодвигает засов. «Ну что, — говорит она, — дома суп ещё есть?»')
    : rescueNote('Дверь склепа ещё закрыта', 'Каменщики у ворот держат снаряжение наготове. В следующий поход снова можно отправиться за Лидой.');
  if (!chapter.outcome) return rescueNote('Стук ещё слышен', 'У входа всё ещё стоят сухие сапоги. Мать Лиды переставила их поближе к печи.');
  return rescueNote('Смена вернулась в гильдию',
    `Лида всё ещё внизу. К следующему спуску каменщики приготовили снаряжение. ${routeGift(chapter.outcome)}`, chapter.outcome);
}
