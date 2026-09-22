import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function packManifest(output) {
  for (const match of [...output.matchAll(/^[[{]/gm)].reverse()) {
    try {
      return JSON.parse(output.slice(match.index));
    } catch {}
  }
  throw new Error(`npm pack did not print JSON:\n${output}`);
}
const directory = await mkdtemp(join(tmpdir(), 'anniedrawing-consumer-'));
try {
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', directory], {
    cwd: root,
    encoding: 'utf8',
  });
  const packages = packManifest(output);
  const [{ filename }] = Array.isArray(packages) ? packages : Object.values(packages);
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, filename)],
    { cwd: directory, stdio: 'pipe' },
  );
  await writeFile(
    join(directory, 'consumer.ts'),
    `
    import { createBoard, defineKind, registerKind, kindsSince, type Op } from 'anniedrawing';
    import { createDoc, CATALOG_VERSION, LIMITS } from 'anniedrawing/core';
    import { runTool, toolDefs } from 'anniedrawing/agent';
    const ops: Op[] = [
      {op:'page.add',page:{id:'p_consumer',name:'Consumer'}},
      {op:'add',page:'p_consumer',item:{kind:'rect'}},
    ];
    createDoc().apply(ops);
    void LIMITS.maxHistory;
    void CATALOG_VERSION;
    void kindsSince().kinds;
    void registerKind(defineKind({ kind: 'consumer-badge' }));
    const board = createBoard(document.createElement('div'));
    board.apply(ops);
    board.setPage('p_consumer');
    const currentPage: string = board.pageId;
    void board.read('page').pages;
    void currentPage;
    void runTool(board,'board_describe',{});
    void toolDefs[0].inputSchema;
    board.destroy();
  `,
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      'consumer.ts',
    ],
    { cwd: directory, stdio: 'inherit' },
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.ts',
    ],
    { cwd: directory, stdio: 'inherit' },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { createDoc } from 'anniedrawing/core';
    import { toolDefs, runTool } from 'anniedrawing/agent';
    import { effect } from '@preact/signals-core';
    const doc = createDoc();
    const result = await runTool(doc, 'board_apply', {ops:[{op:'page.add',page:{id:'p_consumer',name:'Consumer'}},{op:'add',page:'p_consumer',item:{id:'i_consumer',kind:'note',text:{value:'Installed from tarball'}}}]});
    assert.equal(result.ok,true);
    assert.equal(doc.toJSON().version,2);
    assert.equal(doc.toJSON().pages.find(page=>page.id==='p_consumer').items[0].id,'i_consumer');
    assert.equal('sheets' in doc.toJSON(),false);
    assert.equal(doc.get('i_consumer').text.value,'Installed from tarball');
    assert.equal(toolDefs.length,6);
    // The package imports its runtime dependencies, so the host's signals runtime tracks board signals.
    const seen = [];
    const stop = effect(() => { seen.push(doc.itemSignal('i_consumer').value?.x); });
    doc.apply([{op:'set',id:'i_consumer',patch:{x:42}}]);
    stop();
    assert.equal(seen.at(-1),42);
    for (const path of ['anniedrawing','anniedrawing/core','anniedrawing/agent','anniedrawing/ui','anniedrawing/fellow','anniedrawing/style.css']) assert(import.meta.resolve(path));
    assert(readFileSync(new URL(import.meta.resolve('anniedrawing/style.css')),'utf8').includes('.ad-root'));
    console.log('Tarball consumer passed: version2 pages, headless operations, six tools, shared signals, CSS and all package exports.');
  `,
    ],
    { cwd: directory, stdio: 'inherit' },
  );
  // CommonJS hosts reach the ES module entries through the `default` condition.
  execFileSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const { createDoc } = require('anniedrawing/core');
    const { toolDefs } = require('anniedrawing/agent');
    const { version } = require('anniedrawing/package.json');
    assert.equal(createDoc().apply([{op:'add',item:{kind:'rect',text:'Required'}}]).ok,true);
    assert.equal(toolDefs.length,6);
    assert.match(version,/^\\d+\\.\\d+\\.\\d+/);
    console.log('CommonJS consumer passed: require() of core, agent, and package.json.');
  `,
    ],
    { cwd: directory, stdio: 'inherit' },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
