/**
 * Visual Markdown: the page side of the port.
 *
 * The editor in webview.js is Markdown Editor for Humans, built to run in a VS Code webview
 * and to talk to its extension host through `acquireVsCodeApi()`. OpenChamber has no such
 * host. This script stands in for it: it gives the editor the file OpenChamber opened,
 * keeps the text a save will write, and passes on the few things the editor asks for.
 *
 * It loads first. The editor's script is added once the file and the app's settings are here.
 */
import { connectHost, createFileSaveTracker, OPENCHAMBER_SDK_CHANNEL } from '@openchamber/sdk';
import type { FileEditorDocument, HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { BlankLineMode } from '@upstream/shared/blankLinePolicy';
import { resolveTypographySettings } from '@upstream/shared/typographySettings';
import { DocumentHost, versionOf } from './documentHost';
import { FileIndex, type FileFilters } from './fileIndex';
import { createImageResolver } from './images';
import { mermaidThemeFor } from './mermaidTheme';
import { cleanTarget, documentFolder, hasScheme, resolveProjectPath } from './paths';
import { buildReference } from './reference';
import type { LoadedBlock } from './styleMerge';
import { initialViewState, isEditorViewState, ViewStateKeeper } from './viewState';

declare const __VM_VERSION__: string;
declare const __VM_UPSTREAM__: string;

type EditorMessage = { readonly type?: unknown; readonly [key: string]: unknown };

/** What patches/0004-host-bridge.patch publishes on `window.visualMarkdownEditor`. */
interface EditorBridge {
  describeBlocks: () => LoadedBlock[] | null;
  matchesDocument: (markdown: string, alternative?: string) => boolean;
}

/** DOCUMENT_SYNC_PROTOCOL_VERSION in upstream's src/shared/documentSyncProtocol.ts. */
const SYNC_PROTOCOL = 2;
/** Blank lines in the file are kept as they are. Upstream's default strips repeated ones on save. */
const BLANK_LINE_MODE: BlankLineMode = 'preserve';
/** How long a save waits for the editor to hand over its latest text. */
const FLUSH_TIMEOUT_MS = 3000;
/** After typing stops this long, check whether the document is back to its saved text. */
const SETTLE_IDLE_MS = 1200;
/** How long opening a file waits for its saved scroll position before starting at the top. */
const VIEW_STATE_WAIT_MS = 700;
/** Languages upstream ships translations for, by OpenChamber locale. */
const TRANSLATIONS: Readonly<Record<string, string>> = { es: 'es', ja: 'ja', 'pt-br': 'pt-br', pt: 'pt-br', ru: 'ru', 'zh-cn': 'zh-cn', zh: 'zh-cn' };

const host = connectHost();

// The editor listens for `message` on window, where OpenChamber's own messages also arrive.
// The SDK's listener is registered above and the editor's comes last, so this one in between
// keeps OpenChamber's messages away from the editor.
window.addEventListener('message', (event) => {
  const data = event.data as { channel?: unknown } | null;
  if (data !== null && typeof data === 'object' && data.channel === OPENCHAMBER_SDK_CHANNEL) {
    event.stopImmediatePropagation();
  }
});

let context: HostReadyContext | null = null;
let file: FileEditorDocument | null = null;
let doc: DocumentHost | null = null;
let tracker = createFileSaveTracker(null);
let viewGeneration: string | null = null;
let editorRequested = false;
let viewState: unknown;
let settleTimer: number | undefined;
let flushSequence = 0;
const flushWaiters = new Map<string, (ok: boolean) => void>();
/** Text of recent snapshots by version, so a "saved" notice can be matched to what was written. */
const snapshots = new Map<string, string>();

const notice = document.querySelector<HTMLElement>('#vm-notice');
const showNotice = (text: string | null): void => {
  if (!notice) return;
  notice.textContent = text ?? '';
  notice.hidden = text === null;
};

const log = (...parts: unknown[]): void => console.warn('[Visual Markdown]', ...parts);

/** Deliver a message to the editor the way a VS Code host would. */
const toEditor = (message: Record<string, unknown>): void => {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
};

const toast = (kind: 'info' | 'success' | 'error', message: string): void => {
  void host.toast({ kind, message }).catch(() => undefined);
};

const folder = (): string | null => (file ? documentFolder(file.path, context?.directory ?? null) : null);

const images = createImageResolver({
  readFile: (path) => host.readFile(path),
  folder,
});

const fileIndex = new FileIndex({ listDir: (path) => host.listDir(path) });

// Scroll position and caret per file. They are a preference of this browser, so they go
// into device storage where the app has it.
const storageScope = (): { scope: 'device' } | undefined => (context?.features?.deviceStorage === true ? { scope: 'device' } : undefined);
const views = new ViewStateKeeper({
  get: (key) => host.storage.get(key, storageScope()),
  set: (key, value) => host.storage.set(key, value as never, storageScope()),
});
const viewId = (): string | null => (file ? `${context?.directory ?? ''}|${file.path}` : null);

// Copy buttons in the editor write to the clipboard themselves. A sandboxed frame is not
// always allowed to, so they go through OpenChamber first, which is.
const nativeClipboard: Clipboard | undefined = navigator.clipboard;
const CLIPBOARD_HOST_MAX = 32_000;
try {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string): Promise<void> => {
        if (text.length <= CLIPBOARD_HOST_MAX) {
          try {
            await host.writeClipboard(text);
            return;
          } catch {
            // Fall through to the browser's own clipboard.
          }
        }
        if (!nativeClipboard?.writeText) throw new Error('The clipboard is not available.');
        await nativeClipboard.writeText(text);
      },
      readText: (): Promise<string> => (nativeClipboard?.readText ? nativeClipboard.readText() : Promise.reject(new Error('The clipboard is not available.'))),
    },
  });
} catch (error) {
  log('clipboard not rerouted', error);
}

