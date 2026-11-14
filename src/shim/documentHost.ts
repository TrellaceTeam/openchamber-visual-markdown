/**
 * The document as OpenChamber will save it.
 *
 * In VS Code the extension host keeps this text and decides what an edit from the editor
 * does to it. Here the page keeps it. The rules are the ones Markdown Editor for Humans
 * applies on its host side (applyEditNow in src/editor/MarkdownEditorProvider.ts), with two
 * choices of ours:
 *
 * - The file keeps the newlines it ended with. Upstream always writes exactly one.
 * - An edit that brings the document back to what is saved restores the saved text exactly,
 *   so undoing a change leaves the file clean.
 *
 * The aim is that a save changes only what the person changed.
 */
import { applyBlankLinePolicy, type BlankLineMode } from '@upstream/shared/blankLinePolicy';
import { hasSameBlankLineLayout, isMarkdownStructurallyEquivalent } from '@upstream/editor/markdownAstEquivalence';
import { frontmatterIsTight, tightenFrontmatter, unwrapFrontmatter, wrapFrontmatter } from './frontmatter';
import { mergeKeepingStyle, planOrigin, type EditorCheck, type LoadedBlock, type Origin } from './styleMerge';

/**
 * Above this size, the costly work on each edit (merging, comparing) waits until typing
 * pauses. Measured on a 100 KB file it took about a tenth of a second per edit.
 */
export const SETTLE_INLINE_MAX = 50_000;

export type EditOutcome = 'unchanged' | 'changed';

export interface DocumentHostOptions {
  readonly blankLineMode: BlankLineMode;
  /** Compare two Markdown texts by what they render to. Replaceable in tests. */
  readonly equivalent?: (a: string, b: string) => boolean;
}

const trailingNewlines = (text: string): string => /\n*$/.exec(text)?.[0] ?? '';

export class DocumentHost {
  private saved: string;
  private current: string;
  private revision = 1;
  private settled = true;
  /** The editor's latest text, when merging it was put off. */
  private unmerged: string | null = null;
  private origin: Origin | null = null;
  private editor: EditorCheck | null = null;
  private readonly mode: BlankLineMode;
  private readonly sameRendering: (a: string, b: string) => boolean;

  constructor(text: string, options: DocumentHostOptions) {
    this.saved = text;
    this.current = text;
    this.mode = options.blankLineMode;
    this.sameRendering = options.equivalent ?? isMarkdownStructurallyEquivalent;
  }

  /** The text a save would write now. */
  get text(): string {
    return this.current;
  }

  /** The text last known to be on disk. */
  get savedText(): string {
    return this.saved;
  }

  /** Goes up by one each time the document text changes. The editor bases its edits on it. */
  get version(): number {
    return this.revision;
  }

  get dirty(): boolean {
    return this.current !== this.saved;
  }

  /** The document in the form the editor loads: blank-line policy applied, front matter wrapped. */
  contentForEditor(): string {
    return wrapFrontmatter(applyBlankLinePolicy(this.current, this.mode));
  }

  /** Markdown from the editor, in the form it would be written to the file. */
  normalize(editorContent: string): string {
    let policy = applyBlankLinePolicy(unwrapFrontmatter(editorContent), this.mode);
    if (policy === '') return policy;
    if (frontmatterIsTight(this.saved)) policy = tightenFrontmatter(policy);
    const ending = this.saved.trim() === '' ? '\n' : trailingNewlines(this.saved);
    return policy.replace(/\n*$/, '') + ending;
  }

  /**
   * Take the editor's Markdown after a change.
   *
   * The editor writes Markdown in its own style: `*` bullets become `-`, wrapped lines are
   * joined, and so on. When its text renders the same as the current text, the current text
   * is kept, so untouched parts of the file keep the bytes they had.
   */
  applyEditorContent(editorContent: string): EditOutcome {
    // Merging and comparing are the costly steps. A large document takes the editor's text
    // as it comes, and settle() does the work once typing pauses.
    const large = editorContent.length > SETTLE_INLINE_MAX;
    const deferred = large && (this.dirty || this.origin !== null);
    this.unmerged = deferred ? editorContent : null;
    const next = this.normalize(deferred ? editorContent : this.withAuthorStyle(editorContent));
    if (next === this.current) return 'unchanged';
    if (!deferred && this.sameAs(next, this.current)) return 'unchanged';

    this.current = next;
    this.revision += 1;
    this.settled = false;
    if (!large) this.settle();
    return 'changed';
  }

  /**
   * Finish what applyEditorContent put off, and if the document now renders the same as the
   * saved text, go back to the saved text itself. Cheap to call again: it works once per change.
   *
   * @returns true when the text changed
   */
  settle(): boolean {
    if (this.settled) return false;
    this.settled = true;
    let changed = false;
    if (this.unmerged !== null) {
      const next = this.normalize(this.withAuthorStyle(this.unmerged));
      this.unmerged = null;
      if (next !== this.current) {
        this.current = next;
        this.revision += 1;
        changed = true;
      }
    }
    if (this.current === this.saved || !this.sameAs(this.current, this.saved)) return changed;
    this.current = this.saved;
    this.revision += 1;
    return true;
  }

  /**
   * Whether two texts that differ are still the same document.
   *
   * With the editor's blocks known, the merge has already put back every byte the person did
   * not change, so texts that differ are different documents. Without them, the editor's
   * text is in its own style throughout, and the two are compared by what they render to.
   */
  private sameAs(a: string, b: string): boolean {
    return this.origin === null && this.equivalent(a, b);
  }

  /** A snapshot with this text reached the disk. */
  markSaved(text: string): void {
    this.saved = text;
    this.settled = this.unmerged === null;
  }

  /** The host handed over the file again, for example after it changed on disk. */
  replace(text: string): void {
    this.saved = text;
    this.current = text;
    this.revision += 1;
    this.settled = true;
    this.unmerged = null;
    this.origin = null;
  }

  /**
   * Tell the document what the editor made of the text it just loaded.
   *
   * Call right after the editor takes {@link contentForEditor}, before any edit. With this,
   * an edited block keeps the author's style (see styleMerge.ts). Without it, an edited block
   * is saved the way the editor writes it.
   *
   * @param blocks - the editor's top-level blocks, or null when it cannot say
   * @param editor - the editor's blocks as they stand later, and its check of a merged block
   */
  setOrigin(blocks: readonly LoadedBlock[] | null | undefined, editor: EditorCheck | null): void {
    this.editor = editor;
    try {
      this.origin = editor ? planOrigin(this.contentForEditor(), blocks) : null;
    } catch {
      this.origin = null;
    }
  }

  private withAuthorStyle(editorContent: string): string {
    if (!this.origin || !this.editor) return editorContent;
    try {
      return mergeKeepingStyle(this.origin, editorContent, this.editor);
    } catch {
      // The editor's own text is always a correct thing to save.
      return editorContent;
    }
  }

  private equivalent(a: string, b: string): boolean {
    try {
      if (!this.sameRendering(a, b)) return false;
      return this.mode !== 'preserve' || hasSameBlankLineLayout(a, b);
    } catch {
      // A comparison that fails must never hide a real edit.
      return false;
    }
  }
}

/** A short string that changes when the text changes. OpenChamber echoes it back after a save. */
export function versionOf(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
