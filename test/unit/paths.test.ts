import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relativeFrom } from '../../src/shim/fileIndex';
import { cleanTarget, documentFolder, hasScheme, resolveProjectPath } from '../../src/shim/paths';

test('documentFolder gives the folder of a file inside the project', () => {
  assert.equal(documentFolder('README.md', 'D:\\Projects\\sample'), '');
  assert.equal(documentFolder('docs/guide.md', 'D:\\Projects\\sample'), 'docs');
  assert.equal(documentFolder('./docs/a/b.md', null), 'docs/a');
  assert.equal(documentFolder('docs\\guide.md', null), 'docs');
  assert.equal(documentFolder('D:\\Projects\\sample\\docs\\guide.md', 'D:\\Projects\\sample'), 'docs');
  assert.equal(documentFolder('d:/projects/SAMPLE/guide.md', 'D:\\Projects\\sample\\'), '');
  assert.equal(documentFolder('/home/me/app/docs/guide.md', '/home/me/app'), 'docs');
});

test('documentFolder gives null for a file outside the project', () => {
  assert.equal(documentFolder('D:\\Other\\guide.md', 'D:\\Projects\\sample'), null);
  assert.equal(documentFolder('D:\\Projects\\sample-two\\guide.md', 'D:\\Projects\\sample'), null);
  assert.equal(documentFolder('/home/me/App/guide.md', '/home/me/app'), null);
  assert.equal(documentFolder('/abs/guide.md', null), null);
});

test('resolveProjectPath follows a link from the document', () => {
  assert.equal(resolveProjectPath('docs', 'guide.md'), 'docs/guide.md');
  assert.equal(resolveProjectPath('docs', './img/a.svg'), 'docs/img/a.svg');
  assert.equal(resolveProjectPath('docs/deep', '../../README.md'), 'README.md');
  assert.equal(resolveProjectPath('', 'a/b.md'), 'a/b.md');
  assert.equal(resolveProjectPath('docs', '/assets/logo.svg'), 'assets/logo.svg');
  assert.equal(resolveProjectPath('docs', 'guide.md#section'), 'docs/guide.md');
  assert.equal(resolveProjectPath('docs', 'my%20file.md?x=1'), 'docs/my file.md');
  assert.equal(resolveProjectPath('docs', 'img\\a.svg'), 'docs/img/a.svg');
});

test('resolveProjectPath refuses what is not a file in the project', () => {
  assert.equal(resolveProjectPath('docs', '../../outside.md'), null);
  assert.equal(resolveProjectPath('', '../x.md'), null);
  assert.equal(resolveProjectPath('docs', 'https://example.com/a.png'), null);
  assert.equal(resolveProjectPath('docs', 'mailto:someone@example.com'), null);
  assert.equal(resolveProjectPath('docs', 'C:\\Windows\\a.png'), null);
  assert.equal(resolveProjectPath('docs', '#anchor'), null);
  assert.equal(resolveProjectPath('docs', '   '), null);
  assert.equal(resolveProjectPath(null, 'guide.md'), null);
});

test('hasScheme tells a web address from a Windows path', () => {
  assert.equal(hasScheme('https://example.com'), true);
  assert.equal(hasScheme('mailto:a@b.c'), true);
  assert.equal(hasScheme('data:image/png;base64,AAAA'), true);
  assert.equal(hasScheme('C:\\folder\\file.md'), false);
  assert.equal(hasScheme('C:/folder/file.md'), false);
  assert.equal(hasScheme('docs/guide.md'), false);
});

test('cleanTarget drops the query and fragment and decodes the rest', () => {
  assert.equal(cleanTarget('a%20b.md#top'), 'a b.md');
  assert.equal(cleanTarget('a.md?raw=1'), 'a.md');
  assert.equal(cleanTarget('100%.md'), '100%.md');
});

test('relativeFrom writes the path the way a link in the document would', () => {
  assert.equal(relativeFrom('', 'README.md'), 'README.md');
  assert.equal(relativeFrom('docs', 'docs/guide.md'), 'guide.md');
  assert.equal(relativeFrom('docs', 'README.md'), '../README.md');
  assert.equal(relativeFrom('docs/guides', 'docs/setup.md'), '../setup.md');
  assert.equal(relativeFrom('docs/guides', 'assets/img/logo.svg'), '../../assets/img/logo.svg');
  assert.equal(relativeFrom('docs', 'docs/docs/a.md'), 'docs/a.md');
});
