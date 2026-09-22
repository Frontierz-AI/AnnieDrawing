import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const dist = resolve(root, 'dist');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const runtime = Object.keys(pkg.dependencies ?? {}),
  peers = Object.keys(pkg.peerDependencies ?? {});
const declared = (specifier) =>
  [...runtime, ...peers].some((name) => specifier === name || specifier.startsWith(`${name}/`));

// Every bare import in the package must be a declared dependency, or consumers cannot resolve it.
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? files(resolve(directory, entry.name))
        : [resolve(directory, entry.name)],
    ),
  );
  return nested.flat();
}
const bare =
  /(?:\bfrom|\bimport)\s*\(?\s*["']((?:@[\w-][\w.-]*\/)?[\w-][\w.-]*(?:\/[\w./-]+)?)["']/g;
for (const file of (await files(dist)).filter((path) => path.endsWith('.js')))
  for (const [, specifier] of (await readFile(file, 'utf8')).matchAll(bare))
    if (!declared(specifier))
      throw new Error(`${file} imports ${specifier}, which is not a dependency or peer.`);

// Measure what a consumer's bundler ships for `import 'anniedrawing'`: the editor, its runtime
// dependencies, and the stylesheet. Lazy chunks and optional peers stay outside the budget.
const result = await build({
  configFile: false,
  logLevel: 'silent',
  publicDir: false,
  build: {
    write: false,
    target: 'es2022',
    minify: 'terser',
    lib: { entry: resolve(dist, 'index.js'), formats: ['es'], fileName: 'consumer' },
    rolldownOptions: { external: peers },
  },
});
const chunks = new Map(
  (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((file) => file.type === 'chunk')
    .map((chunk) => [chunk.fileName, chunk]),
);
const counted = new Set();
let total = 0;
const include = (name) => {
  if (counted.has(name)) return;
  counted.add(name);
  const chunk = chunks.get(name);
  total += gzipSync(chunk.code, { level: 9 }).byteLength;
  chunk.imports.forEach(include);
};
for (const chunk of chunks.values()) if (chunk.isEntry) include(chunk.fileName);
let styles = 0;
for (const file of await readdir(dist))
  if (file.endsWith('.css'))
    styles += gzipSync(await readFile(resolve(dist, file)), { level: 9 }).byteLength;
total += styles;
const budget = 100 * 1024;
console.log(
  `Main editor, ${runtime.length} runtime dependencies, and styles: ${(total / 1024).toFixed(2)} KiB gzip (budget ${budget / 1024} KiB).`,
);
if (runtime.length > 5)
  throw new Error(`The default bundle allows at most five runtime dependencies.`);
if (total >= budget)
  throw new Error(`Bundle exceeds the 100 KiB gzipped budget by ${total - budget} bytes.`);
