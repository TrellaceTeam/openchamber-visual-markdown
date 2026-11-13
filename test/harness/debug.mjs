// Scratch: capture the editor's "reference for AI" message for a document, to replay in a unit test.
// Usage: node test/harness/debug.mjs <out.json>
import { writeFileSync } from 'node:fs';
import { hostState, openFile, withHarness } from './lib.mjs';

const out = process.argv[2];

await withHarness(async ({ server, newHost }) => {
  const { page } = await newHost();
  const content = '---\ntitle: Plan\n---\n\n# Plan\n\nFirst paragraph.\n\n- item one\n- item two\n\nLast paragraph here.\n';
  const frame = await openFile(page, server, { path: 'docs/plan.md', content });
  await frame.locator('.ProseMirror li').nth(1).click();
  await frame.evaluate(() => {
    const api = window.acquireVsCodeApi();
    const original = api.postMessage;
    window.__captured = [];
    api.postMessage = (message) => {
      if (message && message.type === 'copyReferenceForAi') window.__captured.push(JSON.parse(JSON.stringify(message)));
      return original(message);
    };
  });
  await frame.locator('.formatting-toolbar .copy-reference-button').click();
  await page.waitForTimeout(700);
  const captured = await frame.evaluate(() => window.__captured);
  writeFileSync(out, JSON.stringify({ content, message: captured[0] }, null, 1));
  console.log('captured', captured.length, 'composed', JSON.stringify((await hostState(page)).composed));
  console.log(JSON.stringify(captured[0]).slice(0, 1800));
});
