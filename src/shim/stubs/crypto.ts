// A stand-in for Node's `crypto` module.
//
// Upstream's feedback snapshot code hashes file text with it. That code is not used here; the
// functions the shim does use from the same file never hash anything.
export function createHash(): never {
  throw new Error('Hashing is not available in the editor page.');
}
