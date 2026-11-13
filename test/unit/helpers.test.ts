import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mix, parseHex, solid, toHex } from '../../src/shim/color';
import { FileIndex, FRESH_FOR_MS, type DirEntry } from '../../src/shim/fileIndex';
import { createImageResolver } from '../../src/shim/images';
import { mermaidThemeFor } from '../../src/shim/mermaidTheme';
import { initialViewState, isEditorViewState, ViewStateKeeper, type ViewStore } from '../../src/shim/viewState';

// --- colours ---------------------------------------------------------------------------

test('parseHex reads three, six and eight digit colours', () => {
  assert.deepEqual(parseHex('#fff'), { rgb: [255, 255, 255], alpha: 1 });
  assert.deepEqual(parseHex('#b35017'), { rgb: [179, 80, 23], alpha: 1 });
  assert.deepEqual(parseHex('#00000080')?.rgb, [0, 0, 0]);
  assert.ok(Math.abs((parseHex('#00000080')?.alpha ?? 0) - 0.5) < 0.01);
  assert.equal(parseHex('rgb(1, 2, 3)'), null);
  assert.equal(parseHex(undefined), null);
});

test('solid lays a see-through colour over the page colour', () => {
  assert.equal(toHex(solid('#00000080', [255, 255, 255], [1, 2, 3])), '#7f7f7f');
  assert.equal(toHex(solid('#102030', [255, 255, 255], [1, 2, 3])), '#102030');
  assert.equal(toHex(solid('not a colour', [255, 255, 255], [1, 2, 3])), '#010203');
  assert.equal(toHex(mix([0, 0, 0], [255, 255, 255], 0.5)), '#808080');
});

test('diagram colours follow the app theme and are plain hex', () => {
  const light = mermaidThemeFor('light', { background: '#faf9f7', foreground: '#44443d', primary: '#b35017', elevated: '#f3f2f0', border: '#e5e1debf' });
  const dark = mermaidThemeFor('dark', { background: '#0e0c0b', foreground: '#dbd7cc', primary: '#da7c47', elevated: '#1b1918' });
  assert.equal(light.theme, 'base');
  assert.equal(light.themeVariables.darkMode, false);
  assert.equal(dark.themeVariables.darkMode, true);
  assert.equal(light.themeVariables.primaryTextColor, '#44443d');
  for (const theme of [light, dark]) {
    for (const [name, value] of Object.entries(theme.themeVariables)) {
      if (typeof value === 'string') assert.match(value, /^#[0-9a-f]{6}$/, name);
    }
  }
  assert.notEqual(light.key, dark.key);
  assert.equal(mermaidThemeFor('light', {}).theme, 'base');
});

// --- file search -----------------------------------------------------------------------

const tree = (files: readonly string[]) => {
  let calls = 0;
  const listDir = async (path: string): Promise<{ entries: DirEntry[] }> => {
    calls += 1;
    const prefix = path === '.' ? '' : `${path}/`;
    const names = new Map<string, DirEntry['kind']>();
    for (const file of files) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const cut = rest.indexOf('/');
      names.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'directory');
    }
    if (names.size === 0 && path !== '.') throw new Error('NOT_FOUND');
    return { entries: [...names].map(([name, kind]) => ({ name, kind })) };
  };
  return { listDir, calls: () => calls };
};

test('file search ranks names before paths and writes paths from the document', async () => {
  const project = tree(['README.md', 'docs/setup.md', 'docs/guides/setup-advanced.md', 'docs/guides/start.md', 'setup/notes.md', 'node_modules/pkg/setup.md', '.git/setup.md', 'src/app.ts']);
  const index = new FileIndex({ listDir: project.listDir });
  const results = await index.search('setup', { all: true }, 'docs/guides');
  assert.deepEqual(results.map((result) => result.path), ['../setup.md', 'setup-advanced.md', '../../setup/notes.md']);
  assert.deepEqual(results.map((result) => result.filename), ['setup.md', 'setup-advanced.md', 'notes.md']);
});

test('file search filters by kind and matches several words', async () => {
  const project = tree(['docs/setup.md', 'docs/setup.png', 'src/setup.ts', 'config/setup.yaml']);
  const index = new FileIndex({ listDir: project.listDir });
  assert.deepEqual((await index.search('setup', { all: false, md: true }, '')).map((result) => result.path), ['docs/setup.md']);
  assert.deepEqual((await index.search('setup', { all: false, images: true, code: true }, '')).map((result) => result.path), ['src/setup.ts', 'docs/setup.png']);
  assert.deepEqual((await index.search('docs png', { all: true }, '')).map((result) => result.path), ['docs/setup.png']);
  assert.deepEqual(await index.search('   ', { all: true }, ''), []);
  assert.deepEqual(await index.search('nothing-like-this', { all: true }, ''), []);
});

test('file search walks the project once and reuses the list for a while', async () => {
  const project = tree(['a.md', 'docs/b.md']);
  let now = 1000;
  const index = new FileIndex({ listDir: project.listDir, now: () => now });
  await index.search('a', { all: true }, '');
  const first = project.calls();
  await index.search('b', { all: true }, '');
  assert.equal(project.calls(), first);
  now += FRESH_FOR_MS + 1;
  await index.search('b', { all: true }, '');
  assert.ok(project.calls() > first);
});

