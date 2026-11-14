/**
 * Cases found by code review 1 (14 November 2026). Each wrote text to disk that was not the
 * document on screen, or could have.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentHost } from '../../src/shim/documentHost';
import { unwrapFrontmatter, wrapFrontmatter } from '../../src/shim/frontmatter';
import { mergeCharacters, mergeKeepingStyle, planOrigin, type EditorCheck, type LoadedBlock } from '../../src/shim/styleMerge';

const block = (source: string | null, serialized: string): LoadedBlock => ({ source, serialized });
/** An editor that accepts every merged block and every document, so only the merge itself stands guard. */
const trusting = (blocks: readonly string[]): EditorCheck => ({ currentBlocks: () => blocks, matchesBlocks: () => true, matchesDocument: () => true });
const host = (text: string): DocumentHost => new DocumentHost(text, { blankLineMode: 'preserve', equivalent: (a, b) => a === b });

test('typing at the end of an underlined heading does not save the heading twice', () => {
  const content = 'Project\n=======\n\nSome intro text.\n';
  const origin = planOrigin(content, [block('Project\n=======', '# Project'), block('Some intro text.', 'Some intro text.')]);
  const theirs = '# Project Two\n\nSome intro text.\n';
  const result = mergeKeepingStyle(origin, theirs, trusting(['# Project Two', 'Some intro text.']));
  assert.equal(result, theirs);
});

test('deleting the first word of an underlined heading does not bring the old heading back', () => {
  const content = '# Top\n\nInstall guide\n-------------\n\nRun the script.\n';
  const origin = planOrigin(content, [block('# Top', '# Top'), block('Install guide\n-------------', '## Install guide'), block('Run the script.', 'Run the script.')]);
  const theirs = '# Top\n\n## guide\n\nRun the script.\n';
  const result = mergeKeepingStyle(origin, theirs, trusting(['# Top', '## guide', 'Run the script.']));
  assert.ok(!result.includes('Install'), result);
  assert.equal(result, theirs);
});

test('a deleted last block stays deleted', () => {
  const content = '# Top\n\nSub\n---\n';
  const origin = planOrigin(content, [block('# Top', '# Top'), block('Sub\n---', '## Sub')]);
  const theirs = '# Top\n';
  const result = mergeKeepingStyle(origin, theirs, trusting(['# Top']));
  assert.ok(!result.includes('Sub'), JSON.stringify(result));
});

test('typing at the start of an underlined heading still keeps the underline', () => {
  const content = 'Project\n=======\n\nSome intro text.\n';
  const origin = planOrigin(content, [block('Project\n=======', '# Project'), block('Some intro text.', 'Some intro text.')]);
  const theirs = '# ZqProject\n\nSome intro text.\n';
  assert.equal(mergeKeepingStyle(origin, theirs, trusting(['# ZqProject', 'Some intro text.'])), 'ZqProject\n=======\n\nSome intro text.\n');
});

test('when the whole text does not load as the document on screen, the editor text is saved', () => {
  // Two lists side by side: each passes alone, and together they would load as one list.
  const content = '1) alpha\n2) beta\n\n***\n\n1) gamma\n2) delta\n';
  const origin = planOrigin(content, [block('1) alpha\n2) beta', '1. alpha\n2. beta'), block('***', '---'), block('1) gamma\n2) delta', '1. gamma\n2. delta')]);
  const theirs = '1. alpha\n2. Zqbeta\n\n1) gamma\n2) delta\n';
  let asked = '';
  const editor: EditorCheck = {
    currentBlocks: () => ['1. alpha\n2. Zqbeta', '1) gamma\n2) delta'],
    matchesBlocks: () => true,
    matchesDocument: (markdown, alternative) => {
      asked = markdown;
      assert.equal(alternative, theirs);
      return false;
    },
  };
  assert.equal(mergeKeepingStyle(origin, theirs, editor), theirs);
  // The merge did put some of the author's style back, and asked about the whole text.
  assert.ok(asked.startsWith('1) alpha\n') && asked !== theirs, JSON.stringify(asked));
});

test('a merge by characters never returns half an emoji', () => {
  assert.equal(mergeCharacters('\u{1F9E0}', '\u{1F601}', '\u{1F600}'), null);
  assert.equal(mergeCharacters('x', 'y', 'z'), null);
  // Different characters changed on each side still merge.
  assert.equal(mergeCharacters('3. a\u{1F600}', '3) a\u{1F600}', '2. a\u{1F600}'), '2) a\u{1F600}');
});

test('a code sample at the top of a file keeps its fence', () => {
  const saved = '```yaml\n---\napiVersion: v1\nkind: Pod\n```\n\nNotes about the manifest.\n';
  const doc = host(saved);
  assert.equal(doc.contentForEditor(), saved);
  doc.applyEditorContent('```yaml\n---\napiVersion: v1\nkind: Pod\n```\n\nNotes about the manifest. Added.');
  assert.equal(doc.text, '```yaml\n---\napiVersion: v1\nkind: Pod\n```\n\nNotes about the manifest. Added.\n');
  // The same file handed over again with real front matter is unwrapped again.
  doc.replace('---\ntitle: T\n---\n\nBody.\n');
  doc.applyEditorContent('```yaml\n---\ntitle: T\n---\n```\n\nBody. More');
  assert.equal(doc.text, '---\ntitle: T\n---\n\nBody. More\n');
});

test('blank lines under the front matter and at the top of a file are kept', () => {
  const spaced = '---\ntitle: T\n---\n\n\n\n# Body\n\nText.\n';
  const wrapped = wrapFrontmatter(spaced);
  assert.equal(wrapped, '```yaml\n---\ntitle: T\n---\n```\n\n\n\n# Body\n\nText.\n');
  assert.equal(unwrapFrontmatter(wrapped), spaced);
  const tight = '---\ntitle: T\n---\n# Body\n';
  assert.equal(wrapFrontmatter(tight), '```yaml\n---\ntitle: T\n---\n```\n\n# Body\n');
  assert.equal(wrapFrontmatter('---\ntitle: T\n---'), '```yaml\n---\ntitle: T\n---\n```');

  const doc = host('\n\n# Title\n\nText.\n');
  doc.applyEditorContent('# Title\n\nText. More');
  assert.equal(doc.text, '\n\n# Title\n\nText. More\n');
});
