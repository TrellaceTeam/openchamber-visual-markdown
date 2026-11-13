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
import { createImageResolver } from './images';
import { cleanTarget, documentFolder, hasScheme, resolveProjectPath } from './paths';

declare const __VM_VERSION__: string;
declare const __VM_UPSTREAM__: string;

type EditorMessage = { readonly type?: unknown; readonly [key: string]: unknown };

/** DOCUMENT_SYNC_PROTOCOL_VERSION in upstream's src/shared/documentSyncProtocol.ts. */
const SYNC_PROTOCOL = 2;
/** Blank lines in the file are kept as they are. Upstream's default strips repeated ones on save. */
const BLANK_LINE_MODE: BlankLineMode = 'preserve';
/** How long a save waits for the editor to hand over its latest text. */
const FLUSH_TIMEOUT_MS = 3000;
/** After typing stops this long, check whether the document is back to its saved text. */
const SETTLE_IDLE_MS = 1200;
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

// ---------------------------------------------------------------------------------------
// Theme and language
// ---------------------------------------------------------------------------------------

const applyTheme = (ready: HostReadyContext): void => {
  applyHostReady(ready, document.documentElement);
  const dark = ready.theme.mode === 'dark';
  document.body.classList.toggle('vscode-dark', dark);
  document.body.classList.toggle('vscode-light', !dark);
  document.documentElement.lang = ready.locale || 'en';
};

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
  applyReadOnly();
  showNotice(null);
};

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
      toEditor({ type: 'fileSearchResults', results: [], requestId: message.requestId });
      return;
    case 'auditCheckFile':
      toEditor({ type: 'auditCheckFileResult', requestId: message.requestId, exists: true });
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
  },
};
(window as unknown as { acquireVsCodeApi: () => typeof api }).acquireVsCodeApi = () => api;

// ---------------------------------------------------------------------------------------
// OpenChamber
// ---------------------------------------------------------------------------------------

const loadEditor = async (): Promise<void> => {
  if (editorRequested || !context || !doc) return;
  editorRequested = true;
  await loadTranslations(context.locale);
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
