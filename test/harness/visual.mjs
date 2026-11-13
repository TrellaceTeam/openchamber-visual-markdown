// Screenshots for a visual review: sample documents in light and dark, wide and narrow, and
// each toolbar menu and dialog open.
// Usage: node test/harness/visual.mjs [filter]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFile, outDir, packageRoot, withHarness } from './lib.mjs';

const filter = process.argv[2] ?? '';
const read = (name) => readFileSync(join(packageRoot, 'test', name), 'utf8').replace(/\r\n/g, '\n');
const showcase = read('showcase.md');
const readme = read('readme-sample.md');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120" viewBox="0 0 420 120"><rect width="420" height="120" rx="10" fill="#f1e5dc" stroke="#b35017"/><text x="210" y="68" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#44443d">An SVG from the project</text></svg>';
const shots = [];

const views = [
  { name: 'doc-light-wide', content: showcase, theme: 'light', width: 1280, height: 900, full: true },
  { name: 'doc-dark-wide', content: showcase, theme: 'dark', width: 1280, height: 900, full: true },
  { name: 'doc-light-panel', content: showcase, theme: 'light', width: 460, height: 820, full: false },
  { name: 'doc-dark-panel', content: showcase, theme: 'dark', width: 460, height: 820, full: false },
  { name: 'readme-light', content: readme, theme: 'light', width: 1100, height: 900, full: true },
  { name: 'readme-dark', content: readme, theme: 'dark', width: 1100, height: 900, full: true },
  { name: 'readonly-light', content: showcase, theme: 'light', width: 1100, height: 520, full: false, readOnly: true },
];

await withHarness(async ({ server, newHost }) => {
  for (const view of views.filter((v) => v.name.includes(filter))) {
    const { page } = await newHost({ width: view.width, height: view.height });
    const frame = await openFile(page, server, {
      path: 'plan.md',
      content: view.content,
      theme: view.theme,
      readOnly: view.readOnly === true,
      files: { 'docs/architecture.svg': svg },
    });
    await frame.waitForSelector('.mermaid-wrapper svg, .mermaid svg', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    if (view.full) {
      // Grow the window to the document's height so one picture holds it all.
      const height = await frame.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: view.width, height: Math.min(height + 20, 6000) });
      await page.waitForTimeout(500);
    }
    const path = join(outDir, `${view.name}.png`);
    await page.screenshot({ path });
    shots.push(path);
    await page.close();
  }

  // Toolbar menus and dialogs.
  const popovers = [
    { name: 'menu-headings', click: '.toolbar-button[aria-label="More heading levels"]' },
    { name: 'menu-table', click: '.toolbar-button[aria-label="Insert and edit table"]' },
    { name: 'menu-alert', click: '.toolbar-button[aria-label="Insert GitHub alert"]' },
    { name: 'menu-code', click: '.toolbar-button[aria-label="Insert code block"]' },
    { name: 'menu-mermaid', click: '.toolbar-button[aria-label="Insert Mermaid diagram"]' },
    { name: 'menu-math', click: '.toolbar-button[aria-label^="Insert math equation"]' },
    { name: 'dialog-link', click: '.toolbar-button[aria-label^="Insert/edit link"]' },
    { name: 'overlay-outline', click: '.toolbar-button.toc-button' },
    { name: 'overlay-audit', click: '.toolbar-button.audit-button', wait: 2500 },
    { name: 'overlay-find', keys: 'Control+f', type: 'typo' },
    { name: 'state-bold-active', select: true },
  ];
  for (const theme of ['light', 'dark']) {
    for (const popover of popovers.filter((p) => `${p.name}-${theme}`.includes(filter))) {
      const { page } = await newHost({ width: 1100, height: 760 });
      const frame = await openFile(page, server, { path: 'docs/plan.md', content: showcase, theme });
      await page.waitForTimeout(900);
      try {
        // Put the caret in the first paragraph, so buttons that need focus are on.
        await frame.locator('.ProseMirror > p').first().click();
        if (popover.select) await frame.locator('.ProseMirror > p strong').first().dblclick();
        if (popover.click) await frame.locator(popover.click).first().click({ timeout: 4000 });
        if (popover.keys) {
          await page.keyboard.press(popover.keys);
          await page.waitForTimeout(400);
        }
        if (popover.type) await page.keyboard.type(popover.type, { delay: 30 });
        await page.waitForTimeout(popover.wait ?? 600);
      } catch (error) {
        console.log(`could not open ${popover.name}: ${error.message.split('\n')[0]}`);
      }
      const path = join(outDir, `${popover.name}-${theme}.png`);
      await page.screenshot({ path });
      shots.push(path);
      await page.close();
    }
  }
});
console.log(shots.join('\n'));
