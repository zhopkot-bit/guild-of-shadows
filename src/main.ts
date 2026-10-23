import { createPlatform } from './platform';
import { startApp } from './ui/app';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Нет элемента #app');
  const platform = await createPlatform();
  await startApp(platform, root);
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  if (root) root.textContent = 'Не удалось запустить игру. Обновите страницу.';
});
