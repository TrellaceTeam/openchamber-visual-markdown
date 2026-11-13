// Scratch: print the Markdown tokens the editor's lexer makes for a corpus file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFile, packageRoot, withHarness } from './lib.mjs';

const name = process.argv[2];
const content = readFileSync(join(packageRoot, 'test', 'corpus', name), 'utf8').replace(/\r\n/g, '\n');

await withHarness(async ({ server, newHost }) => {
  const { page } = await newHost();
  const frame = await openFile(page, server, { path: `docs/${name}`, content });
  await page.waitForTimeout(500);
  const info = await frame.evaluate((text) => {
    const editor = document.querySelector('.ProseMirror').editor;
    const manager = editor.markdown ?? editor.storage?.markdown;
    const lexer = manager.createLexer ? manager.createLexer() : null;
    const tokens = lexer ? lexer.lex(text) : manager.instance.lexer(text);
    return {
      managerKeys: Object.keys(manager),
      protoKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(manager)),
      hasInstance: Boolean(manager.instance),
      tokens: tokens.map((token) => `${token.type}:${JSON.stringify(token.raw)}`),
    };
  }, content);
  console.log('manager own keys:', info.managerKeys.join(', '));
  console.log('manager proto:', info.protoKeys.join(', '));
  console.log('has instance:', info.hasInstance);
  console.log(info.tokens.join('\n'));
});
