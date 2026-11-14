import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff3, lcsMap } from '../../src/shim/diff3';
import { harmonizeListMarkers, mergeCharacters, mergeKeepingStyle, placeBlocks, planOrigin, splitLines, type EditorCheck, type LoadedBlock } from '../../src/shim/styleMerge';

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

const block = (source: string | null, serialized: string): LoadedBlock => ({ source, serialized });

/**
 * A stand-in for the editor: the blocks its text is made of, and a check that accepts every
 * merged block unless `reject` says no. `seen` records what was checked.
 */
const editorWith = (blocks: readonly string[], reject: (markdown: string) => boolean = () => false): EditorCheck & { seen: Array<{ from: number; to: number; markdown: string }> } => {
  const seen: Array<{ from: number; to: number; markdown: string }> = [];
  return {
    seen,
    currentBlocks: () => blocks,
    matchesBlocks: (from, to, markdown, alternative) => {
      assert.equal(typeof alternative, 'string');
      seen.push({ from, to, markdown });
      return !reject(markdown);
    },
  };
};

/** The blocks of a text whose blocks are separated by one blank line. */
const blocksOf = (text: string): string[] => text.trimEnd().split('\n\n');

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

test('placeBlocks finds each block in order, even when two read the same', () => {
  const text = 'Same.\n\n- a\n- b\n\nSame.\n';
  assert.deepEqual(placeBlocks(text, splitLines(text), ['Same.', '- a\n- b', 'Same.']), [
    { start: 0, end: 1 },
    { start: 2, end: 4 },
    { start: 5, end: 6 },
  ]);
  assert.equal(placeBlocks(text, splitLines(text), ['Same.', 'Missing.']), null);
});

test('mergeKeepingStyle keeps the author markers when one item is edited', () => {
  const content = '# T\n\n* first item\n* second item\n* third item\n\nEnd.\n';
  const origin = planOrigin(content, [block('# T', '# T'), block('* first item\n* second item\n* third item', '- first item\n- second item\n- third item'), block('End.', 'End.')]);
  const theirs = '# T\n\n- first item\n- Zqsecond item\n- third item\n\nEnd.\n';
  const editor = editorWith(blocksOf(theirs));
  assert.equal(mergeKeepingStyle(origin, theirs, editor), '# T\n\n* first item\n* Zqsecond item\n* third item\n\nEnd.\n');
  // Only the edited block was checked, not the whole file.
  assert.deepEqual(editor.seen, [{ from: 1, to: 2, markdown: '* first item\n* Zqsecond item\n* third item\n' }]);
});

test('mergeKeepingStyle keeps soft line breaks in a hand-wrapped paragraph', () => {
  const content = 'This paragraph is wrapped\nby hand in the source\nand must stay so.\n';
  const origin = planOrigin(content, [block(content.trimEnd(), 'This paragraph is wrapped  \nby hand in the source  \nand must stay so.')]);
  const theirs = 'This paragraph is wrapped  \nby hand in the Zqsource  \nand must stay so.\n';
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith(blocksOf(theirs))), 'This paragraph is wrapped\nby hand in the Zqsource\nand must stay so.\n');
});

test('mergeKeepingStyle keeps blank lines between loose list items', () => {
  const content = '- first\n\n- second\n\n- third\n';
  const origin = planOrigin(content, [block(content.trimEnd(), '- first\n- second\n- third')]);
  const theirs = '- first\n- Zqsecond\n- third\n';
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith([theirs.trimEnd()])), '- first\n\n- Zqsecond\n\n- third\n');
});

test('mergeKeepingStyle writes an added item with the list marker in use', () => {
  const content = '* one\n* two\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two')]);
  const theirs = '- one\n- two\n- three\n';
  // A list that mixes markers is two lists, so the plain merge is not the block on screen.
  const editor = editorWith([theirs.trimEnd()], (markdown) => /^\*/m.test(markdown) && /^-/m.test(markdown));
  assert.equal(mergeKeepingStyle(origin, theirs, editor), '* one\n* two\n* three\n');
});

test('mergeKeepingStyle drops a deleted item and renumbers in the author style', () => {
  const content = '1) first item\n2) second item\n3) third item\n';
  const origin = planOrigin(content, [block(content.trimEnd(), '1. first item\n2. second item\n3. third item')]);
  const theirs = '1. first item\n2. third item\n';
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith([theirs.trimEnd()])), '1) first item\n2) third item\n');
});

test('mergeKeepingStyle drops the blank line that went with a deleted loose item', () => {
  const content = '- first\n\n- second\n\n- third\n';
  const origin = planOrigin(content, [block(content.trimEnd(), '- first\n- second\n- third')]);
  const theirs = '- first\n- third\n';
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith([theirs.trimEnd()])), '- first\n\n- third\n');
});

