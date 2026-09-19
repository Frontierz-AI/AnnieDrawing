import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'anniedrawing-consumer-'));
try {
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', directory], {
    cwd: root,
    encoding: 'utf8',
  });
  const packages = JSON.parse(output);
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
    import { createBoard, type Op } from 'anniedrawing';
    import { createDoc } from 'anniedrawing/core';
    import { runTool, toolDefs } from 'anniedrawing/agent';
    const ops: Op[] = [
      {op:'page.add',page:{id:'p_consumer',name:'Consumer'}},
      {op:'add',page:'p_consumer',item:{kind:'rect'}},
    ];
    createDoc().apply(ops);
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
    const doc = createDoc();
    const result = await runTool(doc, 'board_apply', {ops:[{op:'page.add',page:{id:'p_consumer',name:'Consumer'}},{op:'add',page:'p_consumer',item:{id:'i_consumer',kind:'note',text:{value:'Installed from tarball'}}}]});
    assert.equal(result.ok,true);
    assert.equal(doc.toJSON().version,2);
    assert.equal(doc.toJSON().pages.find(page=>page.id==='p_consumer').items[0].id,'i_consumer');
    assert.equal('sheets' in doc.toJSON(),false);
    assert.equal(doc.get('i_consumer').text.value,'Installed from tarball');
    assert.equal(toolDefs.length,6);
    for (const path of ['anniedrawing','anniedrawing/core','anniedrawing/agent','anniedrawing/ui','anniedrawing/style.css']) assert(import.meta.resolve(path));
    assert(readFileSync(new URL(import.meta.resolve('anniedrawing/style.css')),'utf8').includes('.ad-root'));
    console.log('Tarball consumer passed: version2 pages, headless operations, six tools, CSS and all package exports.');
  `,
    ],
    { cwd: directory, stdio: 'inherit' },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
