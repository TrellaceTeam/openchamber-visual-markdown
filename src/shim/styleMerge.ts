/**
 * Keep the file's own Markdown style when part of it is edited.
 *
 * The editor saves an untouched block exactly as written. A block that is edited is written
 * out again from scratch, in the editor's style: `*` bullets become `-`, every line of a
 * hand-wrapped paragraph gets a hard break, `1)` becomes `1.`, a reference link becomes an
 * inline one, a backslash escape can go missing. One changed word then rewrites, and
 * sometimes changes the meaning of, lines the person never touched.
 *
 * This puts the author's text back everywhere the person did not change it. For each edited
 * block there are three texts:
 *
 *   base    the block as loaded, written in the editor's style
 *   ours    the block as loaded, as the author wrote it
 *   theirs  the block now, written in the editor's style
 *
 * What differs between base and theirs is the person's edit. What differs between base and
 * ours is only style. A three-way merge applies the edit to the author's text. The result is
 * kept only if the editor reads it back as the very document on screen; if not, the editor's
 * own text is used, which is what would have been saved without this file.
 */
import { diff3, lcsMap } from './diff3';

/** One top-level block of the loaded document, from the editor (see patches/0004-host-bridge.patch). */
export interface LoadedBlock {
  /** The block's Markdown as authored, or null when the editor does not hold it. */
  readonly source: string | null;
  /** What the editor writes for the block once it is edited. */
  readonly serialized: string;
}

/** A run of lines of the loaded text, and how the editor would write the same content. */
export interface OriginEntry {
  /** First line of the run. */
  readonly start: number;
  /** One past its last line. */
  readonly end: number;
  readonly canonical: string;
}

export interface Origin {
  /** The loaded text, in the form the editor was given. */
  readonly content: string;
  readonly lines: readonly string[];
  readonly entries: readonly OriginEntry[];
}

/** What the merge asks the editor (see patches/0004-host-bridge.patch). */
export interface EditorCheck {
  /** The Markdown of each block now, exactly as the editor writes it, in document order. */
  currentBlocks: () => readonly string[] | null;
  /**
   * Whether `markdown` loads as blocks `from` up to `to` of that list or, failing that, as
   * `alternative` loads. Anything either holds after those blocks is ignored.
   *
   * `alternative` is the editor's own text for the same blocks. The editor's text does not
   * always load back as what is on screen: a space typed before a line break is one case.
   * A merged text that loads the same as it is no worse than what would have been saved.
   */
  matchesBlocks: (from: number, to: number, markdown: string, alternative: string) => boolean;
}

/** Above these sizes the merge is skipped and the editor's text is used. */
export const MAX_LINE_DIFFERENCE = 2500;
export const MAX_CHAR_DIFFERENCE = 1500;
export const MAX_CHUNK_CHARS = 40_000;
export const MAX_TOUCHED_ENTRIES = 400;

/** Split into lines that keep their line ending, so joining them gives the text back. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n').map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line));
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const isBlank = (line: string): boolean => line.trim() === '';

/** Finds where blocks sit in a text, one after another. */
function blockFinder(content: string, lines: readonly string[]): (block: string, from: number) => { start: number; end: number; after: number } | null {
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length;
  }
  const lineAt = (position: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  return (block, from) => {
    // A block starts a line and ends one. Skip matches that are part of something else.
    let found = content.indexOf(block, from);
    while (found >= 0) {
      const lineStart = content.lastIndexOf('\n', found - 1) + 1;
      const after = found + block.length;
      const lineEnd = content.indexOf('\n', after);
      const startsLine = content.slice(lineStart, found).trim() === '';
      const endsLine = content.slice(after, lineEnd < 0 ? content.length : lineEnd).trim() === '';
      if (startsLine && endsLine) return { start: lineAt(found), end: lineAt(Math.max(found, after - 1)) + 1, after };
      found = content.indexOf(block, found + 1);
    }
    return null;
  };
}

