import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve('src/index.ts'),
        'core/index': resolve('src/core/index.ts'),
        'agent/index': resolve('src/agent/index.ts'),
        'ui/index': resolve('src/ui/index.ts'),
        fellow: resolve('src/fellow.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'style',
    },
    rolldownOptions: {
      external: ['dompurify'],
      output: { chunkFileNames: 'shared/[name]-[hash].js' },
    },
    target: 'es2022',
    minify: 'terser',
    sourcemap: true,
  },
});
