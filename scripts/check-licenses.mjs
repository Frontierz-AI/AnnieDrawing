import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const approved = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'OFL-1.1',
  '(MPL-2.0 OR Apache-2.0)',
  'MPL-2.0',
]);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (Object.keys(manifest.dependencies ?? {}).length > 5)
  throw new Error('The core package exceeds its five runtime dependency budget.');
let count = 0;
for (const name of ['package-lock.json', 'examples/mcp/package-lock.json']) {
  const lock = JSON.parse(await readFile(new URL(name, root), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.link) continue;
    count++;
    if (!approved.has(entry.license))
      throw new Error(
        `${name}: ${path}@${entry.version} has unreviewed license ${JSON.stringify(entry.license)}. Review its actual license before adding an exception.`,
      );
  }
}
console.log(
  `License check passed: ${count} locked packages; ${Object.keys(manifest.dependencies).length} direct runtime dependencies. DOMPurify uses the Apache-2.0 option; OFL applies to demo fonts only; MPL-2.0 applies to Vite's Lightning CSS toolchain.`,
);