/**
 * Where each of the editor's current blocks sits in the editor's text, as line ranges.
 *
 * @returns null when a block is not in the text, which means the two are from different moments
 */
export function placeBlocks(text: string, lines: readonly string[], blocks: readonly string[]): Array<{ start: number; end: number }> | null {
  const find = blockFinder(text, lines);
  const placed: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const block of blocks) {
    const at = find(block, cursor);
    if (!at) return null;
    placed.push({ start: at.start, end: at.end });
    cursor = at.after;
  }
  return placed;
}

/**
 * Work out where each loaded block sits in the loaded text.
 *
 * @param content - the text the editor loaded
 * @param blocks - the editor's blocks, in document order
 * @returns null when the blocks cannot be matched to the text, in which case nothing is merged
 */
export function planOrigin(content: string, blocks: readonly LoadedBlock[] | null | undefined): Origin | null {
  if (!blocks || blocks.length === 0) return null;
  const lines = splitLines(content);
  const find = blockFinder(content, lines);

  const entries: OriginEntry[] = [];
  let cursor = 0; // character offset after the last placed block
  let cursorLine = 0;
  let waiting: string[] = []; // blocks without source since the last placed block

  /** The lines between two placed blocks belong to the blocks whose source is unknown. */
  const placeWaiting = (untilLine: number): void => {
    if (waiting.length === 0) return;
    let start = cursorLine;
    let end = untilLine;
    while (start < end && isBlank(lines[start])) start += 1;
    while (end > start && isBlank(lines[end - 1])) end -= 1;
    if (end > start) entries.push({ start, end, canonical: waiting.join('\n\n') });
    waiting = [];
  };

  for (const block of blocks) {
    if (block.source === null || block.source === '') {
      waiting.push(block.serialized);
      continue;
    }
    const at = find(block.source, cursor);
    if (!at) return null;
    placeWaiting(at.start);
    entries.push({ start: at.start, end: at.end, canonical: block.serialized });
    cursor = at.after;
    cursorLine = at.end;
  }
  placeWaiting(lines.length);
  return { content, lines, entries };
}

const idsOf = (lines: readonly string[], table: Map<string, number>): Int32Array => {
  const ids = new Int32Array(lines.length);
  lines.forEach((line, index) => {
    let id = table.get(line);
    if (id === undefined) {
      id = table.size;
      table.set(line, id);
    }
    ids[index] = id;
  });
  return ids;
};

const codesOf = (text: string): Uint16Array => {
  const codes = new Uint16Array(text.length);
  for (let index = 0; index < text.length; index += 1) codes[index] = text.charCodeAt(index);
  return codes;
};

const isWhitespace = (text: string): boolean => /^\s*$/.test(text);

/**
 * Merge two versions of a short text, character by character.
 *
 * @returns null when both sides changed the same characters to different things
 */
