import { defineConfig } from 'vite';

// Относительные пути нужны, потому что Яндекс.Игры отдают игру из подпапки архива.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
