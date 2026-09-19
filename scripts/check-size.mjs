import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const visited = new Set();
let total = 0;
async function include(path) {
  if (visited.has(path)) return;
  if (!path.startsWith(`${root}/`)) throw new Error(`Import leaves package dist: ${path}`);
  visited.add(path);
  const content = await readFile(path);
  total += gzipSync(content, { level: 9 }).byteLength;
  if (!path.endsWith('.js')) return;
  const imports = /(?:\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
  for (const match of content.toString().matchAll(imports))
    await include(resolve(dirname(path), match[2]));
}
await include(resolve(root, 'index.js'));
for (const file of await readdir(root))
  if (file.endsWith('.css')) await include(resolve(root, file));
const budget = 100 * 1024;
console.log(
  `Main editor and styles: ${(total / 1024).toFixed(2)} KiB gzip across ${visited.size} files (budget ${budget / 1024} KiB).`,
);
if (total >= budget)
  throw new Error(
    `Bundle exceeds the 100 KiB gzipped budget by ${total - budget} bytes. Files: ${[...visited].map((file) => relative(root, file)).join(', ')}`,
  );
