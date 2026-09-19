import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = [
  ['docs/api.md', 'api.md'],
  ['docs/agents.md', 'agents.md'],
  ['docs/format.md', 'format.md'],
  ['docs/extensions.md', 'extensions.md'],
  ['docs/board-js.md', 'board-js.md'],
  ['docs/releasing.md', 'releasing.md'],
  ['examples/mcp/README.md', 'mcp.md'],
  ['AGENTS.md', 'agents-repository.md'],
  ['DECISIONS.md', 'decisions.md'],
  ['CONTRIBUTING.md', 'contributing.md'],
  ['SECURITY.md', 'security.md'],
  ['CODE_OF_CONDUCT.md', 'code-of-conduct.md'],
  ['NOTICE', 'notice.txt'],
  ['LICENSE', 'license.txt'],
];
await mkdir(new URL('public/docs/', root), { recursive: true });
for (const [source, destination] of files) {
  let text = await readFile(new URL(source, root), 'utf8');
  text = text
    .replaceAll('../examples/mcp/README.md', 'mcp.md')
    .replaceAll('../SECURITY.md', 'security.md');
  for (const [original, served] of files) text = text.replaceAll(`](${original})`, `](${served})`);
  await writeFile(new URL(`public/docs/${destination}`, root), text);
}
const full = await readFile(new URL('docs/board-js.md', root), 'utf8');
await writeFile(new URL('llms-full.txt', root), full);
await writeFile(new URL('public/docs/llms-full.txt', root), full);
let compact = await readFile(new URL('llms.txt', root), 'utf8');
for (const [original, served] of files)
  compact = compact.replaceAll(`](${original})`, `](${served})`);
await writeFile(new URL('public/docs/llms.txt', root), compact);
console.log('Synced public reference documents and board JavaScript AI guide.');
