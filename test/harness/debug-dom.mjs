// Scratch: print the markup and a few computed styles the theme needs to know about.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFile, packageRoot, withHarness } from './lib.mjs';

const content = `${readFileSync(join(packageRoot, 'test', 'showcase.md'), 'utf8').replace(/\r\n/g, '\n')}\n![shot](./shot.png)\n\n![web](https://example.com/a.png)\n`;

await withHarness(async ({ server, newHost }) => {
  const { page } = await newHost();
  const frame = await openFile(page, server, { path: 'docs/plan.md', content });
  await page.waitForTimeout(1500);
  const info = await frame.evaluate(() => {
    const html = (selector, max = 500) => {
      const element = document.querySelector(selector);
      return element ? element.outerHTML.slice(0, max) : null;
    };
    const style = (selector, props) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)]));
    };
    const editor = document.querySelector('.ProseMirror').editor;
    return {
      selection: { from: editor.state.selection.from, to: editor.state.selection.to, size: editor.state.doc.content.size, focused: editor.isFocused },
      bodyChildren: [...document.body.children].map((child) => `${child.tagName.toLowerCase()}${child.id ? `#${child.id}` : ''}.${child.className}`),
      editorParent: document.querySelector('#editor')?.outerHTML.slice(0, 200),
      proseClass: document.querySelector('.ProseMirror').className,
      task: html('ul[data-type="taskList"] li', 420),
      link: html('.ProseMirror a', 300),
      kbd: html('.ProseMirror kbd', 200) ?? html('[data-type*="kbd"], .html-inline', 300),
      quote: style('.ProseMirror blockquote:not([class*="alert"])', ['border-left', 'color', 'font-style', 'padding', 'margin']),
      code: html('.ProseMirror pre', 700),
      codeFont: style('.ProseMirror pre code', ['font-family', 'font-size', 'line-height']),
      inlineCode: style('.ProseMirror p code', ['font-family', 'font-size', 'background-color', 'padding', 'border-radius']),
      imageFailed: html('.image-load-failed', 900),
      dropdownItem: html('.toolbar-dropdown-item', 400),
      toolbarButtons: [...document.querySelectorAll('.formatting-toolbar > *')].map((el) => `${el.tagName.toLowerCase()}.${el.className}[${el.getAttribute('aria-label') ?? ''}]`),
      para: style('.ProseMirror > p', ['font-size', 'line-height', 'font-family', 'color']),
      h1: style('.ProseMirror > h1', ['font-size', 'font-weight', 'font-family']),
    };
  });
  console.log(JSON.stringify(info, null, 1));
});