// ---------------------------------------------------------------------------------------
// Theme and language
// ---------------------------------------------------------------------------------------

const applyTheme = (ready: HostReadyContext): void => {
  applyHostReady(ready, document.documentElement);
  const dark = ready.theme.mode === 'dark';
  document.body.classList.toggle('vscode-dark', dark);
  document.body.classList.toggle('vscode-light', !dark);
  // Diagrams are drawn again when the body's classes change and the colours differ. A
  // change from one light theme to another flips neither class above, so flip this one.
  document.body.classList.toggle('vm-theme-tick');
  document.documentElement.lang = ready.locale || 'en';
};

// Diagrams take their colours from the app's theme (patches/0003-host-mermaid-theme.patch).
(window as unknown as { visualMarkdownMermaidTheme: () => unknown }).visualMarkdownMermaidTheme = () =>
  context ? mermaidThemeFor(context.theme.mode === 'dark' ? 'dark' : 'light', context.theme.tokens as unknown as Record<string, string | undefined>) : null;

const loadTranslations = async (locale: string): Promise<void> => {
  const key = locale.toLowerCase();
  const name = TRANSLATIONS[key] ?? TRANSLATIONS[key.split('-')[0]];
  if (!name) return;
  try {
    const response = await fetch(`l10n/${name}.json`);
    if (!response.ok) return;
    // The editor reads its translations from this attribute when it first needs a string.
    document.body.setAttribute('data-l10n-bundle', await response.text());
  } catch (error) {
    log('translations not loaded', error);
  }
};

// ---------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------

const reportChange = (): void => {
  if (!doc) return;
  host.reportFileChange(tracker.observe(versionOf(doc.text)));
};

const scheduleSettle = (): void => {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    if (doc?.settle()) reportChange();
  }, SETTLE_IDLE_MS);
};

const editorInstance = (): { setEditable: (editable: boolean) => void; isEditable: boolean } | null => {
  const element = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: unknown }) | null;
  const instance = element?.editor as { setEditable?: unknown } | undefined;
  return instance && typeof instance.setEditable === 'function' ? (instance as never) : null;
};

