import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff3, lcsMap } from '../../src/shim/diff3';
import { harmonizeListMarkers, mergeCharacters, mergeKeepingStyle, planOrigin, splitLines, type LoadedBlock } from '../../src/shim/styleMerge';

const codes = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

/** Rebuild the common subsequence a map describes. */
const common = (a: string, b: string, limit = 1000): string | null => {
  const map = lcsMap(codes(a), codes(b), limit);
  if (!map) return null;
  let previous = -1;
  let text = '';
  map.forEach((to, from) => {
    if (to < 0) return;
    assert.ok(to > previous, 'matches must go forward in both texts');
    assert.equal(a[from], b[to]);
    previous = to;
    text += a[from];
  });
  return text;
};

test('lcsMap finds the longest common subsequence', () => {
  assert.equal(common('abcdef', 'abcdef'), 'abcdef');
  assert.equal(common('', 'abc'), '');
  assert.equal(common('abc', ''), '');
  assert.equal(common('abcabba', 'cbabac')?.length, 4);
  assert.equal(common('the quick brown fox', 'the quick red fox'), 'the quick r fox');
  assert.equal(common('- one\n- two\n', '* one\n* two\n'), ' one\n two\n');
});

test('lcsMap gives up past its limit instead of guessing', () => {
  assert.equal(common('a'.repeat(50), 'b'.repeat(50), 20), null);
  assert.notEqual(common('a'.repeat(50), 'b'.repeat(50), 200), null);
});

test('diff3 splits three texts into shared and differing parts', () => {
  const o = 'abcdef';
  const a = 'abXdef';
  const b = 'abcdYf';
  const chunks = diff3(o.length, a.length, b.length, lcsMap(codes(o), codes(a), 100)!, lcsMap(codes(o), codes(b), 100)!);
  const shape = chunks.map((chunk) => (chunk.stable ? `=${o.slice(chunk.oStart, chunk.oStart + chunk.length)}` : `~${o.slice(...chunk.o)}|${a.slice(...chunk.a)}|${b.slice(...chunk.b)}`));
  assert.deepEqual(shape, ['=ab', '~c|X|c', '=d', '~e|e|Y', '=f']);
});

test('mergeCharacters applies an edit to a differently styled line', () => {
  assert.equal(mergeCharacters('- second item\n', '* second item\n', '- Zqsecond item\n'), '* Zqsecond item\n');
  assert.equal(mergeCharacters('2. second\n', '1. second\n', '2. second, more\n'), '1. second, more\n');
  assert.equal(mergeCharacters('a *escaped* b tail\n', 'a \\*escaped\\* b tail\n', 'a *escaped* b Zqtail\n'), 'a \\*escaped\\* b Zqtail\n');
  assert.equal(mergeCharacters('one way  \n', 'one way\n', 'one Zqway  \n'), 'one Zqway\n');
  assert.equal(mergeCharacters('A [link](https://example.com "Site") tail.\n', 'A [link][site] tail.\n', 'A [link](https://example.com "Site") Zqtail.\n'), 'A [link][site] Zqtail.\n');
});

test('mergeCharacters keeps a compact table row compact', () => {
  assert.equal(mergeCharacters('| Grace | Admiral  |\n', 'Grace|Admiral\n', '| ZqGrace | Admiral  |\n'), 'ZqGrace|Admiral\n');
  assert.equal(mergeCharacters('| Ada   | Engineer |\n', 'Ada|Engineer\n', '| ZqAda | Engineer |\n'), 'ZqAda|Engineer\n');
});

test('mergeCharacters refuses when both sides rewrote the same words', () => {
  assert.equal(mergeCharacters('the cat sat\n', 'the dog sat\n', 'the bird sat\n'), null);
});

test('harmonizeListMarkers gives an added item its siblings marker', () => {
  assert.deepEqual(harmonizeListMarkers(['* one\n', '* two\n', '- new\n', '* three\n']), ['* one\n', '* two\n', '* new\n', '* three\n']);
  assert.deepEqual(harmonizeListMarkers(['1) one\n', '2) two\n', '3. new\n']), ['1) one\n', '2) two\n', '3) new\n']);
  assert.deepEqual(harmonizeListMarkers(['- one\n', '  * inner\n', '- two\n']), ['- one\n', '  * inner\n', '- two\n']);
});

test('splitLines keeps line endings so the text can be put back together', () => {
  for (const text of ['', 'a', 'a\n', 'a\nb', 'a\n\nb\n', '\n\n']) assert.equal(splitLines(text).join(''), text);
  assert.deepEqual(splitLines('a\nb'), ['a\n', 'b']);
});

const accept = (): boolean => true;
const block = (source: string | null, serialized: string): LoadedBlock => ({ source, serialized });

test('planOrigin places each block on its lines', () => {
  const content = '# Title\n\n* one\n* two\n\nEnd.\n';
  const origin = planOrigin(content, [block('# Title', '# Title'), block('* one\n* two', '- one\n- two'), block('End.', 'End.')]);
  assert.deepEqual(origin?.entries, [
    { start: 0, end: 1, canonical: '# Title' },
    { start: 2, end: 4, canonical: '- one\n- two' },
    { start: 5, end: 6, canonical: 'End.' },
  ]);
});

test('planOrigin gives the lines between known blocks to blocks without source', () => {
  const content = 'First.\n\n<div>\nraw\n</div>\n\nLast.\n';
  const origin = planOrigin(content, [block('First.', 'First.'), block(null, '<div>raw</div>'), block('Last.', 'Last.')]);
  assert.deepEqual(origin?.entries[1], { start: 2, end: 5, canonical: '<div>raw</div>' });
});

