import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentHost, SETTLE_INLINE_MAX, versionOf } from '../../src/shim/documentHost';

const host = (text: string): DocumentHost => new DocumentHost(text, { blankLineMode: 'preserve' });

test('a new document is clean and hands its own text to the editor', () => {
  const doc = host('# Title\n\nText.\n');
  assert.equal(doc.dirty, false);
  assert.equal(doc.text, '# Title\n\nText.\n');
  assert.equal(doc.contentForEditor(), '# Title\n\nText.\n');
});

test('the editor writing the same document in its own style changes nothing', () => {
  const saved = '# Title\n\n* one\n* two\n\n1) first\n2) second\n\nSome _emphasis_ here.\n';
  const doc = host(saved);
  assert.equal(doc.applyEditorContent('# Title\n\n- one\n- two\n\n1. first\n2. second\n\nSome *emphasis* here.'), 'unchanged');
  assert.equal(doc.dirty, false);
  assert.equal(doc.text, saved);
});

test('an edit is taken, with the file keeping the line ending it had', () => {
  const withNewline = host('Hello\n');
  assert.equal(withNewline.applyEditorContent('Hello world'), 'changed');
  assert.equal(withNewline.text, 'Hello world\n');
  assert.equal(withNewline.dirty, true);

  const without = host('Hello');
  without.applyEditorContent('Hello world');
  assert.equal(without.text, 'Hello world');

  const two = host('Hello\n\n');
  two.applyEditorContent('Hello world');
  assert.equal(two.text, 'Hello world\n\n');
});

test('typing into an empty file gives it one final newline', () => {
  const doc = host('');
  doc.applyEditorContent('First words');
  assert.equal(doc.text, 'First words\n');
});

test('an edit that is undone brings back the saved text exactly', () => {
  const saved = '# Title\n\n* one\n* two\n';
  const doc = host(saved);
  doc.applyEditorContent('# Title\n\n- one\n- two more');
  assert.equal(doc.dirty, true);
  doc.applyEditorContent('# Title\n\n- one\n- two');
  assert.equal(doc.text, saved);
  assert.equal(doc.dirty, false);
});

test('the version goes up with each change and not otherwise', () => {
  const doc = host('One\n');
  const start = doc.version;
  doc.applyEditorContent('One');
  assert.equal(doc.version, start);
  doc.applyEditorContent('One two');
  assert.equal(doc.version, start + 1);
  doc.applyEditorContent('One two');
  assert.equal(doc.version, start + 1);
});

test('front matter goes to the editor as a code block and comes back as front matter', () => {
  const saved = '---\ntitle: T\n---\n\n# Body\n';
  const doc = host(saved);
  assert.equal(doc.contentForEditor(), '```yaml\n---\ntitle: T\n---\n```\n\n# Body\n');
  doc.applyEditorContent('```yaml\n---\ntitle: T\n---\n```\n\n# Body changed');
  assert.equal(doc.text, '---\ntitle: T\n---\n\n# Body changed\n');
});

test('front matter written tight against the body stays tight', () => {
  const doc = host('---\ntitle: T\n---\n# Body\n');
  doc.applyEditorContent('```yaml\n---\ntitle: T\n---\n```\n\n# Body changed');
  assert.equal(doc.text, '---\ntitle: T\n---\n# Body changed\n');
});

test('saving makes the document clean, and edits made during the save stay unsaved', () => {
  const doc = host('One\n');
  doc.applyEditorContent('One two');
  const snapshot = doc.text;
  doc.applyEditorContent('One two three');
  doc.markSaved(snapshot);
  assert.equal(doc.savedText, 'One two\n');
  assert.equal(doc.dirty, true);
  doc.markSaved(doc.text);
  assert.equal(doc.dirty, false);
});

test('a file handed over again replaces everything', () => {
  const doc = host('Old\n');
  doc.applyEditorContent('Old and edited');
  const before = doc.version;
  doc.replace('New from disk\n');
  assert.equal(doc.text, 'New from disk\n');
  assert.equal(doc.dirty, false);
  assert.ok(doc.version > before);
});

