// Scratch: open a corpus file, show the document's top-level blocks, make the "Zq" edit and
// print what a save would write.
// Usage: node test/harness/debug.mjs <corpus-file-name> [noedit]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostState, openFile, packageRoot, save, withHarness } from './lib.mjs';

const name = process.argv[2];
const edit = process.argv[3] !== 'noedit';
const content = readFileSync(join(packageRoot, 'test', 'corpus', name), 'utf8').replace(/\r\n/g, '\n');

await withHarness(async ({ server, newHost }) => {
  const { page, problems } = await newHost();
  const frame = await openFile(page, server, { path: `docs/${name}`, content });
  await page.waitForTimeout(600);
  const blocks = await frame.evaluate(() => {
    const editor = document.querySelector('.ProseMirror').editor;
    return editor.getJSON().content.map((node) => `${node.type}${node.content ? '' : ' (empty)'}`);
  });
  console.log('blocks:', blocks.join(' | '));
  if (edit) {
    await frame.locator('.ProseMirror > :is(h1, h2, h3, h4, h5, h6, p)').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.type('Zq');
    await page.waitForTimeout(900);
  }
  const saved = await save(page);
  console.log('--- original');
  console.log(JSON.stringify(content));
  console.log('--- saved');
  console.log(JSON.stringify(saved));
  console.log('dirty:', (await hostState(page)).dirty, 'problems:', problems.filter((p) => !/404/.test(p)).slice(0, 3));
});
