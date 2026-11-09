import { createPlatform, SaveLoadError } from './platform';
import { startApp } from './ui/app';
import { h } from './ui/dom';
import T from './content/ui-text.json';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Нет элемента #app');
  root.replaceChildren(h('div', { class: 'loading', role: 'status' }, T.loading));
  const platform = await createPlatform();
  await startApp(platform, root);
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  if (root) root.replaceChildren(h('section', { class: 'boot-error', role: 'alert' },
    h('h1', null, T.startup.title),
    h('p', null, e instanceof SaveLoadError ? T.startup.saveUnavailable : T.startup.error),
    h('button', { class: 'btn', type: 'button', onclick: () => window.location.reload() }, T.startup.retry),
  ));
});
