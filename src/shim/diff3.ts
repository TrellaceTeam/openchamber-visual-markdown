/**
 * A three-way merge over any sequence: lines of a file, or the characters of a line.
 *
 * Given a common ancestor `o` and two versions `a` and `b`, it finds the parts all three
 * share and, between those, what each side changed. The caller decides what to do when
 * both sides changed the same part.
 */

/**
 * The longest common subsequence of `a` and `b`, as a map from each index of `a` to the
 * index of `b` it matches, or -1. Myers' O(ND) algorithm.
 *
 * @param maxDifference - give up (return null) when the two differ by more edits than this
 */
export function lcsMap(a: ArrayLike<number>, b: ArrayLike<number>, maxDifference: number): Int32Array | null {
  const map = new Int32Array(a.length).fill(-1);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    map[start] = start;
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    map[endA] = endB;
  }

  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return map;

  const max = n + m;
  if (Math.min(n, m) === 0) return map;
  const limit = Math.min(max, maxDifference);
  // v[k + offset] is the furthest x reached on diagonal k (k = x - y).
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // What v looked like before each round, cut down to the diagonals that round could read.
  const trace: Array<{ from: number; values: Int32Array }> = [];
  let reached = -1;

  for (let d = 0; d <= limit && reached < 0; d += 1) {
    const from = offset - d - 1;
    trace.push({ from, values: v.slice(from, offset + d + 2) });
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]) ? v[k + 1 + offset] : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        reached = d;
        break;
      }
    }
  }
  if (reached < 0) return null;

  let x = n;
  let y = m;
  for (let d = reached; d > 0; d -= 1) {
    const { from, values } = trace[d];
    const at = (k: number): number => values[k + offset - from];
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      map[start + x] = start + y;
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    map[start + x] = start + y;
  }
  return map;
}

/** A stretch all three versions share, or a stretch where at least one differs from `o`. */
export type Chunk =
  | { readonly stable: true; readonly oStart: number; readonly length: number; readonly aStart: number; readonly bStart: number }
  | { readonly stable: false; readonly o: readonly [number, number]; readonly a: readonly [number, number]; readonly b: readonly [number, number] };

/**
 * Split three versions into shared and differing stretches.
 *
 * @param toA - {@link lcsMap} of `o` against `a`
 * @param toB - {@link lcsMap} of `o` against `b`
 * @returns chunks in order; each range is [start, end) in its own sequence
 */
export function diff3(oLength: number, aLength: number, bLength: number, toA: Int32Array, toB: Int32Array): Chunk[] {
  const chunks: Chunk[] = [];
  let o = 0;
  let a = 0;
  let b = 0;
  let stableFrom = -1;

  const closeStable = (end: number): void => {
    if (stableFrom < 0) return;
    chunks.push({ stable: true, oStart: stableFrom, length: end - stableFrom, aStart: toA[stableFrom], bStart: toB[stableFrom] });
    stableFrom = -1;
  };

  for (let index = 0; index <= oLength; index += 1) {
    const atEnd = index === oLength;
    if (!atEnd && (toA[index] < 0 || toB[index] < 0)) continue;
    const nextA = atEnd ? aLength : toA[index];
    const nextB = atEnd ? bLength : toB[index];
    if (index > o || nextA > a || nextB > b) {
      closeStable(o);
      chunks.push({ stable: false, o: [o, index], a: [a, nextA], b: [b, nextB] });
    }
    if (atEnd) {
      closeStable(oLength);
      break;
    }
    if (stableFrom < 0) stableFrom = index;
    o = index + 1;
    a = nextA + 1;
    b = nextB + 1;
  }
  return chunks;
}
