// Helpers for tests that run the built editor in a real browser, framed the way OpenChamber
// frames it. See server.mjs and host.js for what stands in for the app.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

export const harnessRoot = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(harnessRoot, '..', '..');
export const outDir = join(harnessRoot, 'out');

/** A Chromium to drive: VM_CHROMIUM, then one Playwright downloaded, then Chrome or Edge. */
export function findChromium() {
  if (process.env.VM_CHROMIUM) return { executablePath: process.env.VM_CHROMIUM };
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') : join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright'));
  if (existsSync(cache)) {
    const builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      for (const tail of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const candidate = join(cache, build, tail);
        if (existsSync(candidate)) return { executablePath: candidate };
      }
    }
  }
  return { channel: process.platform === 'win32' ? 'msedge' : 'chrome' };
}

/**
 * Start the stand-in server and a browser, run `body`, and always close both.
 *
 * @param {(tools: { browser: import('playwright-core').Browser, server: Awaited<ReturnType<typeof startServer>>, newHost: Function }) => Promise<void>} body
 * @param {{ origins?: string[] }} [options]
 */
export async function withHarness(body, options = {}) {
  mkdirSync(outDir, { recursive: true });
  const server = await startServer({ packageRoot, harnessRoot, origins: options.origins ?? [] });
  const browser = await chromium.launch({ ...findChromium(), headless: true });
  try {
    const newHost = async ({ width = 1100, height = 800 } = {}) => {
      const page = await browser.newPage({ viewport: { width, height } });
      const problems = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      await page.goto(`${server.url}/host.html`);
      return { page, problems };
    };
    await body({ browser, server, newHost });
  } finally {
    await browser.close();
    await server.close();
  }
}

/** The editor's frame inside the host page. */
export const editorFrame = (page) => page.frames().find((frame) => frame.url().includes('/editor/index.html'));

/**
 * Open a file in the editor and wait until the document is on screen.
 *
 * @param {import('playwright-core').Page} page
 * @param {{ guestUrl: string }} server
 * @param {{ path?: string, content: string, readOnly?: boolean, files?: Record<string, string>, theme?: 'light' | 'dark', locale?: string }} options
 */
export async function openFile(page, server, options) {
  const { path = 'notes/sample.md', content, readOnly = false, files = {}, theme = 'light', locale = 'en' } = options;
  await page.evaluate(
    (args) => window.harness.open(args),
    { guestUrl: server.guestUrl, file: { path, content, readOnly }, files, theme, locale },
  );
  const frame = await waitForEditor(page);
  return frame;
}

export async function waitForEditor(page, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const frame = editorFrame(page);
    if (frame) {
      const ready = await frame.evaluate(() => Boolean(document.querySelector('.ProseMirror'))).catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('The editor did not appear.');
}

export const hostState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.harness.state)));
export const save = (page) => page.evaluate(() => window.harness.save());
export const handoff = (page) => page.evaluate(() => window.harness.handoff());
