// Markdown written in styles the editor itself would not use. In each case "Zq" is typed
// before one word, and a save must change that word and nothing else: the author's bullets,
// numbering, line breaks, escapes and table layout all stay.
//
// `expected` is given only where something else is right.
const F3 = '```';

export const styleCases = [
  { name: 'star bullets', needle: 'second', content: '# T\n\n* first item\n* second item\n* third item\n\nEnd.\n' },
  { name: 'plus bullets', needle: 'second', content: '+ first item\n+ second item\n+ third item\n' },
  { name: 'ordered list with parentheses', needle: 'second', content: '1) first item\n2) second item\n3) third item\n' },
  { name: 'ordered list numbered all ones', needle: 'second', content: '1. first item\n1. second item\n1. third item\n' },
  { name: 'ordered list starting at five', needle: 'second', content: '5. first item\n6. second item\n7. third item\n' },
  { name: 'nested list indented four spaces', needle: 'inner two', content: '- outer one\n    - inner one\n    - inner two\n- outer two\n' },
  { name: 'nested star list', needle: 'inner two', content: '* outer one\n  * inner one\n  * inner two\n* outer two\n' },
  { name: 'loose list', needle: 'second', content: '- first item\n\n- second item\n\n- third item\n' },
  { name: 'task box with a capital X', needle: 'open', content: '- [X] done thing\n- [ ] open thing\n' },
  { name: 'numbered tasks', needle: 'two', content: '1. [ ] numbered one\n2. [x] numbered two\n' },
  { name: 'list item holding a paragraph', needle: 'inside', content: '1. Step one\n\n   A paragraph inside the item.\n\n2. Step two\n' },
  { name: 'star rule above a star list', needle: 'item', content: 'Above.\n\n***\n\n* item\n' },
  {
    name: 'padded table, cell grows',
    needle: 'Grace',
    content: '| Name  | Role     |\n|:------|:--------:|\n| Ada   | Engineer |\n| Grace | Admiral  |\n',
    // The column got wider, so every row is padded to match, as a person would do by hand.
    // The author's divider row stays.
    expected: '| Name    | Role     |\n|:------|:--------:|\n| Ada     | Engineer |\n| ZqGrace | Admiral  |\n',
  },
  { name: 'padded table, cell fits', needle: 'Ada', content: '| Name    | Role     |\n|:--------|:--------:|\n| Ada     | Engineer |\n| Grace   | Admiral  |\n', expected: '| Name    | Role     |\n|:--------|:--------:|\n| ZqAda   | Engineer |\n| Grace   | Admiral  |\n' },
  { name: 'compact table', needle: 'Grace', content: 'Name|Role\n-|-\nAda|Engineer\nGrace|Admiral\n' },
  { name: 'hand-wrapped paragraph', needle: 'visual', content: 'This paragraph is wrapped by hand at about seventy characters, the way\nmany people and tools write Markdown. Opening it in a visual editor\nmust not join the lines.\n' },
  { name: 'quote on two lines', needle: 'across', content: '> A quote with **bold**\n> across two lines.\n' },
  { name: 'quote with a lazy line', needle: 'lazy', content: '> A quote that continues\non a lazy line.\n' },
  { name: 'alert', needle: 'careful', content: '> [!WARNING]\n> Be careful with this.\n' },
  { name: 'underscore emphasis', needle: 'tail', content: 'Some _italic_ and __bold__ text with a tail.\n' },
  { name: 'mixed emphasis markers', needle: 'tail', content: '***bold italic*** and ___also___ and ~~struck~~ with a tail.\n' },
  { name: 'tilde code fence', needle: 'print', content: '~~~python\ndef main():\n    print("x")\n~~~\n' },
  { name: 'four-tick code fence', needle: 'inner', content: `\`\`\`\`markdown\ninner line\n${F3}js\nlet x = 1;\n${F3}\n\`\`\`\`\n` },
  { name: 'indented code', needle: 'second', content: 'Text:\n\n    first line\n    second line\n' },
  { name: 'hard break with two spaces', needle: 'continues', content: 'Line with two trailing spaces  \ncontinues here.\n' },
  { name: 'hard break with a backslash', needle: 'continues', content: 'Line with a backslash\\\ncontinues here.\n' },
  { name: 'entities and backslash escapes', needle: 'tail', content: 'Entities &amp; &copy; and \\*escaped\\* stars with a tail.\n' },
  { name: 'inline HTML', needle: 'tail', content: 'Press <kbd>Ctrl</kbd> and H<sub>2</sub>O with a tail.\n' },
  { name: 'reference link', needle: 'tail', content: 'A [reference link][site] with a tail.\n\n[site]: https://example.com "Site"\n' },
  { name: 'autolinks', needle: 'tail', content: 'An autolink <https://example.com/auto> and bare https://example.com/bare with a tail.\n' },
  { name: 'link and image titles', needle: 'tail', content: 'A [link](https://example.com/docs "The docs") and ![img](a.svg "T") with a tail.\n' },
  { name: 'closed heading', needle: 'Closed', content: '## Closed heading ##\n\nText.\n' },
  { name: 'footnote', needle: 'claim', content: 'A claim with a footnote.[^1]\n\n[^1]: The first footnote.\n' },
  { name: 'inline math', needle: 'tail', content: 'Inline $E = mc^2$ with a tail.\n' },
  { name: 'comment inside a paragraph', needle: 'tail', content: 'Text with an inline <!-- hidden --> comment and a tail.\n' },
  { name: 'file with no final newline', needle: 'second', content: '* first item\n* second item' },
  { name: 'front matter above a star list', needle: 'second', content: '---\ntitle: T\n---\n\n* first item\n* second item\n' },
];
