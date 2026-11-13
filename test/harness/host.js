// A stand-in for OpenChamber's side of the extension protocol, for tests.
//
// It frames the editor page the way the app does (sandbox="allow-scripts") and speaks the
// messages of @openchamber/sdk 2.7.0: it greets the page with the theme and the file, saves
// by asking for a snapshot, and answers the few requests a file editor makes. The message
// shapes come from messages captured in the desktop app.
(() => {
  const CHANNEL = 'openchamber.sdk';
  const frame = document.querySelector('#frame');

  const THEMES = {
    light: { mode: 'light', tokens: { background: '#faf9f7', elevated: '#f3f2f0', foreground: '#44443d', muted: '#696960', subtle: '#f7f6f4', border: '#e5e1debf', hover: '#0000000a', selection: '#a9998f2b', focus: '#b3501755', primary: '#b35017', mutedSurface: '#fdfcfa', elevatedForeground: '#44443d', active: '#00000014', selectionForeground: '#44443d', primaryForeground: '#ffffff', primaryText: '#934113', successText: '#496a2f', warningText: '#785c12', errorText: '#a04037', infoText: '#2761a7', success: '#517734', warning: '#886914', error: '#b7493f', info: '#2c6ebd', font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', mono: 'ui-monospace, "SFMono-Regular", "Menlo", "Cascadia Mono", "Segoe UI Mono", monospace', radius: '.5625rem', syntaxKeyword: '#15764e', syntaxString: '#c25f4b', syntaxNumber: '#177b8f', syntaxFunction: '#4e8b18', syntaxType: '#0e8294', syntaxComment: '#9dae9d', syntaxVariable: '#bb782a', syntaxOperator: '#b94d50' } },
    dark: { mode: 'dark', tokens: { background: '#0e0c0b', elevated: '#1b1918', foreground: '#dbd7cc', muted: '#89867c', subtle: '#171616', border: '#242323bf', hover: '#ffffff0f', selection: '#c8c6c52b', focus: '#da7c4755', primary: '#da7c47', mutedSurface: '#120f0e', elevatedForeground: '#dbd7cc', active: '#ffffff1a', selectionForeground: '#dbd7cc', primaryForeground: '#000000', primaryText: '#e2996f', successText: '#76ad4f', warningText: '#c8841b', errorText: '#e17768', infoText: '#479fe6', success: '#76ad4f', warning: '#c67f13', error: '#da5b4a', info: '#479fe6', font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', mono: 'ui-monospace, "SFMono-Regular", "Menlo", "Cascadia Mono", "Segoe UI Mono", monospace', radius: '.5625rem', syntaxKeyword: '#34983a', syntaxString: '#d58373', syntaxNumber: '#279e93', syntaxFunction: '#78a952', syntaxType: '#479cb1', syntaxComment: '#728772', syntaxVariable: '#c69457', syntaxOperator: '#da6b6d' } },
  };

  const state = {
    guestUrl: '',
    theme: 'light',
    locale: 'en',
    directory: 'D:\\Projects\\sample',
    file: null, // { path, name, readOnly, content }
    disk: '', // what is "on disk"
    files: {}, // other project files by relative path, for file-read / file-stat / file-list
    dirty: false,
    edited: false,
    changes: 0,
    saves: 0,
    hellos: 0,
    unsupported: false,
    toasts: [],
    opened: [],
    clipboard: [],
    composed: [],
    storage: {},
    storageOps: [],
    errors: [],
    log: [],
  };
  const waiters = new Map();
  let sequence = 0;

  const post = (message) => frame.contentWindow.postMessage({ channel: CHANNEL, v: 1, ...message }, '*');

  const ready = () => ({
    theme: THEMES[state.theme],
    locale: state.locale,
    directory: state.directory,
    session: null,
    surface: 'file',
    connection: { connected: false, account: '' },
    settings: {},
    item: null,
    features: { deviceStorage: true, lateGenerateResults: true },
  });

  const greet = () => {
    const payload = ready();
    post({ type: 'ready', payload });
    post({ type: 'directory', payload: { directory: payload.directory } });
    post({ type: 'session', payload: { session: null } });
    post({ type: 'connection', payload: { connection: payload.connection } });
    post({ type: 'settings', payload: { settings: {} } });
    post({ type: 'item', payload: { item: null } });
    if (state.file) post({ type: 'file-open', payload: { ...state.file, encoding: 'text' } });
  };

  const answer = (id, payload) => post({ type: 'result', id, ok: true, payload });
  const refuse = (id, code, error) => post({ type: 'result', id, ok: false, code, error });

  const badPath = (path) => typeof path !== 'string' || path.includes('\\') || path.split('/').includes('..');

  const listDir = (path) => {
    const prefix = path === '.' || path === '' ? '' : `${path.replace(/\/+$/, '')}/`;
    const names = new Map();
    for (const key of Object.keys(state.files)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const cut = rest.indexOf('/');
      names.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'directory');
    }
    return [...names].sort((a, b) => a[0].localeCompare(b[0])).map(([name, kind]) => ({ name, kind }));
  };

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    state.log.push(message.type);
    const { id, payload } = message;
    switch (message.type) {
      case 'hello':
        state.hellos += 1;
        greet();
        return;
      case 'file-change':
        state.dirty = payload.dirty;
        state.edited = payload.edited;
        state.changes += 1;
        return;
      case 'file-save':
        void window.harness.save();
        return;
      case 'file-unsupported':
        state.unsupported = true;
        return;
      case 'file-snapshot-result': {
        const waiter = waiters.get(id);
        waiters.delete(id);
        waiter?.(payload);
        return;
      }
      case 'toast':
        state.toasts.push(payload);
        answer(id, {});
        return;
      case 'open-url':
        state.opened.push(payload.url);
        if (/^https?:\/\//i.test(payload.url)) answer(id, {});
        else refuse(id, 'HOST_REJECTED', 'Only http(s) URLs can be opened.');
        return;
      case 'clipboard-write':
        state.clipboard.push(payload.text);
        answer(id, {});
        return;
      case 'compose':
        state.composed.push(payload);
        answer(id, {});
        return;
      case 'file-read': {
        if (badPath(payload.path)) return refuse(id, 'BAD_PATH', 'Bad path.');
        const content = state.files[payload.path];
        if (content === undefined) return refuse(id, 'NOT_FOUND', 'No such file.');
        return answer(id, { content });
      }
      case 'file-stat': {
        if (badPath(payload.path)) return refuse(id, 'BAD_PATH', 'Bad path.');
        const content = state.files[payload.path];
        if (content !== undefined) return answer(id, { kind: 'file', size: content.length, mtime: 0 });
        return answer(id, { kind: listDir(payload.path).length > 0 ? 'directory' : 'missing', size: 0, mtime: 0 });
      }
      case 'file-list':
        if (badPath(payload.path)) return refuse(id, 'BAD_PATH', 'Bad path.');
        return answer(id, { entries: listDir(payload.path) });
      case 'storage': {
        const store = state.storage;
        state.storageOps.push(`${payload.op}:${payload.key ?? ''}:${payload.scope ?? 'instance'}`);
        if (payload.op === 'get') return answer(id, payload.key in store ? { storage: true, op: 'get', found: true, value: store[payload.key] } : { storage: true, op: 'get', found: false });
        if (payload.op === 'set') {
          store[payload.key] = payload.value;
          return answer(id, { storage: true, op: 'set' });
        }
        if (payload.op === 'delete') {
          delete store[payload.key];
          return answer(id, { storage: true, op: 'delete' });
        }
        return answer(id, { storage: true, op: 'keys', keys: Object.keys(store).sort() });
      }
      default:
        if (id !== undefined) refuse(id, 'UNSUPPORTED', `The test host does not handle ${message.type}.`);
    }
  });

  const snapshot = (purpose) =>
    new Promise((resolve, reject) => {
      const id = `snap-${(sequence += 1)}`;
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error('snapshot timed out'));
      }, 8000);
      waiters.set(id, (payload) => {
        clearTimeout(timer);
        if (payload.error) reject(new Error(payload.error));
        else resolve(payload.snapshot);
      });
      post({ type: 'file-snapshot', id, payload: { purpose } });
    });

  const load = () =>
    new Promise((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
      frame.src = `${state.guestUrl}?t=${Date.now()}`;
    });

  window.harness = {
    state,
    /** Frame the editor and hand it a file. */
    async open({ guestUrl, file, files = {}, theme = 'light', locale = 'en', directory }) {
      Object.assign(state, { guestUrl, theme, locale, files, dirty: false, edited: false, unsupported: false });
      if (directory) state.directory = directory;
      state.file = { path: file.path, name: file.path.split('/').pop(), readOnly: file.readOnly === true, content: file.content };
      state.disk = file.content;
      document.body.classList.toggle('dark', theme === 'dark');
      await load();
    },
    /** What the app does on Ctrl+S or autosave: ask for the text, write it, say it is saved. */
    async save() {
      const result = await snapshot('save');
      state.disk = result.content;
      state.saves += 1;
      post({ type: 'file-saved', payload: { version: result.version } });
      return result.content;
    },
    /** What the app does when the person switches to the source view. */
    handoff: () => snapshot('handoff').then((result) => result.content),
    /** The file changed on disk: the app reloads the page and hands the new text over. */
    async externalChange(content) {
      state.disk = content;
      state.file = { ...state.file, content };
      state.dirty = false;
      await load();
    },
    setTheme(theme) {
      state.theme = theme;
      document.body.classList.toggle('dark', theme === 'dark');
      post({ type: 'ready', payload: ready() });
    },
  };
})();
