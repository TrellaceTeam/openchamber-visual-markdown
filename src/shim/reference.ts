/**
 * Turn the caret or selection in the editor into a reference an agent can read, such as
 * `@docs/plan.md#L10-14`.
 *
 * The line numbers come from Markdown Editor for Humans (src/editor/aiReference.ts): it
 * matches the selected blocks against the file's text and never guesses. When it cannot
 * match them, the reference names the file alone.
 */
import { formatAiReference, resolveAiReferenceLines } from '@upstream/editor/aiReference';
import { parseAiReferenceRequest } from '@upstream/shared/aiReferenceProtocol';

export interface BuiltReference {
  readonly reference: string;
  /** False when the reference names the file without line numbers. */
  readonly exact: boolean;
}

/**
 * @param message - the editor's `copyReferenceForAi` message
 * @param sourceText - the file's text as a save writes it
 * @param path - the file's path as the agent knows it, with forward slashes
 * @returns null when the message is not a reference request
 */
export function buildReference(message: unknown, sourceText: string, path: string): BuiltReference | null {
  const request = parseAiReferenceRequest(message);
  if (!request) return null;
  let lines: ReturnType<typeof resolveAiReferenceLines> = null;
  try {
    lines = resolveAiReferenceLines(sourceText, request.blocks, request.selection);
  } catch {
    lines = null;
  }
  return { reference: formatAiReference(path, lines), exact: lines !== null };
}
