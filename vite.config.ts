import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Runtime dependencies and peers resolve from the consumer's install, so a host shares one copy
// (one signals runtime, one valibot). Dev-only helpers such as the JSON Schema converter stay bundled.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];
export default defineConfig({
  // public/ is the demo site's docs and favicon; the npm package ships only the library.
  publicDir: false,
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
      external: (id) => external.some((name) => id === name || id.startsWith(`${name}/`)),
      output: { chunkFileNames: 'shared/[name]-[hash].js' },
    },
    target: 'es2022',
    minify: 'terser',
    sourcemap: true,
  },
});
