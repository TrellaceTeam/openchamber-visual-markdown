// Write THIRD-PARTY-NOTICES.md: every package whose code the build put into editor/, with
// its licence. The list comes from the build itself, so it cannot drift from what ships.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** The package a bundled file belongs to, as [name, folder], or null for our own and upstream's source. */
const packageOf = (input) => {
  const normal = input.replaceAll('\\', '/');
  const at = normal.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const rest = normal.slice(at + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return [name, normal.slice(0, at + 'node_modules/'.length) + name];
};

const licenceId = (manifest) => {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type ?? entry).join(' OR ');
  return 'see licence text';
};

/**
 * @param {{ root: string, upstream: string, pin: { name: string, repo: string, tag: string, commit: string, copyright: string }, inputs: string[] }} options
 */
export function writeNotices({ root, upstream, pin, inputs }) {
  const packages = new Map();
  for (const input of inputs) {
    const found = packageOf(input);
    if (!found) continue;
    const [name, relativeFolder] = found;
    if (packages.has(name)) continue;
    // esbuild reports inputs relative to the folder the build ran in.
    const folder = [join(process.cwd(), relativeFolder), join(root, relativeFolder), relativeFolder].find((candidate) => existsSync(join(candidate, 'package.json')));
    if (!folder) continue;
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const file = readdirSync(folder).find((entry) => LICENCE_FILE.test(entry));
    packages.set(name, {
      version: manifest.version ?? '',
      licence: licenceId(manifest),
      home: typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository?.url ?? manifest.homepage ?? ''),
      text: file ? readFileSync(join(folder, file), 'utf8').replace(/\r\n/g, '\n').trim() : '',
    });
  }

  const names = [...packages.keys()].sort((a, b) => a.localeCompare(b));
  // Many packages share one licence text word for word. Print each text once.
  const texts = new Map();
  for (const name of names) {
    const { text } = packages.get(name);
    if (text === '') continue;
    const users = texts.get(text) ?? [];
    users.push(name);
    texts.set(text, users);
  }
  const upstreamLicence = readFileSync(join(upstream, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();

  const lines = [
    '# Third-party notices',
    '',
    'Visual Markdown is built from other people\'s work. This file lists it, with each licence.',
    'It is written by `scripts/build.mjs` from the list of files the build put into `editor/`.',
    '',
    '## The editor',
    '',
    `The editor is [${pin.name}](${pin.repo.replace(/\.git$/, '')}), version ${pin.tag.replace(/^v/, '')} (commit \`${pin.commit}\`), with the changes in \`patches/\`.`,
    `${pin.copyright}. MIT licence:`,
    '',
    '```text',
    upstreamLicence,
    '```',
    '',
    '## Icons',
    '',
    'The toolbar icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft. The icon font is under the Creative Commons Attribution 4.0 International licence (CC BY 4.0), and its code under the MIT licence.',
    '',
    '## Packages',
    '',
    `${names.length} packages have code in the built page.`,
    '',
    '| Package | Version | Licence |',
    '| --- | --- | --- |',
    ...names.map((name) => `| ${name} | ${packages.get(name).version} | ${packages.get(name).licence} |`),
    '',
    '## Licence texts',
    '',
  ];
  for (const [text, users] of [...texts].sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
    lines.push(`### ${users.join(', ')}`, '', '```text', text.replaceAll('```', "'''"), '```', '');
  }
  const missing = names.filter((name) => packages.get(name).text === '');
  if (missing.length > 0) {
    lines.push('### Packages that ship no licence file', '', `${missing.map((name) => `${name} (${packages.get(name).licence})`).join(', ')}. The licence named in each package's \`package.json\` applies.`, '');
  }
  writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), `${lines.join('\n').trimEnd()}\n`);
  return { packages: names.length, missing };
}
