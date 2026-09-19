import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (!entry.name.endsWith('.d.ts')) continue;
    let text = await readFile(path, 'utf8');
    text = text.replace(/^import\s+['"][^'"]+\.css['"];\s*\n/gm, '');
    const specifiers = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"]))(\.{1,2}\/[^'"]+)\2/g;
    for (const match of [...text.matchAll(specifiers)].reverse()) {
      const target = match[3];
      if (extname(target)) continue;
      const absolute = resolve(dirname(path), target);
      const suffix = (await exists(`${absolute}.d.ts`))
        ? '.js'
        : (await exists(join(absolute, 'index.d.ts')))
          ? '/index.js'
          : undefined;
      if (!suffix) throw new Error(`Cannot resolve declaration import ${target} in ${path}.`);
      const start = match.index + match[1].length;
      text = text.slice(0, start) + target + suffix + text.slice(start + target.length);
    }
    await writeFile(path, text);
  }
}
await visit(root);
console.log('Declaration imports finalized for ESM Bundler and NodeNext consumers.');
