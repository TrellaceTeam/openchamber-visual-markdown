import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReference } from '../../src/shim/reference';

// The message the editor sends for a caret in the second list item of the document below,
// captured from the running editor.
const content = '---\ntitle: Plan\n---\n\n# Plan\n\nFirst paragraph.\n\n- item one\n- item two\n\nLast paragraph here.\n';
const point = { ordinal: 3, steps: [{ kind: 'item', index: 1, count: 2 }, { kind: 'paragraph', index: 0, count: 1 }], line: { index: 0, count: 1 } };
const message = {
  type: 'copyReferenceForAi',
  selection: { start: point, end: point },
  blocks: [
    { ordinal: 0, kind: 'code', markdown: '```yaml\n---\ntitle: Plan\n---\n```', contentSize: 19 },
    { ordinal: 1, kind: 'heading', markdown: '# Plan', contentSize: 4 },
    { ordinal: 2, kind: 'paragraph', markdown: 'First paragraph.', contentSize: 16 },
    { ordinal: 3, kind: 'list', markdown: '- item one\n- item two', contentSize: 24 },
    { ordinal: 4, kind: 'paragraph', markdown: 'Last paragraph here.', contentSize: 20 },
  ],
};

test('a caret in a list item becomes that line of the file', () => {
  assert.deepEqual(buildReference(message, content, 'docs/plan.md'), { reference: '@docs/plan.md#L10', exact: true });
});

test('the same caret in a file without front matter', () => {
  const body = content.slice(content.indexOf('# Plan'));
  const withoutFrontMatter = { ...message, blocks: message.blocks.slice(1).map((block, index) => ({ ...block, ordinal: index })), selection: { start: { ...point, ordinal: 2 }, end: { ...point, ordinal: 2 } } };
  assert.deepEqual(buildReference(withoutFrontMatter, body, 'plan.md'), { reference: '@plan.md#L6', exact: true });
});

test('a path with a space is quoted, so an agent reads it as one mention', () => {
  const body = content.slice(content.indexOf('# Plan'));
  const withoutFrontMatter = { ...message, blocks: message.blocks.slice(1).map((block, index) => ({ ...block, ordinal: index })), selection: { start: { ...point, ordinal: 2 }, end: { ...point, ordinal: 2 } } };
  assert.equal(buildReference(withoutFrontMatter, body, 'my notes/plan.md')?.reference, '@"my notes/plan.md#L6"');
});

test('a spot that cannot be matched gives the file without line numbers', () => {
  assert.deepEqual(buildReference(message, '# Something else entirely\n', 'docs/plan.md'), { reference: '@docs/plan.md', exact: false });
});

test('anything that is not a reference request gives null', () => {
  assert.equal(buildReference({ type: 'copyReferenceForAi' }, content, 'docs/plan.md'), null);
  assert.equal(buildReference(null, content, 'docs/plan.md'), null);
});