test('planOrigin does not mistake part of a line for a block', () => {
  const content = 'a b\n\nb\n';
  const origin = planOrigin(content, [block('a b', 'a b'), block('b', 'b')]);
  assert.deepEqual(origin?.entries.map((entry) => entry.start), [0, 2]);
});

test('planOrigin gives up when a block is not in the text', () => {
  assert.equal(planOrigin('Hello.\n', [block('Goodbye.', 'Goodbye.')]), null);
  assert.equal(planOrigin('Hello.\n', []), null);
});

test('mergeKeepingStyle keeps the author markers when one item is edited', () => {
  const content = '# T\n\n* first item\n* second item\n* third item\n\nEnd.\n';
  const origin = planOrigin(content, [block('# T', '# T'), block('* first item\n* second item\n* third item', '- first item\n- second item\n- third item'), block('End.', 'End.')]);
  const theirs = '# T\n\n- first item\n- Zqsecond item\n- third item\n\nEnd.\n';
  assert.equal(mergeKeepingStyle(origin, theirs, accept), '# T\n\n* first item\n* Zqsecond item\n* third item\n\nEnd.\n');
});

test('mergeKeepingStyle keeps soft line breaks in a hand-wrapped paragraph', () => {
  const content = 'This paragraph is wrapped\nby hand in the source\nand must stay so.\n';
  const origin = planOrigin(content, [block(content.trimEnd(), 'This paragraph is wrapped  \nby hand in the source  \nand must stay so.')]);
  const theirs = 'This paragraph is wrapped  \nby hand in the Zqsource  \nand must stay so.\n';
  assert.equal(mergeKeepingStyle(origin, theirs, accept), 'This paragraph is wrapped\nby hand in the Zqsource\nand must stay so.\n');
});

test('mergeKeepingStyle keeps blank lines between loose list items', () => {
  const content = '- first\n\n- second\n\n- third\n';
  const origin = planOrigin(content, [block(content.trimEnd(), '- first\n- second\n- third')]);
  assert.equal(mergeKeepingStyle(origin, '- first\n- Zqsecond\n- third\n', accept), '- first\n\n- Zqsecond\n\n- third\n');
});

test('mergeKeepingStyle writes an added item with the list marker in use', () => {
  const content = '* one\n* two\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two')]);
  // A list that mixes markers is two lists, so the plain merge is not the document on screen.
  const validate = (candidate: string): boolean => !/^\*/m.test(candidate) || !/^-/m.test(candidate);
  assert.equal(mergeKeepingStyle(origin, '- one\n- two\n- three\n', validate), '* one\n* two\n* three\n');
});

test('mergeKeepingStyle drops a deleted item and renumbers in the author style', () => {
  const content = '1) first item\n2) second item\n3) third item\n';
  const origin = planOrigin(content, [block(content.trimEnd(), '1. first item\n2. second item\n3. third item')]);
  assert.equal(mergeKeepingStyle(origin, '1. first item\n2. third item\n', accept), '1) first item\n2) third item\n');
});

test('mergeKeepingStyle drops the blank line that went with a deleted loose item', () => {
  const content = '- first\n\n- second\n\n- third\n';
  const origin = planOrigin(content, [block(content.trimEnd(), '- first\n- second\n- third')]);
  assert.equal(mergeKeepingStyle(origin, '- first\n- third\n', accept), '- first\n\n- third\n');
});

test('mergeKeepingStyle leaves untouched blocks and plain additions alone', () => {
  const content = '* one\n* two\n\nPara.\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two'), block('Para.', 'Para.')]);
  assert.equal(mergeKeepingStyle(origin, '* one\n* two\n\nPara. More.\n', accept), '* one\n* two\n\nPara. More.\n');
  assert.equal(mergeKeepingStyle(origin, '* one\n* two\n\nPara.\n\nNew block.\n', accept), '* one\n* two\n\nPara.\n\nNew block.\n');
  assert.equal(mergeKeepingStyle(origin, content, accept), content);
});

test('mergeKeepingStyle falls back to the editor text when nothing validates', () => {
  const content = '* one\n* two\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two')]);
  const theirs = '- one\n- Zqtwo\n';
  assert.equal(mergeKeepingStyle(origin, theirs, () => false), theirs);
  assert.equal(mergeKeepingStyle(null, theirs, accept), theirs);
});

test('mergeKeepingStyle keeps a file with no final newline that way', () => {
  const content = '* one\n* two';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two')]);
  assert.equal(mergeKeepingStyle(origin, '- one\n- Zqtwo', accept), '* one\n* Zqtwo');
});

test('mergeKeepingStyle keeps a compact table compact when a cell grows', () => {
  const content = 'Name|Role\n-|-\nAda|Engineer\nGrace|Admiral\n';
  const canonical = '| Name  | Role     |\n| ----- | -------- |\n| Ada   | Engineer |\n| Grace | Admiral  |';
  const origin = planOrigin(content, [block(content.trimEnd(), canonical)]);
  const theirs = '| Name    | Role     |\n| ------- | -------- |\n| Ada     | Engineer |\n| ZqGrace | Admiral  |\n';
  assert.equal(mergeKeepingStyle(origin, theirs, accept), 'Name|Role\n-|-\nAda|Engineer\nZqGrace|Admiral\n');
});