export function mergeCharacters(o: string, a: string, b: string): string | null {
  if (a === o) return b;
  if (b === o || a === b) return a;
  if (o.length + a.length + b.length > MAX_CHUNK_CHARS) return null;
  const oCodes = codesOf(o);
  const toA = lcsMap(oCodes, codesOf(a), MAX_CHAR_DIFFERENCE);
  const toB = lcsMap(oCodes, codesOf(b), MAX_CHAR_DIFFERENCE);
  if (!toA || !toB) return null;

  let merged = '';
  for (const chunk of diff3(o.length, a.length, b.length, toA, toB)) {
    if (chunk.stable) {
      merged += o.slice(chunk.oStart, chunk.oStart + chunk.length);
      continue;
    }
    const base = o.slice(chunk.o[0], chunk.o[1]);
    const ours = a.slice(chunk.a[0], chunk.a[1]);
    const theirs = b.slice(chunk.b[0], chunk.b[1]);
    if (ours === base) merged += theirs;
    else if (theirs === base || ours === theirs) merged += ours;
    // Both changed the same spot. If each changed different characters of it (`3.` became
    // `3)` on one side and `2.` on the other), take both changes.
    else if (base.length === ours.length && base.length === theirs.length && [...base].every((character, index) => ours[index] === character || theirs[index] === character || ours[index] === theirs[index])) {
      merged += [...base].map((character, index) => (ours[index] === character ? theirs[index] : ours[index])).join('');
    }
    // When one side only added text next to the spot, keep the other side's version of it
    // and add that text in the same place.
    else if (base !== '' && theirs.startsWith(base)) merged += ours + theirs.slice(base.length);
    else if (base !== '' && theirs.endsWith(base)) merged += theirs.slice(0, theirs.length - base.length) + ours;
    else if (base !== '' && ours.startsWith(base)) merged += theirs + ours.slice(base.length);
    else if (base !== '' && ours.endsWith(base)) merged += ours.slice(0, ours.length - base.length) + theirs;
    // Spacing is style: when one side only changed spacing, the other side's change is the
    // one that carries meaning.
    else if (isWhitespace(base) && isWhitespace(theirs)) merged += ours;
    else if (isWhitespace(base) && isWhitespace(ours)) merged += theirs;
    else return null;
  }
  return merged;
}

const BULLET = /^(\s*(?:>\s*)*)([-*+])(\s+)/;
const ORDERED = /^(\s*(?:>\s*)*)(\d{1,9})([.)])(\s+)/;

/**
 * Give list items that were added the marker their siblings use.
 *
 * A new item arrives written the editor's way (`- item`). In a list the author wrote with
 * `*`, a different marker would start a new list.
 */
export function harmonizeListMarkers(lines: readonly string[]): string[] {
  const bulletCounts = new Map<string, Map<string, number>>();
  const orderedCounts = new Map<string, Map<string, number>>();
  const count = (table: Map<string, Map<string, number>>, indent: string, marker: string): void => {
    const byMarker = table.get(indent) ?? new Map<string, number>();
    byMarker.set(marker, (byMarker.get(marker) ?? 0) + 1);
    table.set(indent, byMarker);
  };
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    if (bullet) count(bulletCounts, bullet[1], bullet[2]);
    const ordered = ORDERED.exec(line);
    if (ordered) count(orderedCounts, ordered[1], ordered[3]);
  }
  const favourite = (table: Map<string, Map<string, number>>, indent: string): string | null => {
    const byMarker = table.get(indent);
    if (!byMarker || byMarker.size < 2) return null;
    return [...byMarker].sort((x, y) => y[1] - x[1])[0][0];
  };
  return lines.map((line) => {
    const bullet = BULLET.exec(line);
    if (bullet) {
      const marker = favourite(bulletCounts, bullet[1]);
      return marker && marker !== bullet[2] ? `${bullet[1]}${marker}${line.slice(bullet[1].length + 1)}` : line;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      const delimiter = favourite(orderedCounts, ordered[1]);
      const at = ordered[1].length + ordered[2].length;
      return delimiter && delimiter !== ordered[3] ? `${line.slice(0, at)}${delimiter}${line.slice(at + 1)}` : line;
    }
    return line;
  });
}

/** A line with its spacing removed, and the dashes of a table's divider row counted as one. */
const withoutPadding = (line: string): string => {
  const squeezed = line.replace(/\s+/g, '');
  return /^[|:-]+$/.test(squeezed) ? squeezed.replace(/-+/g, '-') : squeezed;
};

/** One line as the author wrote it, with the person's change to that line applied. */
function mergeLine(base: string, ours: string, theirs: string): string {
  if (theirs === base || ours === theirs) return ours;
  if (ours === base) return theirs;
  // The editor only moved padding on this line, as it does to every row of a table when
  // one cell gets wider. The author's line still says the same thing.
  if (withoutPadding(theirs) === withoutPadding(base)) return ours;
  return mergeCharacters(base, ours, theirs) ?? theirs;
}

