// Run the unit tests in test/unit.
//
// The tests are TypeScript and import the shim's modules, some of which import upstream's
// source through the `@upstream` alias. esbuild bundles each test file into .tmp/unit/ the
// same way the real build does, and Node's own test runner runs the result.
//
//   node scripts/test-unit.mjs            run everything
//   node scripts/test-unit.mjs styleMerge run the files whose name contains "styleMerge"
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, '.upstream', 'markdown-for-humans');
const source = join(root, 'test', 'unit');
const out = join(root, '.tmp', 'unit');
const filter = process.argv[2] ?? '';

if (!existsSync(join(upstream, 'src'))) throw new Error('Upstream source is missing. Run "npm run upstream" first.');

const files = readdirSync(source).filter((name) => name.endsWith('.test.ts') && name.includes(filter));
if (files.length === 0) throw new Error(`No test file matches "${filter}".`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: files.map((name) => join(source, name)),
  outdir: out,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'warning',
  external: ['node:*'],
  alias: {
    '@upstream': join(upstream, 'src'),
    vscode: join(root, 'src', 'shim', 'stubs', 'vscode.ts'),
  },
  nodePaths: [join(upstream, 'node_modules')],
});

const built = files.map((name) => join(out, name.replace(/\.ts$/, '.mjs')));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...built], { stdio: 'inherit' });
process.exit(result.status ?? 1);
