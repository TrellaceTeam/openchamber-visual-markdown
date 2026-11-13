// Browser tests: the built editor, framed and served the way OpenChamber does it.
//
//   node test/harness/run.mjs                run everything
//   node test/harness/run.mjs roundtrip      run the checks whose name contains "roundtrip"
//
// Each check opens a file in a fresh page. A failure prints what differed and the run exits 1.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { handoff, hostState, openFile, outDir, packageRoot, save, withHarness } from './lib.mjs';

const filter = process.argv[2] ?? '';
const corpusDir = join(packageRoot, 'test', 'corpus');
const corpus = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => ({ name, content: readFileSync(join(corpusDir, name), 'utf8').replace(/\r\n/g, '\n') }));

const results = [];
const check = (name, body) => ({ name, body });

/** Describe the first difference between two texts, for a failure message. */
const firstDifference = (expected, actual) => {
  if (expected === actual) return null;
  const a = expected.split('\n');
  const b = actual.split('\n');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      return `line ${index + 1}: expected ${JSON.stringify(a[index])}, got ${JSON.stringify(b[index])} (${a.length} lines expected, ${b.length} got)`;
    }
  }
  return 'texts differ';
};

/** Lines that changed between two texts, as [before, after] pairs by line number. */
const changedLines = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const changed = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) changed.push({ line: index + 1, before: a[index], after: b[index] });
  }
  return changed;
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** Put the caret at the end of the first element matching `selector` and type. */
const typeAtEndOf = async (page, frame, selector, text) => {
  const target = frame.locator(selector).first();
  await target.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

/** Wait until the host has been told about a change (the editor sends edits on a short delay). */
const settle = (page, ms = 900) => page.waitForTimeout(ms);

const checks = [
  // --- Opening a file must never change it ------------------------------------------------
  ...corpus.map(({ name, content }) =>
    check(`roundtrip: ${name} opens and saves byte for byte`, async ({ page, server }) => {
      await openFile(page, server, { path: `docs/${name}`, content });
      await settle(page, 700);
      const state = await hostState(page);
      expect(state.dirty === false, 'the file was marked as changed just by opening it');
      const viaHandoff = await handoff(page);
      expect(viaHandoff === content, `source view text differs: ${firstDifference(content, viaHandoff)}`);
      const saved = await save(page);
      expect(saved === content, `saved text differs: ${firstDifference(content, saved)}`);
    }),
  ),

  // --- A small edit must not rewrite the rest of the file ----------------------------------
  ...corpus
    .filter(({ content }) => content.trim() !== '')
    .map(({ name, content }) =>
      check(`locality: ${name} keeps every other line when one word is added`, async ({ page, server }) => {
        const frame = await openFile(page, server, { path: `docs/${name}`, content });
        // The first heading or paragraph that is a direct child of the document.
        const target = frame.locator('.ProseMirror > :is(h1, h2, h3, h4, h5, h6, p)').first();
        await target.click();
        await page.keyboard.press('Home');
        await page.keyboard.type('Zq');
        await settle(page);
        expect((await hostState(page)).dirty === true, 'typing did not mark the file changed');
        const saved = await save(page);
        const changed = changedLines(content, saved);
        const detail = changed.slice(0, 4).map((entry) => `line ${entry.line}: ${JSON.stringify(entry.before)} -> ${JSON.stringify(entry.after)}`).join('; ');
        expect(changed.length === 1, `expected one changed line, got ${changed.length}: ${detail}`);
        expect(changed[0].after.includes('Zq'), `the changed line does not hold the typed text: ${detail}`);
      }),
    ),

  // --- Editing ---------------------------------------------------------------------------
  check('edit: typing marks the file changed, and a save writes only that line', async ({ page, server }) => {
    const content = '# Title\n\nFirst paragraph.\n\n* star bullet\n* second\n\nLast paragraph.\n';
    const frame = await openFile(page, server, { content });
    await typeAtEndOf(page, frame, '.ProseMirror p', ' Added');
    await settle(page);
    expect((await hostState(page)).dirty === true, 'typing did not mark the file changed');
    const saved = await save(page);
    const changed = changedLines(content, saved);
    expect(changed.length === 1 && changed[0].after === 'First paragraph. Added', `expected one changed line, got ${JSON.stringify(changed)}`);
    await settle(page, 300);
    expect((await hostState(page)).dirty === false, 'the file still shows as changed after a save');
  }),

  check('edit: undo back to the opened text leaves the file unchanged', async ({ page, server }) => {
    const content = '# Title\n\nSome text here.\n\n1. one\n2. two\n';
    const frame = await openFile(page, server, { content });
    await typeAtEndOf(page, frame, '.ProseMirror p', ' more');
    await settle(page);
    expect((await hostState(page)).dirty === true, 'typing did not mark the file changed');
    for (let index = 0; index < 8; index += 1) await page.keyboard.press('Control+z');
    await settle(page, 1800);
    const state = await hostState(page);
    expect(state.dirty === false, 'the file is still marked changed after undoing everything');
    expect((await handoff(page)) === content, 'the text is not back to what was opened');
  }),

  check('edit: Ctrl+S inside the editor saves through OpenChamber', async ({ page, server }) => {
    const content = 'Hello\n';
    const frame = await openFile(page, server, { content });
    await typeAtEndOf(page, frame, '.ProseMirror p', ' world');
    await page.keyboard.press('Control+s');
    await settle(page, 1200);
    const state = await hostState(page);
    expect(state.saves === 1, `expected one save, got ${state.saves}`);
    expect(state.disk === 'Hello world\n', `saved ${JSON.stringify(state.disk)}`);
    expect(state.dirty === false, 'still marked changed after Ctrl+S');
  }),

  check('edit: the last keystrokes are in a save made right after typing', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: 'Start\n' });
    await typeAtEndOf(page, frame, '.ProseMirror p', ' one');
    await settle(page, 700);
    await page.keyboard.type(' two');
    // No wait: the editor has not sent this edit yet.
    const saved = await save(page);
    expect(saved === 'Start one two\n', `saved ${JSON.stringify(saved)}`);
  }),

  check('edit: a file that is read only cannot be changed', async ({ page, server }) => {
    const content = '# Locked\n\nText.\n';
    const frame = await openFile(page, server, { content, readOnly: true });
    await frame.locator('.ProseMirror p').first().click();
    await page.keyboard.type('nope');
    await settle(page);
    expect((await hostState(page)).dirty === false, 'a read-only file was marked changed');
    expect((await handoff(page)) === content, 'a read-only file changed');
    expect(await frame.locator('.formatting-toolbar').isHidden(), 'the formatting toolbar shows for a read-only file');
  }),

  check('reload: a change on disk shows up after the app reloads the page', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: '# One\n' });
    expect((await frame.locator('.ProseMirror h1').innerText()) === 'One', 'first text missing');
    await page.evaluate(() => window.harness.externalChange('# Two\n\nNew line.\n'));
    const { waitForEditor } = await import('./lib.mjs');
    const next = await waitForEditor(page);
    await settle(page, 400);
    expect((await next.locator('.ProseMirror h1').innerText()) === 'Two', 'the new text did not load');
    expect((await hostState(page)).dirty === false, 'marked changed after a reload');
  }),

  // --- Rendering -------------------------------------------------------------------------
  check('render: diagrams, math and highlighted code draw inside the sandbox', async ({ page, server }) => {
    const content = [
      '# Rich blocks',
      '',
      '```mermaid',
      'graph TD',
      '  A[Start] --> B[End]',
      '```',
      '',
      'Inline math $e^{i\\pi} + 1 = 0$ here.',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx',
      '$$',
      '',
      '```js',
      'const answer = 42;',
      '```',
      '',
    ].join('\n');
    const frame = await openFile(page, server, { content });
    await frame.waitForSelector('.mermaid-wrapper svg, .mermaid svg', { timeout: 15000 });
    expect((await frame.locator('.katex').count()) >= 2, 'math did not render');
    await frame.waitForFunction(() => document.querySelector('pre code [class*="hljs-"], pre code span[style], pre .hljs-keyword') !== null, null, { timeout: 15000 });
    expect((await hostState(page)).dirty === false, 'rendering marked the file changed');
  }),

  check('theme: the page follows the app from light to dark', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: '# Theme\n\nText.\n' });
    const background = () => frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();
    await page.evaluate(() => window.harness.setTheme('dark'));
    await settle(page, 300);
    const dark = await background();
    expect(light === 'rgb(250, 249, 247)', `light background is ${light}`);
    expect(dark === 'rgb(14, 12, 11)', `dark background is ${dark}`);
    expect(await frame.evaluate(() => document.body.classList.contains('vscode-dark')), 'the editor was not told it is dark');
  }),

  check('language: the toolbar is translated when the app is', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: '# Hola\n', locale: 'es' });
    const titles = await frame.evaluate(() => [...document.querySelectorAll('.formatting-toolbar .toolbar-button')].map((button) => button.title));
    expect(titles.some((title) => /negrita/i.test(title)), `no Spanish title found in ${JSON.stringify(titles.slice(0, 6))}`);
  }),

  check('links: Ctrl+click opens a web link through the app', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: 'See [the site](https://example.com/page) now.\n' });
    await frame.locator('a.markdown-link').first().click({ modifiers: ['Control'] });
    await settle(page, 400);
    const state = await hostState(page);
    expect(state.opened.includes('https://example.com/page'), `opened ${JSON.stringify(state.opened)}`);
  }),

  check('images: a local SVG shows, and a local PNG says why it cannot', async ({ page, server }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#b35017"/></svg>';
    const frame = await openFile(page, server, {
      path: 'docs/guide.md',
      content: '![logo](../assets/logo.svg)\n\n![shot](./shot.png)\n',
      files: { 'assets/logo.svg': svg },
    });
    await frame.waitForFunction(() => {
      const image = document.querySelector('img[data-markdown-src="../assets/logo.svg"]');
      return image instanceof HTMLImageElement && image.naturalWidth === 120;
    }, null, { timeout: 10000 });
    await frame.waitForSelector('.image-load-failed', { timeout: 10000 });
    expect((await hostState(page)).dirty === false, 'images marked the file changed');
  }),
];

const selected = checks.filter(({ name }) => name.includes(filter));
await withHarness(async ({ server, newHost }) => {
  for (const { name, body } of selected) {
    const { page, problems } = await newHost();
    const started = Date.now();
    try {
      await body({ page, server });
      // A web image from a site the person has not approved is refused by the sandbox. That
      // is the design, and the editor shows its "could not load" state for it.
      const noise = problems.filter((text) => !/favicon|status of 404|violates the following Content Security Policy directive: "img-src/.test(text));
      if (noise.length > 0) throw new Error(`the page reported errors: ${[...new Set(noise)].slice(0, 3).join(' | ')}`);
      results.push({ name, ok: true, ms: Date.now() - started });
      console.log(`ok    ${name}`);
    } catch (error) {
      const shot = join(outDir, `fail-${results.length}.png`);
      await page.screenshot({ path: shot }).catch(() => undefined);
      results.push({ name, ok: false, ms: Date.now() - started, error: error.message, shot });
      console.log(`FAIL  ${name}\n      ${error.message}`);
    }
    await page.close();
  }
});

const failed = results.filter((result) => !result.ok);
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
