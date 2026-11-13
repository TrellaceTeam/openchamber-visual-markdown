/**
 * Find files in the open project by name, for the link dialog.
 *
 * OpenChamber lists one folder at a time. The first search walks the project once, within
 * limits, and later searches reuse that list for a while.
 */

export interface DirEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'other';
}

export interface FileSearchResult {
  readonly filename: string;
  /** Path from the open document's folder, the way a Markdown link is written. */
  readonly path: string;
}

export interface FileFilters {
  readonly all?: boolean;
  readonly md?: boolean;
  readonly images?: boolean;
  readonly code?: boolean;
  readonly config?: boolean;
}

export interface FileIndexOptions {
  readonly listDir: (path: string) => Promise<{ entries: readonly DirEntry[] }>;
  readonly now?: () => number;
}

/** Folders that hold dependencies, builds or tool data, never something to link to. */
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', '.hg', '.svn', '.vscode', '.idea', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.venv', 'venv', '__pycache__', '.cache', 'target', '.upstream']);

const CATEGORIES: Readonly<Record<'md' | 'images' | 'code' | 'config', readonly string[]>> = {
  md: ['.md', '.markdown'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'],
  code: ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.cs', '.sh', '.bash', '.zsh', '.fish'],
  config: ['.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.properties'],
};

export const MAX_FILES = 4000;
export const MAX_FOLDERS = 600;
export const MAX_DEPTH = 10;
export const WALK_BUDGET_MS = 5000;
export const FRESH_FOR_MS = 60_000;
export const MAX_RESULTS = 20;

const extension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

/** The path from one project folder to a project file, as written in a link. */
export function relativeFrom(folder: string, filePath: string): string {
  const from = folder === '' ? [] : folder.split('/');
  const to = filePath.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
}

export class FileIndex {
  private files: string[] = [];
  private builtAt = Number.NEGATIVE_INFINITY;
  private building: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: FileIndexOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Forget the list, for example when another project is opened. */
  reset(): void {
    this.files = [];
    this.builtAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * @param query - what the person typed
   * @param folder - the open document's folder inside the project ('' for the project root)
   */
  async search(query: string, filters: FileFilters, folder: string): Promise<FileSearchResult[]> {
    const wanted = query.trim().toLowerCase();
    if (wanted === '') return [];
    await this.ensureFresh();

    const allowed = filters.all === false ? new Set((['md', 'images', 'code', 'config'] as const).flatMap((name) => (filters[name] ? CATEGORIES[name] : []))) : null;
    const parts = wanted.split(/\s+/);

    const scored: Array<{ path: string; name: string; rank: number }> = [];
    for (const path of this.files) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (allowed && !allowed.has(extension(name))) continue;
      const lowerName = name.toLowerCase();
      const lowerPath = path.toLowerCase();
      let rank: number;
      if (lowerName === wanted) rank = 0;
      else if (lowerName.startsWith(wanted)) rank = 1;
      else if (lowerName.includes(wanted)) rank = 2;
      else if (lowerPath.includes(wanted)) rank = 3;
      else if (parts.length > 1 && parts.every((part) => lowerPath.includes(part))) rank = 4;
      else continue;
      scored.push({ path, name, rank });
    }
    scored.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path));
    return scored.slice(0, MAX_RESULTS).map(({ path, name }) => ({ filename: name, path: relativeFrom(folder, path) }));
  }

  private ensureFresh(): Promise<void> {
    if (this.now() - this.builtAt < FRESH_FOR_MS) return Promise.resolve();
    this.building ??= this.walk().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  /** Breadth first, so the files nearest the project root are found before any limit is hit. */
  private async walk(): Promise<void> {
    const started = this.now();
    const files: string[] = [];
    let queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
    let folders = 0;

    while (queue.length > 0 && files.length < MAX_FILES && folders < MAX_FOLDERS && this.now() - started < WALK_BUDGET_MS) {
      const batch = queue.splice(0, 8);
      folders += batch.length;
      const listings = await Promise.all(
        batch.map(async ({ path, depth }) => {
          try {
            return { path, depth, entries: (await this.options.listDir(path === '' ? '.' : path)).entries };
          } catch {
            return { path, depth, entries: [] as readonly DirEntry[] };
          }
        }),
      );
      const next: Array<{ path: string; depth: number }> = [];
      for (const { path, depth, entries } of listings) {
        for (const entry of entries) {
          const child = path === '' ? entry.name : `${path}/${entry.name}`;
          if (entry.kind === 'file') {
            if (files.length < MAX_FILES) files.push(child);
          } else if (entry.kind === 'directory' && depth < MAX_DEPTH && !SKIPPED_FOLDERS.has(entry.name)) {
            next.push({ path: child, depth: depth + 1 });
          }
        }
      }
      queue = [...queue, ...next];
    }

    this.files = files;
    this.builtAt = this.now();
  }
}