const applyReadOnly = (): void => {
  const readOnly = file?.readOnly === true;
  document.body.classList.toggle('vm-readonly', readOnly);
  const chip = document.querySelector<HTMLElement>('#vm-readonly');
  if (chip) chip.hidden = !readOnly;
  const instance = editorInstance();
  if (instance && instance.isEditable === readOnly) instance.setEditable(!readOnly);
};

const sendUpdate = (force: boolean): void => {
  if (!doc) return;
  toEditor({
    type: 'update',
    protocolVersion: SYNC_PROTOCOL,
    documentVersion: doc.version,
    content: doc.contentForEditor(),
    ...(force ? { force: true } : {}),
    skipResizeWarning: true,
    imagePath: 'images',
    imagePathBase: 'relativeToDocument',
    showImageHoverOverlay: false,
    paragraphSpacingBefore: 0,
    paragraphSpacingAfter: 0,
    zoom: 100,
    typography: resolveTypographySettings({}),
    formattingShortcutsEnabled: true,
    blankLineMode: BLANK_LINE_MODE,
    enableMath: true,
  });
  // The editor builds itself inside that call the first time, so it exists by now.
  // Ask it how it would write each block, so an edit can keep the file's own style.
  const bridge = (window as unknown as { visualMarkdownEditor?: EditorBridge }).visualMarkdownEditor;
  try {
    doc.setOrigin(bridge?.describeBlocks() ?? null, bridge ? (candidate, alternative) => bridge.matchesDocument(candidate, alternative) : null);
  } catch (error) {
    log('style keeping is off for this file', error);
    doc.setOrigin(null, null);
  }
  applyReadOnly();
  adaptToolbar();
  showNotice(null);
};

/** Name the editor's buttons for what they do in OpenChamber, and tell the page how tall the toolbar is. */
let toolbarAdapted = false;
function adaptToolbar(): void {
  const toolbar = document.querySelector<HTMLElement>('.formatting-toolbar');
  if (toolbarAdapted || !toolbar) return;
  toolbarAdapted = true;

  const reference = toolbar.querySelector<HTMLElement>('.copy-reference-button');
  if (reference) {
    const label = 'Add to chat as @file#L10-14';
    reference.title = label;
    reference.setAttribute('aria-label', label);
  }

  const measure = (): void => document.documentElement.style.setProperty('--vm-toolbar-height', `${toolbar.offsetHeight}px`);
  measure();
  new ResizeObserver(measure).observe(toolbar);
}

/** Ask the editor for the text it has not sent yet, and wait until it has sent it. */
const flushEditor = (): Promise<boolean> => {
  if (!doc || viewGeneration === null) return Promise.resolve(true);
  const requestId = `vm-flush-${(flushSequence += 1)}`;
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => {
      flushWaiters.delete(requestId);
      resolve(false);
    }, FLUSH_TIMEOUT_MS);
    flushWaiters.set(requestId, (ok) => {
      window.clearTimeout(timer);
      flushWaiters.delete(requestId);
      resolve(ok);
    });
    toEditor({
      type: 'flushPendingEdit',
      protocolVersion: SYNC_PROTOCOL,
      requestId,
      viewGeneration,
      documentVersion: doc?.version ?? 0,
    });
  });
};

const acceptEdit = (message: EditorMessage): void => {
  if (!doc) return;
  const accepted = file?.readOnly !== true;
  if (accepted && typeof message.content === 'string') doc.applyEditorContent(message.content);
  if (message.type === 'edit') {
    const acknowledgement = {
      type: 'document.edit.ack',
      protocolVersion: SYNC_PROTOCOL,
      editId: message.editId,
      viewGeneration: message.viewGeneration,
      localRevision: message.localRevision,
      accepted,
      documentVersion: doc.version,
    };
    // The editor records an edit as sent only after postMessage returns, so the answer
    // must not arrive inside that call.
    queueMicrotask(() => toEditor(acknowledgement));
  }
  reportChange();
  scheduleSettle();
};

