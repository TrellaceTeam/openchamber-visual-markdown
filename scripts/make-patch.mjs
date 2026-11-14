// Turn edits made by hand in .upstream/markdown-for-humans into the last patch in patches/.
//
// The pinned upstream tree is reset, every patch but the last is applied, and the difference
// between that and the files as they were edited is written as the last patch. Use it after
// changing upstream source for an existing last patch, or name a new patch to add one.
//
//   node scripts/make-patch.mjs                      rewrite the last patch
//   node scripts/make-patch.mjs 0005-something.patch add a new last patch
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.upstream', 'markdown-for-humans');
const patchDir = join(root, 'patches');
const keep = join(root, '.tmp', 'make-patch');

const git = (...args) => execFileSync('git', args, { cwd: target, encoding: 'utf8' });

const existing = readdirSync(patchDir).filter((name) => name.endsWith('.patch')).sort();
const named = process.argv[2];
const last = named ?? existing[existing.length - 1];
const earlier = existing.filter((name) => name !== last);
if (named && named < (earlier[earlier.length - 1] ?? '')) throw new Error(`${named} would not be the last patch.`);

// Every file that differs from the pinned commit, as edited by hand.
const changed = git('status', '--porcelain', '--untracked-files=all', '--', 'src')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3).trim());
rmSync(keep, { recursive: true, force: true });
for (const file of changed) {
  if (!existsSync(join(target, file))) continue;
  mkdirSync(dirname(join(keep, file)), { recursive: true });
  cpSync(join(target, file), join(keep, file));
}

git('reset', '--hard', '--quiet');
git('clean', '-fdq', '--', 'src');
for (const name of earlier) git('apply', '--whitespace=nowarn', join(patchDir, name));
git('add', '-A', 'src');

for (const file of changed) {
  if (existsSync(join(keep, file))) cpSync(join(keep, file), join(target, file));
}
git('add', '-N', 'src');
git('diff', '--no-color', `--output=${join(patchDir, last)}`, '--', 'src');
git('reset', '--quiet');
rmSync(keep, { recursive: true, force: true });

const files = git('status', '--porcelain', '--', 'src').split('\n').filter(Boolean).length;
console.log(`${last}: written. ${earlier.length} earlier patch(es) kept, ${files} upstream file(s) differ from the pin.`);