test('file search survives a folder that cannot be listed', async () => {
  const index = new FileIndex({
    listDir: async (path) => {
      if (path === '.') return { entries: [{ name: 'ok.md', kind: 'file' }, { name: 'locked', kind: 'directory' }] };
      throw new Error('DENIED');
    },
  });
  assert.deepEqual((await index.search('ok', { all: true }, '')).map((result) => result.path), ['ok.md']);
});

// --- pictures --------------------------------------------------------------------------

test('a project SVG is read and shown, anything else is not', async () => {
  const made: string[] = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => {
    made.push('blob:test');
    return `blob:test-${made.length}`;
  };
  const revoked: string[] = [];
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
  try {
    const reads: string[] = [];
    const resolver = createImageResolver({
      folder: () => 'docs',
      readFile: async (path) => {
        reads.push(path);
        if (path === 'assets/logo.svg') return { content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' };
        if (path === 'docs/fake.svg') return { content: 'not an svg at all' };
        throw new Error('NOT_FOUND');
      },
    });
    assert.equal(await resolver.resolve('../assets/logo.svg'), 'blob:test-1');
    assert.equal(await resolver.resolve('../assets/logo.svg'), 'blob:test-1', 'read once, then reused');
    assert.equal(await resolver.resolve('fake.svg'), '');
    assert.equal(await resolver.resolve('missing.svg'), '');
    assert.equal(await resolver.resolve('shot.png'), '');
    assert.equal(await resolver.resolve('https://example.com/a.svg'), '');
    assert.equal(await resolver.resolve('../../outside.svg'), '');
    assert.deepEqual(reads, ['assets/logo.svg', 'docs/fake.svg', 'docs/missing.svg']);
    resolver.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(revoked, ['blob:test-1']);
  } finally {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

// --- scroll position -------------------------------------------------------------------

const memoryStore = (): ViewStore & { data: Record<string, unknown>; writes: number } => {
  const store = {
    data: {} as Record<string, unknown>,
    writes: 0,
    get: async (key: string) => store.data[key],
    set: async (key: string, value: unknown) => {
      store.writes += 1;
      store.data[key] = JSON.parse(JSON.stringify(value));
    },
  };
  return store;
};

test('the place in a file is stored and comes back for the version asked for', async () => {
  const store = memoryStore();
  const keeper = new ViewStateKeeper(store);
  assert.equal(await keeper.load('p|a.md', 1), null);
  keeper.remember('p|a.md', { version: 1, documentVersion: 7, selection: { from: 12, to: 30 }, scrollTop: 420.4 });
  keeper.remember('p|a.md', { version: 1, documentVersion: 8, selection: { from: 14, to: 14 }, scrollTop: 640 });
  await keeper.flush();
  assert.equal(store.writes, 1, 'writes are batched');
  assert.deepEqual(await keeper.load('p|a.md', 1), { version: 1, documentVersion: 1, selection: { from: 14, to: 14 }, scrollTop: 640 });
  assert.equal(await keeper.load('p|other.md', 1), null);
});

test('only the most recent files are kept, and another file open elsewhere is not overwritten', async () => {
  const store = memoryStore();
  const first = new ViewStateKeeper(store);
  const second = new ViewStateKeeper(store);
  first.remember('p|a.md', { version: 1, documentVersion: 1, selection: { from: 1, to: 1 }, scrollTop: 10 });
  await first.flush();
  second.remember('p|b.md', { version: 1, documentVersion: 1, selection: { from: 2, to: 2 }, scrollTop: 20 });
  await second.flush();
  assert.equal((await first.load('p|a.md', 1))?.scrollTop, 10);
  assert.equal((await first.load('p|b.md', 1))?.scrollTop, 20);

  for (let index = 0; index < 80; index += 1) {
    first.remember(`p|file-${index}.md`, { version: 1, documentVersion: 1, selection: { from: 0, to: 0 }, scrollTop: index });
    await first.flush();
  }
  assert.equal(Object.keys(store.data.views as object).length, 60);
});

test('a store that fails or holds junk does not break opening a file', async () => {
  const broken = new ViewStateKeeper({
    get: async () => {
      throw new Error('offline');
    },
    set: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(await broken.load('p|a.md', 1), null);
  broken.remember('p|a.md', initialViewState(1));
  await broken.flush();

  const junk = memoryStore();
  junk.data.views = { 'p|a.md': { v: ['x', 2, 3], t: 1 }, 'p|b.md': 'nope', 'p|c.md': { v: [1, 2, 3], t: 5 } };
  const keeper = new ViewStateKeeper(junk);
  assert.equal(await keeper.load('p|a.md', 1), null);
  assert.equal((await keeper.load('p|c.md', 1))?.scrollTop, 3);
});

test('isEditorViewState accepts only the shape the editor writes', () => {
  assert.equal(isEditorViewState(initialViewState(3)), true);
  assert.equal(isEditorViewState({ version: 2, documentVersion: 1, selection: { from: 0, to: 0 }, scrollTop: 0 }), false);
  assert.equal(isEditorViewState({ version: 1, scrollTop: 0 }), false);
  assert.equal(isEditorViewState(null), false);
});
