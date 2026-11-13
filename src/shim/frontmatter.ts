/**
 * YAML front matter is shown in the editor as a fenced code block, and turned back into
 * front matter before the text is saved.
 *
 * Ported from the host side of Markdown Editor for Humans
 * (src/editor/MarkdownEditorProvider.ts, wrapFrontmatterForWebview and
 * unwrapFrontmatterFromWebview). Copyright (c) 2025-2026 Concret.io, MIT License.
 */

/** Wrap leading front matter in a fenced `yaml` block. Text without front matter is returned as is. */
export function wrapFrontmatter(content: string): string {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return content;

  const usesCrLf = match[0].includes('\r\n');
  const newline = usesCrLf ? '\r\n' : '\n';
  const frontmatterBlock = match[0].replace(/\s+$/, '');
  const body = content.slice(match[0].length);

  // A fence longer than any backtick run inside the front matter, so a ``` in a YAML value
  // cannot close the block early.
  const backtickRuns = frontmatterBlock.match(/`{3,}/g);
  const fence = backtickRuns ? '`'.repeat(Math.max(...backtickRuns.map((run) => run.length)) + 1) : '```';

  const pieces = [`${fence}yaml`, frontmatterBlock, fence];
  if (body.length > 0) {
    const trimmedBody = body.startsWith('\n') || body.startsWith('\r\n') ? body.replace(/^\r?\n/, '') : body;
    pieces.push('', trimmedBody);
  }
  return pieces.join(newline);
}

/** Turn a wrapped front matter block back into `---` delimited front matter. */
export function unwrapFrontmatter(content: string): string {
  if (!content.startsWith('```')) return content;

  const usesCrLf = content.includes('\r\n');
  const newline = usesCrLf ? '\r\n' : '\n';
  const lines = content.split(newline);

  const fenceMatch = lines[0]
    .trim()
    .toLowerCase()
    .match(/^(`{3,})(yaml|yml|json)$/);
  if (!fenceMatch) return content;
  const fence = fenceMatch[1];

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === fence);
  if (closingIndex === -1) return content;

  const insideLines = lines.slice(1, closingIndex);
  if (insideLines.length === 0 || insideLines[0].trim() !== '---') return content;

  const frontmatterSection = insideLines.join(newline);
  const body = lines.slice(closingIndex + 1).join(newline);
  const separator = body.length > 0 ? newline : '';
  return frontmatterSection + separator + body;
}
