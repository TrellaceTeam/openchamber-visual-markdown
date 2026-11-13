// Scratch: open a file with extra project files and print what the editor did with images.
import { join } from 'node:path';
import { hostState, openFile, outDir, withHarness } from './lib.mjs';

await withHarness(async ({ server, newHost }) => {
  const { page, problems } = await newHost();
  page.on('console', (message) => {
    const text = message.text();
    if (/Visual Markdown|image|Image|blob/.test(text)) console.log(`[${message.type()}]`, text.slice(0, 300));
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#b35017"/></svg>';
  const frame = await openFile(page, server, {
    path: 'docs/guide.md',
    content: '![logo](../assets/logo.svg)\n\n![shot](./shot.png)\n\nText.\n',
    files: { 'assets/logo.svg': svg },
  });
  await page.waitForTimeout(2500);
  const images = await frame.evaluate(() =>
    [...document.querySelectorAll('img')].map((image) => ({
      md: image.getAttribute('data-markdown-src'),
      src: image.src.slice(0, 60),
      natural: image.naturalWidth,
      loading: image.getAttribute('data-loading'),
      wrapper: image.closest('.image-wrapper')?.className,
    })),
  );
  console.log('images:', JSON.stringify(images, null, 1));
  const state = await hostState(page);
  console.log('host log:', JSON.stringify(state.log));
  console.log('problems:', problems.slice(0, 5));
  await page.screenshot({ path: join(outDir, 'debug.png') });
});