test('mergeKeepingStyle leaves untouched blocks and plain additions alone', () => {
  const content = '* one\n* two\n\nPara.\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two'), block('Para.', 'Para.')]);
  for (const theirs of ['* one\n* two\n\nPara. More.\n', '* one\n* two\n\nPara.\n\nNew block.\n', content]) {
    const editor = editorWith(blocksOf(theirs));
    assert.equal(mergeKeepingStyle(origin, theirs, editor), theirs);
    assert.deepEqual(editor.seen, [], 'nothing to put back, so nothing to check');
  }
});

test('mergeKeepingStyle falls back to the editor text for a block that fails the check', () => {
  const content = '* one\n* two\n\n1) alpha\n2) beta\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two'), block('1) alpha\n2) beta', '1. alpha\n2. beta')]);
  const theirs = '- one\n- Zqtwo\n\n1. alpha\n2. Zqbeta\n';
  // The first block fails the check however it is merged. The second block is still merged.
  const editor = editorWith(blocksOf(theirs), (markdown) => markdown.includes('one'));
  assert.equal(mergeKeepingStyle(origin, theirs, editor), '- one\n- Zqtwo\n\n1) alpha\n2) Zqbeta\n');
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith(blocksOf(theirs), () => true)), theirs);
  assert.equal(mergeKeepingStyle(null, theirs, editor), theirs);
});

test('mergeKeepingStyle gives the editor text back when its blocks are from another moment', () => {
  const content = '* one\n* two\n';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two')]);
  const theirs = '- one\n- Zqtwo\n';
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith(['- one\n- Zqtwo and more typed since'])), theirs);
  assert.equal(mergeKeepingStyle(origin, theirs, { currentBlocks: () => null, matchesBlocks: () => true }), theirs);
});

test('mergeKeepingStyle keeps a file with no final newline that way', () => {
  const content = '* one\n* two';
  const origin = planOrigin(content, [block('* one\n* two', '- one\n- two')]);
  assert.equal(mergeKeepingStyle(origin, '- one\n- Zqtwo', editorWith(['- one\n- Zqtwo'])), '* one\n* Zqtwo');
});

test('mergeKeepingStyle keeps a compact table compact when a cell grows', () => {
  const content = 'Name|Role\n-|-\nAda|Engineer\nGrace|Admiral\n';
  const canonical = '| Name  | Role     |\n| ----- | -------- |\n| Ada   | Engineer |\n| Grace | Admiral  |';
  const origin = planOrigin(content, [block(content.trimEnd(), canonical)]);
  const theirs = '| Name    | Role     |\n| ------- | -------- |\n| Ada     | Engineer |\n| ZqGrace | Admiral  |\n';
  assert.equal(mergeKeepingStyle(origin, theirs, editorWith([theirs.trimEnd()])), 'Name|Role\n-|-\nAda|Engineer\nZqGrace|Admiral\n');
});

test('mergeKeepingStyle checks a block that uses a link definition together with the definitions', () => {
  const content = 'A [link][site] with a tail.\n\n[site]: https://example.com\n';
  const origin = planOrigin(content, [block('A [link][site] with a tail.', 'A [link](https://example.com) with a tail.'), block('[site]: https://example.com', '[site]: https://example.com')]);
  const theirs = 'A [link](https://example.com) with a Zqtail.\n\n[site]: https://example.com\n';
  const editor = editorWith(blocksOf(theirs));
  assert.equal(mergeKeepingStyle(origin, theirs, editor), 'A [link][site] with a Zqtail.\n\n[site]: https://example.com\n');
  assert.equal(editor.seen[0].markdown, 'A [link][site] with a Zqtail.\n\n\n[site]: https://example.com\n');
});

test('mergeKeepingStyle handles a long document with one edit quickly', () => {
  const paragraphs = Array.from({ length: 4000 }, (_, index) => `* point ${index}\n* another point ${index}`);
  const content = `${paragraphs.join('\n\n')}\n`;
  const origin = planOrigin(content, paragraphs.map((source) => block(source, source.replace(/^\*/gm, '-'))));
  const edited = [...paragraphs];
  edited[2000] = '- point 2000\n- Zqanother point 2000';
  const theirs = `${edited.join('\n\n')}\n`;
  const editor = editorWith(edited);
  const started = Date.now();
  const result = mergeKeepingStyle(origin, theirs, editor);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  assert.equal(result, content.replace('another point 2000', 'Zqanother point 2000'));
  assert.equal(editor.seen.length, 1);
});