// ---------------------------------------------------------------------------------------
// What the editor asks its host for
// ---------------------------------------------------------------------------------------

const openLink = (url: string): void => {
  if (/^https?:\/\//i.test(url)) {
    void host.openUrl(url).catch(() => toast('error', `Could not open ${url}`));
    return;
  }
  const address = url.replace(/^mailto:/i, '');
  void host
    .writeClipboard(address)
    .then(() => toast('info', `Copied ${address}`))
    .catch(() => undefined);
};

const copyFilePath = (target: string): void => {
  if (hasScheme(target)) {
    openLink(target);
    return;
  }
  const path = resolveProjectPath(folder(), target) ?? cleanTarget(target);
  void host
    .writeClipboard(path)
    .then(() => toast('info', `Copied path: ${path}`))
    .catch(() => undefined);
};

/** Whether a link or image target written in the document points at something that exists. */
const targetExists = async (target: string): Promise<boolean> => {
  const path = resolveProjectPath(folder(), target);
  // A target outside the project cannot be checked from here, so it is not called broken.
  if (path === null) return true;
  try {
    return (await host.stat(path)).kind !== 'missing';
  } catch {
    return true;
  }
};

/** Put a reference to the caret's lines into the chat box, saving first so the lines match the file. */
const addReferenceToChat = async (message: EditorMessage): Promise<void> => {
  const reply = (ok: boolean, text: string): void => toEditor({ type: 'copyReferenceForAi.result', ok, message: text });
  if (!doc || !file) {
    reply(false, 'The file has not finished loading.');
    return;
  }
  await flushEditor();
  doc.settle();
  const built = buildReference(message, doc.text, file.path.replace(/\\/g, '/'));
  if (!built) {
    reply(false, 'Could not make a reference for this spot.');
    return;
  }
  // The agent reads the file from disk, so what is on screen has to be there.
  if (doc.dirty && !file.readOnly) host.requestFileSave();
  const suffix = built.exact ? '' : ', without line numbers';
  try {
    await host.compose({ text: `${built.reference} `, mode: 'append' });
    reply(true, `Added ${built.reference} to the chat${suffix}`);
  } catch {
    try {
      await host.writeClipboard(built.reference);
      reply(true, `Copied ${built.reference}${suffix}`);
    } catch {
      reply(false, 'Could not add a reference to the chat.');
    }
  }
};

const fromEditor = (message: EditorMessage): void => {
  const type = typeof message.type === 'string' ? message.type : '';
  switch (type) {
    case 'ready':
      viewGeneration = typeof message.viewGeneration === 'string' ? message.viewGeneration : null;
      sendUpdate(false);
      return;
    case 'document.sync.request':
      sendUpdate(true);
      return;
    case 'document.sync.reload':
      window.location.reload();
      return;
    case 'edit':
    case 'document.teardown.edit':
      acceptEdit(message);
      return;
    case 'flushPendingEditAck': {
      const waiter = typeof message.requestId === 'string' ? flushWaiters.get(message.requestId) : undefined;
      waiter?.(message.ok === true);
      return;
    }
    case 'resolveImageUri':
      void images.resolve(String(message.relativePath ?? '')).then((webviewUri) => {
        toEditor({ type: 'imageUriResolved', requestId: message.requestId, webviewUri });
      });
      return;
    case 'saveImage':
      // Image files cannot be written from here yet. Tell the editor at once, so a save
      // never waits on an image that will not arrive.
      toEditor({
        type: 'imageError',
        protocolVersion: 1,
        completionId: `vm-image-${Date.now().toString(36)}`,
        placeholderId: message.placeholderId,
        viewGeneration: message.viewGeneration ?? viewGeneration,
        error: 'Adding image files is not supported in OpenChamber yet.',
      });
      toast('info', 'Adding image files is not supported yet. Link to an image by its path or URL.');
      return;
    case 'openExternalLink':
      openLink(String(message.url ?? ''));
      return;
    case 'openFileLink':
    case 'openImage':
      copyFilePath(String(message.path ?? ''));
      return;
    case 'showError':
      toast('error', String(message.message ?? 'Something went wrong.'));
      return;
    case 'searchFiles':
      void fileIndex
        .search(String(message.query ?? ''), (message.filters ?? { all: true }) as FileFilters, folder() ?? '')
        .catch(() => [])
        .then((results) => toEditor({ type: 'fileSearchResults', results, requestId: message.requestId }));
      return;
    case 'auditCheckFile':
      void targetExists(String(message.relativePath ?? '')).then((exists) => {
        toEditor({ type: 'auditCheckFileResult', requestId: message.requestId, exists });
      });
      return;
    case 'copyReferenceForAi':
      void addReferenceToChat(message);
      return;
    case 'auditCheckUrl':
      toEditor({ type: 'auditCheckUrlResult', requestId: message.requestId, reachable: true });
      return;
    case 'auditPickFile':
      toEditor({ type: 'auditPickFileResult', requestId: message.requestId, selectedPath: null });
      return;
    default:
      // save: OpenChamber's own Ctrl+S handling already asked for a snapshot.
      // outlineUpdated, selectionChange, feedback.*: VS Code views that do not exist here.
      return;
  }
};

