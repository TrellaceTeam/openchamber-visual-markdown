// Build the extension's page into editor/.
//
// OpenChamber serves only .html, .js, .css, .svg, .json and .png from an extension, and never
// compiles anything. So every script is one classic (IIFE) file and every font is inlined
// into the stylesheet as a data URL.
//
//   node scripts/build.mjs          release build (minified)
//   node scripts/build.mjs --dev    readable build with source maps left out
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNotices } from './notices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, '.upstream', 'markdown-for-humans');
const out = join(root, 'editor');
const dev = process.argv.includes('--dev');

if (!existsSync(join(upstream, 'src', 'webview', 'editor.ts'))) {
  throw new Error('Upstream source is missing. Run "npm run upstream" first.');
}

const pin = JSON.parse(readFileSync(join(root, 'scripts', 'upstream.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// The oldest browsers the page should run in. OpenChamber web runs in any current browser.
const target = ['chrome120', 'firefox121', 'safari17'];

// Release builds drop console.log/debug/info and keep warn/error, as upstream does.
const consoleStrip = dev
  ? {}
  : {
      pure: ['console.log', 'console.debug', 'console.info'],
      define: { 'console.log': '__vmNoop', 'console.debug': '__vmNoop', 'console.info': '__vmNoop' },
      inject: [join(root, 'scripts', 'console-noop.js')],
    };

// KaTeX lists each font as woff2, woff and ttf. Every supported browser takes woff2, so the
// other two are emptied instead of being inlined three times over.
const katexFallbackFonts = {
  name: 'katex-fallback-fonts',
  setup(esbuild) {
    esbuild.onLoad({ filter: /katex[\\/]dist[\\/]fonts[\\/].*\.(woff|ttf)$/ }, () => ({ contents: '', loader: 'dataurl' }));
  },
};

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target,
  minify: !dev,
  sourcemap: false,
  metafile: true,
  treeShaking: true,
  legalComments: 'none',
  logLevel: 'warning',
  ...consoleStrip,
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'l10n'), { recursive: true });

const builds = await Promise.all([
  // The editor itself: upstream's webview, unchanged apart from patches/.
  build({
    ...common,
    entryPoints: [join(upstream, 'src', 'webview', 'editor.ts')],
    outfile: join(out, 'webview.js'),
    loader: { '.css': 'css', '.ttf': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.eot': 'dataurl' },
    plugins: [katexFallbackFonts],
  }),
  // Code highlighting runs in a worker the page starts from a Blob.
  build({
    ...common,
    entryPoints: [join(upstream, 'src', 'webview', 'highlighting', 'worker.ts')],
    outfile: join(out, 'highlighting-worker.js'),
  }),
  // Our side: stands in for the VS Code extension host and talks to OpenChamber.
  build({
    ...common,
    entryPoints: [join(root, 'src', 'shim', 'index.ts')],
    outfile: join(out, 'shim.js'),
    alias: {
      '@upstream': join(upstream, 'src'),
      // Two of upstream's host-side files import these. See src/shim/stubs/.
      vscode: join(root, 'src', 'shim', 'stubs', 'vscode.ts'),
      crypto: join(root, 'src', 'shim', 'stubs', 'crypto.ts'),
    },
    nodePaths: [join(upstream, 'node_modules')],
    define: {
      ...(common.define ?? {}),
      __VM_VERSION__: JSON.stringify(pkg.version),
      __VM_UPSTREAM__: JSON.stringify(`${pin.name} ${pin.tag}`),
    },
  }),
  build({
    bundle: true,
    minify: !dev,
    target,
    logLevel: 'warning',
    entryPoints: [join(root, 'src', 'styles', 'theme.css')],
    outfile: join(out, 'theme.css'),
    loader: { '.svg': 'dataurl' },
  }),
]);

copyFileSync(join(root, 'src', 'index.html'), join(out, 'index.html'));

// Every package whose code ended up in the page, for THIRD-PARTY-NOTICES.md.
if (!dev) writeNotices({ root, upstream, pin, inputs: builds.flatMap((result) => Object.keys(result.metafile?.inputs ?? {})) });

// Upstream's translations, one small JSON file per language, loaded only when needed.
for (const name of readdirSync(join(upstream, 'l10n'))) {
  const match = /^bundle\.l10n\.([a-z-]+)\.json$/.exec(name);
  if (match) copyFileSync(join(upstream, 'l10n', name), join(out, 'l10n', `${match[1]}.json`));
}

// OpenChamber answers 404 for any other file type, so fail the build instead of shipping one.
const served = new Set(['.html', '.js', '.css', '.svg', '.json', '.png']);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const files = walk(out);
const unserved = files.filter((file) => !served.has(file.slice(file.lastIndexOf('.')).toLowerCase()));
if (unserved.length > 0) throw new Error(`OpenChamber will not serve: ${unserved.join(', ')}`);

const sizes = Object.fromEntries(files.map((file) => [file.slice(out.length + 1).replaceAll('\\', '/'), statSync(file).size]));
writeFileSync(join(out, 'build.json'), `${JSON.stringify({ version: pkg.version, upstream: `${pin.tag} ${pin.commit}`, mode: dev ? 'dev' : 'release', files: sizes }, null, 2)}\n`);
const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
console.log(`built editor/ (${dev ? 'dev' : 'release'}): ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
for (const [name, size] of Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${(size / 1024).toFixed(0).padStart(6)} KB  ${name}`);