/** What a line says, leaving out its indent, list marker and number. Used to pair up lines. */
const lineKey = (line: string): string =>
  line
    .replace(/^\s*(?:>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+)?/, '')
    .replace(/^\[[xX]\]/, '[x]')
    .trimEnd();

/**
 * Pair the lines of `from` with the lines of `to`: first those that say the same thing, then,
 * between two such pairs, lines left over in equal number, in order.
 */
function pairLines(from: readonly string[], to: readonly string[]): Int32Array | null {
  const table = new Map<string, number>();
  const map = lcsMap(idsOf(from.map(lineKey), table), idsOf(to.map(lineKey), table), MAX_LINE_DIFFERENCE);
  if (!map) return null;
  let fromStart = 0;
  let toStart = 0;
  for (let index = 0; index <= from.length; index += 1) {
    const atEnd = index === from.length;
    if (!atEnd && map[index] < 0) continue;
    const toEnd = atEnd ? to.length : map[index];
    if (index - fromStart === toEnd - toStart) {
      for (let offset = 0; offset < index - fromStart; offset += 1) map[fromStart + offset] = toStart + offset;
    }
    fromStart = index + 1;
    toStart = toEnd + 1;
  }
  return map;
}

/**
 * Merge a stretch where lines were added or removed, by pairing lines up first.
 *
 * A line the person removed is dropped. A line the person added is kept as the editor wrote
 * it. Every other line is the author's, with the person's change to it applied.
 */
function mergeByPairing(o: readonly string[], a: readonly string[], b: readonly string[]): string[] | null {
  const toA = pairLines(o, a);
  const toB = pairLines(o, b);
  if (!toA || !toB) return null;
  const lines: string[] = [];
  let nextA = 0;
  let nextB = 0;
  for (let index = 0; index < o.length; index += 1) {
    const inA = toA[index];
    const inB = toB[index];
    // Lines only the author has (a blank line between list items, say) sit before the line
    // they belong to. They go when that line goes.
    const authorOnly = inA >= 0 ? a.slice(nextA, inA) : [];
    if (inA >= 0) nextA = inA + 1;
    if (inB < 0) continue;
    lines.push(...authorOnly, ...b.slice(nextB, inB));
    nextB = inB + 1;
    lines.push(inA >= 0 ? mergeLine(o[index], a[inA], b[inB]) : b[inB]);
  }
  lines.push(...a.slice(nextA), ...b.slice(nextB));
  return lines;
}

/** Merge a stretch of lines both sides changed. Returns null when the editor's lines are all there is. */
function mergeConflict(o: readonly string[], a: readonly string[], b: readonly string[]): string[] | null {
  if (o.length === a.length && a.length === b.length) {
    // Same number of lines on all sides: settle it line by line.
    return o.map((base, index) => mergeLine(base, a[index], b[index]));
  }
  const merged = mergeCharacters(o.join(''), a.join(''), b.join(''));
  return merged === null ? mergeByPairing(o, a, b) : splitLines(merged);
}

const sameLines = (x: readonly string[], y: readonly string[]): boolean => x.length === y.length && x.every((value, index) => value === y[index]);

/** A stretch of the result, and the stretch of the editor's text it stands for. */
interface Piece {
  /** Lines of the editor's text this covers: [start, end). */
  readonly start: number;
  readonly end: number;
  /** What to write for it. For `same` these are the editor's own lines. */
  readonly lines: readonly string[];
  /**
   * same    the editor's own lines
   * ours    the author's lines, where the person changed nothing
   * merged  the author's lines with the person's change worked in
   */
  readonly kind: 'same' | 'ours' | 'merged';
}

