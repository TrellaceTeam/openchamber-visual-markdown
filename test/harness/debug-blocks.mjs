// Scratch: show what the editor reports for each block of a text, and what it writes after
// "Zq" is typed before a word.
// Usage: node test/harness/debug-blocks.mjs <file.md | --text "markdown"> <needle>
import { readFileSync } from 'node:fs';
import { openFile, save, withHarness } from './lib.mjs';

const [first, second, third] = process.argv.slice(2);
const content = (first === '--text' ? second.replace(/\\n/g, '\n') : readFileSync(first, 'utf8')).replace(/\r\n/g, '\n');
const needle = first === '--text' ? third : second;

await withHarness(async ({ server, newHost }) => {
  const { page, problems } = await newHost();
  page.on('console', (message) => {
    if (/Visual Markdown|MD4H/.test(message.text())) console.log(`[${message.type()}]`, message.text().slice(0, 400));
  });
  const frame = await openFile(page, server, { path: 'docs/probe.md', content });
  await page.waitForTimeout(500);
  const blocks = await frame.evaluate(() => window.visualMarkdownEditor.describeBlocks());
  console.log('blocks:');
  for (const block of blocks) console.log('  source    ', JSON.stringify(block.source), '\n  serialized', JSON.stringify(block.serialized));
  if (needle) {
    const result = await frame.evaluate((word) => {
      const editor = document.querySelector('.ProseMirror').editor;
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text.includes(word)) at = pos + node.text.indexOf(word);
        return at < 0;
      });
      editor.chain().focus().insertContentAt(at, 'Zq').run();
      return at;
    }, needle);
    await page.waitForTimeout(900);
    const saved = await save(page);
    console.log('typed at', result);
    console.log('saved:', JSON.stringify(saved));
    const check = await frame.evaluate((text) => window.visualMarkdownEditor.matchesDocument(text), saved);
    console.log('saved text loads as the document on screen:', check);
  }
  if (problems.length) console.log('problems:', problems.filter((p) => !/404/.test(p)).slice(0, 4));
});
