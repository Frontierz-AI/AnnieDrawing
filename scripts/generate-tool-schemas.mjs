import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { toJsonSchema } from '@valibot/to-json-schema';
import { format, resolveConfig } from 'prettier';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = new URL('../src/agent/toolInputSchemas.generated.json', import.meta.url);
// Bundle the validators in memory so generation also works on Node 22.12, without
// relying on native TypeScript execution or importing the generated artifact itself.
const result = await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'silent',
  build: {
    write: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('../src/agent/toolSchemas.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'tool-schemas',
    },
  },
});
const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
if (output.length !== 1 || output[0].type !== 'chunk' || !output[0].isEntry)
  throw new Error('Tool schema generation requires one self-contained module.');
const { toolSchemas, snapshotDefaults } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);
const schemas = Object.fromEntries(
  Object.entries(toolSchemas).map(([name, schema]) => {
    const inputSchema = toJsonSchema(schema, { errorMode: 'ignore' });
    if (name === 'board_snapshot') {
      for (const [property, value] of Object.entries(snapshotDefaults))
        inputSchema.properties[property] = {
          ...inputSchema.properties[property],
          default: value,
        };
    }
    return [name, inputSchema];
  }),
);
const text = await format(JSON.stringify(schemas), {
  ...(await resolveConfig(fileURLToPath(target))),
  parser: 'json',
});
let previous;
try {
  previous = await readFile(target, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (process.argv.includes('--check')) {
  if (previous !== text)
    throw new Error('Generated tool schemas are stale. Run npm run generate:schemas.');
  console.log('Generated tool schemas match all six runtime validators.');
} else if (previous !== text) {
  await writeFile(target, text);
  console.log('Generated tool input schemas.');
} else {
  console.log('Generated tool input schemas are current.');
}