/** Link and footnote definitions. A block that uses one only reads the same with them present. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/;

/**
 * The editor's text with the author's style put back where the person changed nothing.
 *
 * Each edited block is checked on its own: the merged block is kept only when the editor
 * reads it back as the block on screen. A block that fails the check is written the way the
 * editor wrote it, and the other blocks are not affected.
 *
 * @param origin - the loaded text and its blocks, from {@link planOrigin}
 * @param editorText - the editor's text now
 * @param editor - the editor's blocks as they stand, and its check
 * @returns the text to keep: `editorText` itself when there is nothing to put back
 */
export function mergeKeepingStyle(origin: Origin | null, editorText: string, editor: EditorCheck): string {
  if (!origin || editorText === origin.content) return editorText;

  // The editor's text has no newline at its end. Give it the one the loaded text has, so
  // the last line is compared like any other. The caller sets the file's real ending.
  const ending = /\n*$/.exec(origin.content)?.[0] ?? '';
  const theirs = editorText.replace(/\n*$/, '') + ending;
  if (theirs === origin.content) return theirs;

  const ours = origin.lines;
  const theirLines = splitLines(theirs);
  const table = new Map<string, number>();
  const ourIds = idsOf(ours, table);
  const theirIds = idsOf(theirLines, table);
  const toTheirs = lcsMap(ourIds, theirIds, MAX_LINE_DIFFERENCE);
  if (!toTheirs) return editorText;

  // Lines of the loaded text that are gone or changed, and places where lines were added.
  const insertedBefore = new Uint8Array(ours.length + 1);
  let expected = 0;
  for (let index = 0; index < ours.length; index += 1) {
    if (toTheirs[index] < 0) continue;
    if (toTheirs[index] > expected) insertedBefore[index] = 1;
    expected = toTheirs[index] + 1;
  }

  const touched = origin.entries.filter((entry) => {
    for (let line = entry.start; line < entry.end; line += 1) {
      if (toTheirs[line] < 0) return true;
      if (line > entry.start && insertedBefore[line] === 1) return true;
    }
    return false;
  });
  if (touched.length === 0 || touched.length > MAX_TOUCHED_ENTRIES) return editorText;

  // The base: the loaded text, with each touched block written the editor's way.
  const base: string[] = [];
  let line = 0;
  for (const entry of touched) {
    for (; line < entry.start; line += 1) base.push(ours[line]);
    const lineEnding = ours[entry.end - 1].endsWith('\n') ? '\n' : '';
    const canonical = splitLines(entry.canonical);
    if (canonical.length > 0) canonical[canonical.length - 1] = canonical[canonical.length - 1].replace(/\n$/, '') + lineEnding;
    base.push(...canonical);
    line = entry.end;
  }
  for (; line < ours.length; line += 1) base.push(ours[line]);

  const baseIds = idsOf(base, table);
  const baseToOurs = lcsMap(baseIds, ourIds, MAX_LINE_DIFFERENCE);
  const baseToTheirs = lcsMap(baseIds, theirIds, MAX_LINE_DIFFERENCE);
  if (!baseToOurs || !baseToTheirs) return editorText;

  const pieces: Piece[] = [];
  for (const chunk of diff3(base.length, ours.length, theirLines.length, baseToOurs, baseToTheirs)) {
    if (chunk.stable) {
      pieces.push({ start: chunk.bStart, end: chunk.bStart + chunk.length, lines: theirLines.slice(chunk.bStart, chunk.bStart + chunk.length), kind: 'same' });
      continue;
    }
    const o = base.slice(chunk.o[0], chunk.o[1]);
    const a = ours.slice(chunk.a[0], chunk.a[1]);
    const b = theirLines.slice(chunk.b[0], chunk.b[1]);
    const [start, end] = chunk.b;
    if (sameLines(a, b) || sameLines(a, o)) {
      pieces.push({ start, end, lines: b, kind: 'same' });
    } else if (sameLines(b, o)) {
      pieces.push({ start, end, lines: a, kind: 'ours' });
    } else {
      const merged = mergeConflict(o, a, b);
      pieces.push(merged === null || sameLines(merged, b) ? { start, end, lines: b, kind: 'same' } : { start, end, lines: merged, kind: 'merged' });
    }
  }
  if (pieces.every((piece) => piece.kind === 'same')) return editorText;

  // Where each of the editor's blocks sits in its text.
  const blocks = editor.currentBlocks();
  const placed = blocks ? placeBlocks(theirs, theirLines, blocks) : null;
  if (!placed || placed.length === 0) return editorText;

  /** The blocks a stretch of the editor's text touches, as [first, last]. */
  const blocksAt = (start: number, end: number): [number, number] => {
    let first = placed.findIndex((block) => block.end > start);
    if (first < 0) first = placed.length - 1;
    let last = first;
    while (last + 1 < placed.length && placed[last + 1].start < end) last += 1;
    // A stretch that sits wholly between two blocks goes with the block before it.
    if (placed[first].start >= Math.max(end, start + 1) && first > 0) first -= 1;
    return [first, Math.max(first, last)];
  };

  // Group the changed pieces by the blocks they fall in. Each group is checked on its own.
  const groups: Array<{ first: number; last: number; from: number; to: number }> = [];
  for (const piece of pieces) {
    if (piece.kind === 'same') continue;
    const [first, last] = blocksAt(piece.start, piece.end);
    const from = Math.min(piece.start, placed[first].start);
    const to = Math.max(piece.end, placed[last].end);
    const previous = groups[groups.length - 1];
    if (previous && first <= previous.last) {
      previous.last = Math.max(previous.last, last);
      previous.from = Math.min(previous.from, from);
      previous.to = Math.max(previous.to, to);
    } else {
      groups.push({ first, last, from, to });
    }
  }

  const definitions = theirLines.filter((text) => DEFINITION.test(text));
  const context = definitions.length > 0 ? `\n\n${definitions.map((text) => (text.endsWith('\n') ? text : `${text}\n`)).join('')}` : '';

  type Choice = (piece: Piece) => readonly string[];
  const merged: Choice = (piece) => piece.lines;
  const choices: Choice[] = [
    merged,
    // The same, with added list items given their siblings' marker.
    (piece) => (piece.kind === 'merged' ? harmonizeListMarkers(piece.lines) : piece.lines),
    // Only whole-line choices: where characters were merged, the editor's lines.
    (piece) => (piece.kind === 'merged' ? theirLines.slice(piece.start, piece.end) : piece.lines),
  ];
  const editorLines: Choice = (piece) => theirLines.slice(piece.start, piece.end);

  const chosen = new Map<Piece, Choice>();
  for (const group of groups) {
    const inside = pieces.filter((piece) => (piece.end > group.from && piece.start < group.to) || (piece.start === piece.end && piece.start >= group.from && piece.start <= group.to && piece.kind !== 'same'));
    /** The text of this group's blocks, with one of the choices applied. */
    const textWith = (choice: Choice): string =>
      inside
        .map((piece) => {
          if (piece.kind !== 'same') return choice(piece).join('');
          // A piece of the editor's own lines may reach past the group. Take the part inside.
          return theirLines.slice(Math.max(piece.start, group.from), Math.min(piece.end, group.to)).join('');
        })
        .join('');
    const editorsOwn = textWith(editorLines);
    const tried = new Set<string>([editorsOwn]);
    let pick = editorLines;
    for (const choice of choices) {
      const candidate = textWith(choice);
      if (tried.has(candidate)) continue;
      tried.add(candidate);
      if (editor.matchesBlocks(group.first, group.last + 1, candidate + context, editorsOwn + context)) {
        pick = choice;
        break;
      }
    }
    for (const piece of inside) {
      if (piece.kind !== 'same') chosen.set(piece, pick);
    }
  }

  const result = pieces.map((piece) => (piece.kind === 'same' ? piece.lines : (chosen.get(piece) ?? editorLines)(piece)).join('')).join('');
  return result === theirs ? editorText : result;
}
