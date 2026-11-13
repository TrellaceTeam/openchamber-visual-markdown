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
import { unwrapFrontmatter, wrapFrontmatter } from './frontmatter';

/** Above this size the "is it back to the saved text" check waits until typing pauses. */
export const SETTLE_INLINE_MAX = 200_000;

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
    const policy = applyBlankLinePolicy(unwrapFrontmatter(editorContent), this.mode);
    if (policy === '') return policy;
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
    const next = this.normalize(editorContent);
    if (next === this.current) return 'unchanged';
    // Rendering both texts is the costly step. A large document that is already being
    // edited takes the editor's text as it comes, and settle() compares once typing pauses.
    const large = next.length > SETTLE_INLINE_MAX;
    if (!(large && this.dirty) && this.equivalent(next, this.current)) return 'unchanged';

    this.current = next;
    this.revision += 1;
    this.settled = false;
    if (!large) this.settle();
    return 'changed';
  }

  /**
   * If the document now renders the same as the saved text, go back to the saved text itself.
   * Cheap to call again: it does the comparison once per change.
   *
   * @returns true when the text was changed back
   */
  settle(): boolean {
    if (this.settled) return false;
    this.settled = true;
    if (this.current === this.saved || !this.equivalent(this.current, this.saved)) return false;
    this.current = this.saved;
    this.revision += 1;
    return true;
  }

  /** A snapshot with this text reached the disk. */
  markSaved(text: string): void {
    this.saved = text;
    this.settled = true;
  }

  /** The host handed over the file again, for example after it changed on disk. */
  replace(text: string): void {
    this.saved = text;
    this.current = text;
    this.revision += 1;
    this.settled = true;
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