test('blank lines the author left are kept, and a count that changes is an edit', () => {
  const saved = 'One\n\n\nTwo\n';
  const doc = host(saved);
  assert.equal(doc.applyEditorContent('One\n\n\nTwo'), 'unchanged');
  assert.equal(doc.applyEditorContent('One\n\nTwo'), 'changed');
  assert.equal(doc.text, 'One\n\nTwo\n');
});

test('a comparison that throws never hides an edit', () => {
  const doc = new DocumentHost('One\n', {
    blankLineMode: 'preserve',
    equivalent: () => {
      throw new Error('boom');
    },
  });
  assert.equal(doc.applyEditorContent('Two'), 'changed');
  assert.equal(doc.text, 'Two\n');
});

test('with the editor blocks known, an edited block keeps the author style', () => {
  const saved = '# T\n\n* first\n* second\n';
  const doc = host(saved);
  doc.setOrigin(
    [
      { source: '# T', serialized: '# T' },
      { source: '* first\n* second', serialized: '- first\n- second' },
    ],
    { currentBlocks: () => ['# T', '- first\n- Zqsecond'], matchesBlocks: () => true, matchesDocument: () => true },
  );
  doc.applyEditorContent('# T\n\n- first\n- Zqsecond');
  assert.equal(doc.text, '# T\n\n* first\n* Zqsecond\n');
});

test('when the merged text is not the document on screen, the editor text is saved', () => {
  const doc = host('* first\n* second\n');
  doc.setOrigin([{ source: '* first\n* second', serialized: '- first\n- second' }], { currentBlocks: () => ['- first\n- Zqsecond'], matchesBlocks: () => false, matchesDocument: () => true });
  doc.applyEditorContent('- first\n- Zqsecond');
  assert.equal(doc.text, '- first\n- Zqsecond\n');
});

test('a large document is merged once typing pauses, not on every edit', () => {
  const filler = `${'Filler paragraph.\n\n'.repeat(Math.ceil(SETTLE_INLINE_MAX / 19))}`;
  const saved = `${filler}* first\n* second\n`;
  const doc = host(saved);
  const fillerBlocks = filler.trimEnd().split('\n\n').map((source) => ({ source, serialized: source }));
  let checks = 0;
  doc.setOrigin([...fillerBlocks, { source: '* first\n* second', serialized: '- first\n- second' }], {
    currentBlocks: () => [...fillerBlocks.map((block) => block.source), '- first\n- Zqsecond'],
    matchesBlocks: () => {
      checks += 1;
      return true;
    },
    matchesDocument: () => true,
  });

  doc.applyEditorContent(`${filler}- first\n- Zsecond`);
  doc.applyEditorContent(`${filler}- first\n- Zqsecond`);
  assert.equal(doc.text.endsWith('- first\n- Zqsecond\n'), true, 'while typing, the editor text is taken as it comes');
  assert.equal(doc.dirty, true);
  assert.equal(checks, 0);
  assert.equal(doc.settle(), true);
  assert.equal(doc.text, `${filler}* first\n* Zqsecond\n`);
  assert.equal(checks, 1);
  assert.equal(doc.settle(), false);
});

test('a large document that is back to its saved text is clean at once', () => {
  const filler = `${'Filler paragraph.\n\n'.repeat(Math.ceil(SETTLE_INLINE_MAX / 19))}`;
  const saved = `${filler}* first\n* second\n`;
  const doc = host(saved);
  doc.setOrigin([{ source: saved.trimEnd(), serialized: saved.trimEnd() }], { currentBlocks: () => null, matchesBlocks: () => false, matchesDocument: () => true });
  doc.applyEditorContent(`${filler}* first\n* second edited`);
  assert.equal(doc.dirty, true);
  doc.applyEditorContent(`${filler}* first\n* second`);
  assert.equal(doc.dirty, false);
});

test('versionOf changes when the text does', () => {
  assert.equal(versionOf('abc'), versionOf('abc'));
  assert.notEqual(versionOf('abc'), versionOf('abd'));
  assert.notEqual(versionOf('ab'), versionOf('ba'));
  assert.ok(versionOf('x'.repeat(100000)).length < 40);
});