const api = {
  postMessage: (message: unknown): void => {
    try {
      fromEditor((message ?? {}) as EditorMessage);
    } catch (error) {
      log('could not handle', (message as EditorMessage | null)?.type, error);
    }
  },
  getState: (): unknown => viewState,
  setState: (state: unknown): void => {
    viewState = state;
    const id = viewId();
    if (id !== null && isEditorViewState(state)) views.remember(id, state);
  },
};
window.addEventListener('pagehide', () => void views.flush());
(window as unknown as { acquireVsCodeApi: () => typeof api }).acquireVsCodeApi = () => api;

// ---------------------------------------------------------------------------------------
// OpenChamber
// ---------------------------------------------------------------------------------------

const loadEditor = async (): Promise<void> => {
  if (editorRequested || !context || !doc) return;
  editorRequested = true;
  const id = viewId();
  const [stored] = await Promise.all([
    id === null ? null : Promise.race([views.load(id, doc.version), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), VIEW_STATE_WAIT_MS))]),
    loadTranslations(context.locale),
  ]);
  // Without a saved place the document opens at its top, with the caret there too.
  viewState = stored ?? initialViewState(doc.version);
  const script = document.createElement('script');
  script.src = 'webview.js';
  script.addEventListener('error', () => showNotice('Visual Markdown could not load its editor. Use the source view for this file.'));
  document.body.append(script);
};

host.onReady((ready) => {
  context = ready;
  applyTheme(ready);
  void loadEditor();
});

host.onFileOpen((next) => {
  if (next.encoding !== 'text') {
    host.reportFileUnsupported();
    return;
  }
  file = next;
  images.reset();
  snapshots.clear();
  tracker = createFileSaveTracker(versionOf(next.content));
  if (!doc) {
    doc = new DocumentHost(next.content, { blankLineMode: BLANK_LINE_MODE });
    void loadEditor();
    return;
  }
  // The same page was handed the file again. The editor takes the new text as authoritative.
  doc.replace(next.content);
  if (viewGeneration !== null) sendUpdate(true);
});

host.onFileSnapshot(async () => {
  if (!doc) throw new Error('The file has not finished loading.');
  let flushed = await flushEditor();
  if (!flushed) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    flushed = await flushEditor();
  }
  if (!flushed) throw new Error('The editor is still working on your last change. Try again in a moment.');
  doc.settle();
  const content = doc.text;
  const version = versionOf(content);
  snapshots.set(version, content);
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value as string);
  return { content, version };
});

host.onFileSaved((version) => {
  const written = snapshots.get(version);
  if (doc && written !== undefined) doc.markSaved(written);
  host.reportFileChange({ dirty: tracker.markSaved(version), edited: false });
});

document.documentElement.dataset.vmVersion = __VM_VERSION__;
document.documentElement.dataset.vmUpstream = __VM_UPSTREAM__;
