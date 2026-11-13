// Fetch the editor we port (Markdown Editor for Humans) at its pinned commit into .upstream/,
// install its runtime dependencies without running install scripts, and apply our patches.
// The build reads its source from there. Nothing in .upstream/ is committed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(readFileSync(join(root, 'scripts', 'upstream.json'), 'utf8'));
const target = join(root, '.upstream', 'markdown-for-humans');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
const read = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();

const currentCommit = () => {
  try {
    return read('git', ['rev-parse', 'HEAD'], target);
  } catch {
    return null;
  }
};

if (currentCommit() !== pin.commit) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  run('git', ['clone', '--depth', '1', '--branch', pin.tag, '--no-recurse-submodules', pin.repo, target], root);
  const got = currentCommit();
  if (got !== pin.commit) {
    throw new Error(`Upstream tag ${pin.tag} is at ${got}, but scripts/upstream.json pins ${pin.commit}. Review the change before updating the pin.`);
  }
} else {
  // Start from a clean tree so patches apply the same way every time.
  run('git', ['checkout', '--', '.'], target);
}

if (!existsSync(join(target, 'node_modules', '@tiptap', 'core'))) {
  run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], target);
}

const patchDir = join(root, 'patches');
const patches = existsSync(patchDir) ? readdirSync(patchDir).filter((name) => name.endsWith('.patch')).sort() : [];
for (const name of patches) {
  run('git', ['apply', '--whitespace=nowarn', join(patchDir, name)], target);
  console.log(`applied ${name}`);
}
console.log(`upstream ready: ${pin.name} ${pin.tag} (${pin.commit.slice(0, 10)}), ${patches.length} patch(es)`);
