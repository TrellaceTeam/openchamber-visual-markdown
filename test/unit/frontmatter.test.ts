import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontmatterIsTight, tightenFrontmatter, unwrapFrontmatter, wrapFrontmatter } from '../../src/shim/frontmatter';

const F3 = '```';

test('front matter is shown as a code block and comes back unchanged', () => {
  for (const text of [
    '---\ntitle: A\n---\n\n# Body\n',
    '---\ntitle: A\ntags: [x, y]\nnested:\n  key: value\n---\n\nText.\n',
    '---\ntitle: Only front matter\n---\n',
  ]) {
    const wrapped = wrapFrontmatter(text);
    assert.ok(wrapped.startsWith(`${F3}yaml\n---\n`), wrapped);
    assert.equal(unwrapFrontmatter(wrapped).trimEnd(), text.trimEnd());
  }
});

test('text without front matter is left alone', () => {
  for (const text of ['# Title\n\nText.\n', '', 'Text\n\n---\n\nMore\n', `${F3}js\nlet x;\n${F3}\n`, '--- not front matter\n']) {
    assert.equal(wrapFrontmatter(text), text);
    assert.equal(unwrapFrontmatter(text), text);
  }
});

test('a code sample inside front matter cannot close the wrapper early', () => {
  const text = `---\nexample: |\n  ${F3}js\n  let x;\n  ${F3}\n---\n\nBody.\n`;
  const wrapped = wrapFrontmatter(text);
  assert.ok(wrapped.startsWith('````yaml\n'), wrapped);
  assert.equal(unwrapFrontmatter(wrapped), text);
});

test('a yaml code block that is not front matter stays a code block', () => {
  const text = `${F3}yaml\nkey: value\n${F3}\n\nBody.\n`;
  assert.equal(unwrapFrontmatter(text), text);
});

test('front matter with no blank line after it is kept that way', () => {
  assert.equal(frontmatterIsTight('---\na: 1\n---\n# Body\n'), true);
  assert.equal(frontmatterIsTight('---\na: 1\n---\n\n# Body\n'), false);
  assert.equal(frontmatterIsTight('---\na: 1\n---\n'), false);
  assert.equal(frontmatterIsTight('# No front matter\n'), false);
  assert.equal(tightenFrontmatter('---\na: 1\n---\n\n# Body\n'), '---\na: 1\n---\n# Body\n');
  assert.equal(tightenFrontmatter('---\na: 1\n---\n\n\n# Body\n'), '---\na: 1\n---\n\n\n# Body\n');
  assert.equal(tightenFrontmatter('# Body\n'), '# Body\n');
});
