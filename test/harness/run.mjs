// Browser tests: the built editor, framed and served the way OpenChamber does it.
//
//   node test/harness/run.mjs                run everything
//   node test/harness/run.mjs roundtrip      run the checks whose name contains "roundtrip"
//
// Each check opens a file in a fresh page. A failure prints what differed and the run exits 1.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { handoff, hostState, openFile, outDir, packageRoot, save, withHarness } from './lib.mjs';
import { styleCases } from './style-cases.mjs';

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

/** The one region where two texts differ: the lines between their common start and common end. */
const changedRegion = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  return { line: start + 1, before: a.slice(start, a.length - end), after: b.slice(start, b.length - end) };
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

/** Type `text` right before the first place `needle` appears in the document. */
const insertBefore = (frame, needle, text) =>
  frame.evaluate(
    ([word, typed]) => {
      const editor = document.querySelector('.ProseMirror').editor;
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text.includes(word)) at = pos + node.text.indexOf(word);
        return at < 0;
      });
      if (at < 0) return false;
      if (typed === '') editor.chain().focus().setTextSelection(at).run();
      else editor.chain().focus().insertContentAt(at, typed).run();
      return true;
    },
    [needle, text],
  );

/** A file's text in the form the editor loads it: front matter shown as a code block. */
const wrapForEditor = (text) => {
  const match = /^---[^\S\n]*\n([\s\S]*?)\n---[^\S\n]*\n?/.exec(text);
  if (!match) return text;
  const body = text.slice(match[0].length).replace(/^\n/, '');
  return ['```yaml', match[0].replace(/\s+$/, ''), '```', ...(body ? ['', body] : [])].join('\n');
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
        const region = changedRegion(content, saved);
        const detail = `at line ${region.line}: ${JSON.stringify(region.before.slice(0, 6))} -> ${JSON.stringify(region.after.slice(0, 6))}`;
        // The edited block may be rewritten in the editor's style: a Setext heading becomes
        // an ATX one, which is two lines turning into one. Nothing outside it may change.
        const setext = /^(=+|-+)$/.test(region.before[1] ?? '');
        expect(region.after.length === 1 && (region.before.length === 1 || (setext && region.before.length === 2)), `more than the edited line changed (${region.before.length} lines became ${region.after.length}) ${detail}`);
        expect(region.after.join('\n').includes('Zq'), `the changed lines do not hold the typed text ${detail}`);
      }),
    ),

  // --- An edit inside a block must keep the author's Markdown style -------------------------
  ...styleCases.map(({ name, needle, content, expected }) =>
    check(`style: ${name} keeps its style when a word is typed`, async ({ page, server }) => {
      const frame = await openFile(page, server, { path: 'docs/style.md', content });
      await settle(page, 300);
      expect(await insertBefore(frame, needle, 'Zq'), `the word ${JSON.stringify(needle)} is not in the document`);
      await settle(page);
      const saved = await save(page);
      const wanted = expected ?? content.replace(needle, `Zq${needle}`);
      expect(saved === wanted, `saved text differs: ${firstDifference(wanted, saved)}`);
      // And the saved text must open as the very document that is on screen.
      expect(await frame.evaluate((text) => window.visualMarkdownEditor.matchesDocument(text), wrapForEditor(saved)), 'the saved text does not load as the document on screen');
    }),
  ),

  check('style: a new item in a star list is written with a star', async ({ page, server }) => {
    const content = '* first item\n* second item\n\nEnd.\n';
    const frame = await openFile(page, server, { content });
    await frame.locator('.ProseMirror li').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('third item');
    await settle(page);
    const saved = await save(page);
    expect(saved === '* first item\n* second item\n* third item\n\nEnd.\n', `saved ${JSON.stringify(saved)}`);
  }),

  check('style: deleting a list item leaves the others as written', async ({ page, server }) => {
    const content = '1) first item\n2) second item\n3) third item\n';
    const frame = await openFile(page, server, { content });
    await frame.evaluate(() => {
      const editor = document.querySelector('.ProseMirror').editor;
      let range = null;
      editor.state.doc.descendants((node, pos) => {
        if (!range && node.type.name === 'listItem' && node.textContent === 'second item') range = { from: pos, to: pos + node.nodeSize };
        return !range;
      });
      editor.chain().focus().deleteRange(range).run();
    });
    await settle(page);
    const saved = await save(page);
    expect(saved === '1) first item\n2) third item\n', `saved ${JSON.stringify(saved)}`);
  }),

  check('style: a line break added with Shift+Enter is hard, the wrapped lines stay soft', async ({ page, server }) => {
    const content = 'First line of a wrapped paragraph\nsecond line of it\nthird line.\n';
    const frame = await openFile(page, server, { content });
    expect(await insertBefore(frame, 'of it', ''), 'text not found');
    await frame.evaluate(() => document.querySelector('.ProseMirror').editor.commands.setHardBreak());
    await settle(page);
    const saved = await save(page);
    // The space that was before "of it" is still there, followed by the two that make the break.
    expect(saved === 'First line of a wrapped paragraph\nsecond line   \nof it\nthird line.\n', `saved ${JSON.stringify(saved)}`);
  }),

  check('style: bold applied in a wrapped paragraph changes only those words', async ({ page, server }) => {
    const content = 'A paragraph wrapped by hand with _old emphasis_\nand a second line that gets bold words\nand a third.\n';
    const frame = await openFile(page, server, { content });
    await frame.evaluate(() => {
      const editor = document.querySelector('.ProseMirror').editor;
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text.includes('bold words')) at = pos + node.text.indexOf('bold words');
        return at < 0;
      });
      editor.chain().focus().setTextSelection({ from: at, to: at + 'bold words'.length }).toggleBold().run();
    });
    await settle(page);
    const saved = await save(page);
    expect(saved === 'A paragraph wrapped by hand with _old emphasis_\nand a second line that gets **bold words**\nand a third.\n', `saved ${JSON.stringify(saved)}`);
  }),

  check('style: edits in two blocks both keep their style, and undo leaves the file clean', async ({ page, server }) => {
    const content = '* one\n* two\n\nMiddle paragraph\nwrapped by hand.\n\n1) alpha\n2) beta\n';
    const frame = await openFile(page, server, { content });
    await insertBefore(frame, 'two', 'Zq');
    await settle(page, 500);
    await insertBefore(frame, 'beta', 'Zq');
    await settle(page);
    const saved = await save(page);
    expect(saved === '* one\n* Zqtwo\n\nMiddle paragraph\nwrapped by hand.\n\n1) alpha\n2) Zqbeta\n', `saved ${JSON.stringify(saved)}`);
    // After the save the same blocks are edited again.
    await insertBefore(frame, 'one', 'Zq');
    await settle(page);
    const again = await save(page);
    expect(again === '* Zqone\n* Zqtwo\n\nMiddle paragraph\nwrapped by hand.\n\n1) alpha\n2) Zqbeta\n', `second save ${JSON.stringify(again)}`);
    for (let index = 0; index < 6; index += 1) await page.keyboard.press('Control+z');
    await settle(page, 1800);
    expect((await handoff(page)) === content, `after undo the text is ${JSON.stringify(await handoff(page))}`);
  }),

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
    const label = await frame.evaluate(() => {
      const element = document.querySelector('.image-load-error:not([hidden])');
      return element ? { alt: element.dataset.alt, src: element.dataset.src, shown: getComputedStyle(element, '::after').content } : null;
    });
    expect(label?.alt === 'shot' && label?.src === './shot.png', `the placeholder does not carry the image's alt text and path: ${JSON.stringify(label)}`);
  }),

  check('images: pasting a picture changes nothing and says why', async ({ page, server }) => {
    const content = '# Paste\n\nText.\n';
    const frame = await openFile(page, server, { content });
    await frame.locator('.ProseMirror p').first().click();
    await frame.evaluate(() => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await settle(page, 1500);
    const state = await hostState(page);
    expect(state.toasts.some((toast) => /picture/i.test(toast.message)), `no message about the picture: ${JSON.stringify(state.toasts)}`);
    expect((await frame.locator('.export-settings-overlay, [role="dialog"]').count()) === 0, 'a dialog opened for a picture that cannot be saved');
    const saved = await save(page);
    expect(saved === content, `the paste changed the file: ${JSON.stringify(saved)}`);
  }),

  check('images: text copied with a picture of itself pastes as text', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: 'Start.\n' });
    await frame.locator('.ProseMirror p').first().click();
    await page.keyboard.press('End');
    await frame.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'clip.png', { type: 'image/png' }));
      data.setData('text/plain', ' Pasted words.');
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await settle(page);
    const saved = await save(page);
    expect(saved === 'Start. Pasted words.\n', `saved ${JSON.stringify(saved)}`);
    expect((await hostState(page)).toasts.length === 0, 'a message was shown for a plain text paste');
  }),

  check('images: a pasted picture path becomes a link to it from the document', async ({ page, server }) => {
    const frame = await openFile(page, server, { path: 'docs/guide.md', content: 'Start.\n', files: { 'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' } });
    await frame.locator('.ProseMirror p').first().click();
    await page.keyboard.press('End');
    await frame.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'D:\\Projects\\sample\\assets\\logo.svg');
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await settle(page);
    const saved = await save(page);
    expect(saved.includes('![logo](../assets/logo.svg)'), `saved ${JSON.stringify(saved)}`);
  }),

  // --- Opening: where the document starts ------------------------------------------------
  check('place: a new file opens at the top with no formatting button lit', async ({ page, server }) => {
    const content = `# Top\n\n${'Paragraph.\n\n'.repeat(60)}*The last line is italic.*\n`;
    const frame = await openFile(page, server, { content });
    await settle(page, 500);
    const info = await frame.evaluate(() => {
      const editor = document.querySelector('.ProseMirror').editor;
      return {
        from: editor.state.selection.from,
        scrollTop: document.scrollingElement.scrollTop,
        lit: [...document.querySelectorAll('.formatting-toolbar .toolbar-button.active')].filter((button) => getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
      };
    });
    expect(info.from <= 2, `the caret starts at ${info.from}, not at the top`);
    expect(info.scrollTop === 0, `the page starts scrolled to ${info.scrollTop}`);
    expect(info.lit === 0, `${info.lit} formatting buttons look pressed before anything is selected`);
    expect((await hostState(page)).dirty === false, 'opening marked the file changed');
  }),

  check('place: the scroll position comes back after the app reloads the page', async ({ page, server }) => {
    const content = `# Long\n\n${Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n')}\n`;
    const frame = await openFile(page, server, { content });
    await frame.evaluate(() => document.scrollingElement.scrollTo(0, 1800));
    await settle(page, 1600);
    const stored = (await hostState(page)).storage;
    expect(Object.keys(stored).length === 1, `expected one stored entry, got ${JSON.stringify(Object.keys(stored))}`);
    await page.evaluate((text) => window.harness.externalChange(text), content);
    const { waitForEditor } = await import('./lib.mjs');
    const next = await waitForEditor(page);
    await settle(page, 900);
    const scrollTop = await next.evaluate(() => document.scrollingElement.scrollTop);
    expect(Math.abs(scrollTop - 1800) < 40, `scrolled to ${scrollTop} after the reload, expected about 1800`);
    expect((await hostState(page)).dirty === false, 'restoring the place marked the file changed');
  }),

  // --- Working with the chat and the project ---------------------------------------------
  check('chat: the @ button puts the caret\'s lines into the chat box', async ({ page, server }) => {
    const content = '---\ntitle: Plan\n---\n\n# Plan\n\nFirst paragraph.\n\n- item one\n- item two\n\nLast paragraph here.\n';
    const frame = await openFile(page, server, { path: 'docs/plan.md', content });
    await frame.locator('.ProseMirror li').nth(1).click();
    await frame.locator('.formatting-toolbar .copy-reference-button').click();
    await settle(page, 700);
    let state = await hostState(page);
    expect(state.composed.length === 1, `expected one compose call, got ${JSON.stringify(state.composed)}`);
    expect(state.composed[0].text === '@docs/plan.md#L10 ' && state.composed[0].mode === 'append', `composed ${JSON.stringify(state.composed[0])}`);
    expect(state.saves === 0, 'an unchanged file was saved');

    // With unsaved changes the file is saved first, so the lines match what the agent reads.
    await typeAtEndOf(page, frame, '.ProseMirror > p', ' More.');
    await frame.locator('.ProseMirror > p').last().click();
    await frame.locator('.formatting-toolbar .copy-reference-button').click();
    await settle(page, 900);
    state = await hostState(page);
    expect(state.composed.length === 2 && state.composed[1].text === '@docs/plan.md#L12 ', `composed ${JSON.stringify(state.composed)}`);
    expect(state.saves === 1 && state.disk.includes('First paragraph. More.'), `the changed file was not saved first (saves: ${state.saves})`);
    const title = await frame.locator('.formatting-toolbar .copy-reference-button').getAttribute('title');
    expect(/chat/i.test(title ?? ''), `the button is titled ${JSON.stringify(title)}`);
  }),

  check('links: the link dialog finds project files and writes the path from the document', async ({ page, server }) => {
    const frame = await openFile(page, server, {
      path: 'docs/guides/start.md',
      content: '# Start\n\nSee the setup notes.\n',
      files: { 'README.md': '# r', 'docs/setup.md': '# s', 'docs/guides/setup-advanced.md': '# a', 'node_modules/pkg/setup.md': '# no', 'src/app.ts': '' },
    });
    await frame.locator('.ProseMirror p').first().click();
    await frame.locator('.toolbar-button[aria-label^="Insert/edit link"]').click();
    await frame.locator('#link-mode-file').check();
    await frame.locator('#link-url-input').fill('setup');
    await frame.waitForSelector('.link-dialog-autocomplete-item-file', { timeout: 8000 });
    const results = await frame.evaluate(() => [...document.querySelectorAll('.link-dialog-autocomplete-item-file .link-dialog-autocomplete-item-path')].map((element) => element.textContent));
    expect(JSON.stringify(results) === JSON.stringify(['../setup.md', 'setup-advanced.md']), `results were ${JSON.stringify(results)}`);
  }),

  check('audit: a link to a missing file is reported, a link to a real one is not', async ({ page, server }) => {
    const frame = await openFile(page, server, {
      path: 'docs/index.md',
      content: '# Index\n\n[Real](guide.md) and [Missing](nowhere.md) and [Web](https://example.com).\n',
      files: { 'docs/guide.md': '# g' },
    });
    await frame.locator('.formatting-toolbar .audit-button').click();
    await frame.waitForSelector('.audit-overlay-item', { timeout: 8000 });
    const issues = await frame.evaluate(() => [...document.querySelectorAll('.audit-overlay-item')].map((element) => element.textContent.replace(/\s+/g, ' ').trim()));
    expect(issues.length === 1 && issues[0].includes('nowhere.md'), `issues were ${JSON.stringify(issues)}`);
  }),

  check('copy: the copy buttons reach the clipboard through the app', async ({ page, server }) => {
    const frame = await openFile(page, server, { content: '# Copy\n\n```js\nconst a = 1;\n```\n' });
    await frame.locator('pre').first().hover();
    await frame.locator('.code-block-copy-button, pre button, .code-copy-button').first().click();
    await settle(page, 500);
    const state = await hostState(page);
    expect(state.clipboard.some((text) => text.includes('const a = 1;')), `clipboard got ${JSON.stringify(state.clipboard)}`);
  }),

  check('edit: a task box cannot be ticked in a read-only file', async ({ page, server }) => {
    const content = '- [ ] open task\n- [x] done task\n';
    const frame = await openFile(page, server, { content, readOnly: true });
    await frame.locator('input[type="checkbox"]').first().click({ force: true });
    await settle(page);
    expect((await handoff(page)) === content, 'ticking a box changed a read-only file');
    expect(await frame.locator('#vm-readonly').isVisible(), 'the read-only label is not shown');
  }),

  check('edit: ticking a task box changes only that line', async ({ page, server }) => {
    const content = '# Tasks\n\n* [ ] star task\n* [x] done\n\n1. [ ] numbered\n';
    const frame = await openFile(page, server, { content });
    await frame.locator('input[type="checkbox"]').first().click();
    await settle(page);
    const saved = await save(page);
    const changed = changedLines(content, saved);
    expect(changed.length === 1 && changed[0].after === '* [x] star task', `changed lines: ${JSON.stringify(changed)}`);
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
