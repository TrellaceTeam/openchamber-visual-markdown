// How the editor holds up on big files: time to open, to type, and to save, and whether the
// save still changes only the typed word.
// Usage: node test/harness/perf.mjs [size in KB, default 100 300 1000]
import { hostState, openFile, save, withHarness } from './lib.mjs';

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const targets = sizes.length > 0 ? sizes : [100, 300, 1000];

/** A document in a hand-written style: star bullets, wrapped paragraphs, a padded table, code. */
const makeDocument = (kilobytes) => {
  const parts = ['# Big document\n'];
  let section = 0;
  let size = 0;
  while (size < kilobytes * 1024) {
    section += 1;
    const block = [
      `## Section ${section}`,
      `This paragraph of section ${section} is wrapped by hand at about seventy characters,\nthe way many people and tools write Markdown, with _emphasis_ and a\n[reference link][ref${section % 7}] in it.`,
      `* first point of section ${section}\n* second point with \`code\`\n    * a nested point indented four spaces\n* third point`,
      `| Name    | Value |\n|:--------|------:|\n| alpha   |     ${section} |\n| beta    |    ${section * 2} |`,
      `\`\`\`js\nconst section${section} = ${section};\nconsole.log(section${section});\n\`\`\``,
      `1) numbered ${section}\n2) numbered again`,
    ].join('\n\n');
    parts.push(block);
    size += block.length + 2;
  }
  parts.push(Array.from({ length: 7 }, (_, index) => `[ref${index}]: https://example.com/${index}`).join('\n'));
  return `${parts.join('\n\n')}\n`;
};

await withHarness(async ({ server, newHost }) => {
  for (const kilobytes of targets) {
    const content = makeDocument(kilobytes);
    const { page, problems } = await newHost();
    const startedOpen = Date.now();
    const frame = await openFile(page, server, { path: 'docs/big.md', content });
    const opened = Date.now() - startedOpen;
    await page.waitForTimeout(1500);
    const info = await frame.evaluate(() => {
      const editor = document.querySelector('.ProseMirror').editor;
      return { blocks: editor.state.doc.childCount, origin: window.visualMarkdownEditor.describeBlocks()?.filter((block) => block.source !== null).length };
    });

    // Time what the page does with each edit the editor reports.
    await frame.evaluate(() => {
      const api = window.acquireVsCodeApi();
      const original = api.postMessage;
      window.__editTimes = [];
      api.postMessage = (message) => {
        if (!message || (message.type !== 'edit' && message.type !== 'flushPendingEditAck')) return original(message);
        const started = performance.now();
        const result = original(message);
        window.__editTimes.push(`${message.type === 'edit' ? 'edit' : 'flush'} ${Math.round(performance.now() - started)}`);
        return result;
      };
    });

    // Type before a word in the middle of the document.
    const middle = Math.floor(content.split('## Section ').length / 2);
    const needle = `second point with`;
    const typed = await frame.evaluate(
      ([word, nth]) => {
        const editor = document.querySelector('.ProseMirror').editor;
        let seen = 0;
        let at = -1;
        editor.state.doc.descendants((node, pos) => {
          if (at < 0 && node.isText && node.text.includes(word)) {
            seen += 1;
            if (seen === nth) at = pos + node.text.indexOf(word);
          }
          return at < 0;
        });
        const started = performance.now();
        editor.chain().focus().insertContentAt(at, 'Zq').run();
        return { at, ms: Math.round(performance.now() - started) };
      },
      [needle, middle],
    );
    const startedDirty = Date.now();
    while (!(await hostState(page)).dirty && Date.now() - startedDirty < 20000) await page.waitForTimeout(50);
    const dirtyAfter = Date.now() - startedDirty;

    // A second and third edit in the same place, as when someone keeps typing.
    for (const more of ['a', 'b']) {
      await frame.evaluate(([at, text]) => document.querySelector('.ProseMirror').editor.chain().insertContentAt(at, text).run(), [typed.at + 2, more]);
      await page.waitForTimeout(700);
    }
    const idleStarted = Date.now();
    await page.waitForTimeout(1600);
    const longTasks = await frame.evaluate(() => window.__editTimes.join(', '));

    const startedSave = Date.now();
    const saved = await save(page);
    const saveTook = Date.now() - startedSave;
    void idleStarted;

    const before = content.split('\n');
    const after = saved.split('\n');
    const changed = before.length === after.length ? before.filter((line, index) => line !== after[index]).length : -1;
    console.log(
      `${String(kilobytes).padStart(5)} KB  ${(content.length / 1024).toFixed(0)} KB real, ${info.blocks} blocks (${info.origin} with source)  open ${opened} ms  keystroke ${typed.ms} ms  marked changed after ${dirtyAfter} ms  save ${saveTook} ms  lines changed ${changed}`,
    );
    console.log(`          handling each edit took (ms): ${longTasks}`);
    const noise = problems.filter((text) => !/favicon|status of 404/.test(text));
    if (noise.length > 0) console.log('   problems:', [...new Set(noise)].slice(0, 3).join(' | '));
    await page.close();
  }
});
