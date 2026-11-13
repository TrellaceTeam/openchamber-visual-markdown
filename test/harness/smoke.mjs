// Open one Markdown file in the framed editor, take a screenshot, and print what went wrong.
// Usage: node test/harness/smoke.mjs [file.md] [light|dark] [width]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { editorFrame, hostState, openFile, outDir, withHarness } from './lib.mjs';

const sample = process.argv[2];
const theme = process.argv[3] === 'dark' ? 'dark' : 'light';
const width = Number(process.argv[4] ?? 1100);
const content = sample
  ? readFileSync(sample, 'utf8').replace(/\r\n/g, '\n')
  : '# Hello\n\nA paragraph with **bold**, *italic* and `code`.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

await withHarness(async ({ server, newHost }) => {
  const { page, problems } = await newHost({ width, height: 900 });
  try {
    const frame = await openFile(page, server, { content, theme });
    await page.waitForTimeout(1500);
    const info = await frame.evaluate(() => ({
      blocks: document.querySelector('.ProseMirror')?.children.length ?? 0,
      toolbarButtons: document.querySelectorAll('.formatting-toolbar .toolbar-button').length,
      bodyClass: document.body.className,
      text: (document.querySelector('.ProseMirror')?.textContent ?? '').slice(0, 120),
    }));
    console.log('editor:', JSON.stringify(info));
  } catch (error) {
    console.log('FAILED:', error.message);
    const frame = editorFrame(page);
    if (frame) console.log('frame body:', (await frame.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 400));
  }
  const state = await hostState(page);
  console.log('host:', JSON.stringify({ hellos: state.hellos, dirty: state.dirty, changes: state.changes, toasts: state.toasts, log: [...new Set(state.log)] }));
  if (problems.length > 0) console.log('problems:\n  ' + [...new Set(problems)].slice(0, 20).join('\n  '));
  const shot = join(outDir, `smoke-${theme}-${width}.png`);
  await page.screenshot({ path: shot });
  console.log('shot:', shot);
});
