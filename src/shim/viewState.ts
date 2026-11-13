/**
 * Where the person was in each file: scroll position and caret.
 *
 * The editor already keeps this through `getState`/`setState`, which VS Code holds for a
 * webview while it is hidden. OpenChamber reloads the page when a file is reopened or
 * changes on disk, so here it goes into the extension's storage, one small entry per file.
 */

/** The editor's own state shape (RichViewState in upstream's utils/richViewState.ts). */
export interface EditorViewState {
  readonly version: 1;
  readonly documentVersion: number;
  readonly selection: { readonly from: number; readonly to: number };
  readonly scrollTop: number;
}

export interface ViewStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

interface Entry {
  /** [selection from, selection to, scrollTop] */
  readonly v: readonly [number, number, number];
  /** When it was written, in seconds. The oldest entries are dropped first. */
  readonly t: number;
}

const KEY = 'views';
const MAX_ENTRIES = 60;
const WRITE_DELAY_MS = 700;

const isEntry = (value: unknown): value is Entry => {
  const entry = value as Entry | null;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    Array.isArray(entry.v) &&
    entry.v.length === 3 &&
    entry.v.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0) &&
    typeof entry.t === 'number'
  );
};

const readMap = (value: unknown): Map<string, Entry> => {
  const map = new Map<string, Entry>();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return map;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isEntry(entry)) map.set(key, entry);
  }
  return map;
};

/** The state a newly opened file starts with: the top of the document. */
export const initialViewState = (documentVersion: number): EditorViewState => ({
  version: 1,
  documentVersion,
  selection: { from: 0, to: 0 },
  scrollTop: 0,
});

export function isEditorViewState(value: unknown): value is EditorViewState {
  const state = value as EditorViewState | null;
  return (
    typeof state === 'object' &&
    state !== null &&
    state.version === 1 &&
    typeof state.scrollTop === 'number' &&
    typeof state.selection === 'object' &&
    state.selection !== null &&
    typeof state.selection.from === 'number' &&
    typeof state.selection.to === 'number'
  );
}

export class ViewStateKeeper {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { id: string; entry: Entry } | null = null;

  constructor(private readonly store: ViewStore) {}

  /**
   * The saved place for a file, as a state the editor will accept for `documentVersion`.
   *
   * @param id - identifies the file: its project folder and path
   * @returns null when nothing is stored, or the store could not be read
   */
  async load(id: string, documentVersion: number): Promise<EditorViewState | null> {
    try {
      const entry = readMap(await this.store.get(KEY)).get(id);
      if (!entry) return null;
      const [from, to, scrollTop] = entry.v;
      return { version: 1, documentVersion, selection: { from: Math.min(from, to), to: Math.max(from, to) }, scrollTop };
    } catch {
      return null;
    }
  }

  /** Remember the place. Written after a short pause, so scrolling does not flood the store. */
  remember(id: string, state: EditorViewState): void {
    this.pending = {
      id,
      entry: { v: [Math.trunc(state.selection.from), Math.trunc(state.selection.to), Math.round(state.scrollTop)], t: Math.floor(Date.now() / 1000) },
    };
    if (this.timer === undefined) this.timer = setTimeout(() => void this.flush(), WRITE_DELAY_MS);
  }

  /** Write now what `remember` is holding. */
  async flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    try {
      // Read the stored map again first: another open file may have written since.
      const map = readMap(await this.store.get(KEY));
      map.delete(pending.id);
      map.set(pending.id, pending.entry);
      const newest = [...map].sort((a, b) => b[1].t - a[1].t).slice(0, MAX_ENTRIES);
      await this.store.set(KEY, Object.fromEntries(newest));
    } catch {
      // Losing a scroll position is not worth telling anyone about.
    }
  }
}
