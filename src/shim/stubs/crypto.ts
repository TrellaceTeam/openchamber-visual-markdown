// A stand-in for Node's `crypto` module, which a browser page does not have.
//
// One of upstream's host-side files uses `createHash('sha256')` to tell whether two pieces
// of Markdown are the same text. Here both sides of every such comparison are hashed in this
// page, in this session, so any hash that gives the same answer for the same text will do.
// This is not SHA-256 and must not be used where a real digest is needed.

class TextFingerprint {
  private a = 0x811c9dc5;
  private b = 0x01000193;
  private length = 0;

  update(data: string | Uint8Array): this {
    const at = typeof data === 'string' ? (index: number): number => data.charCodeAt(index) : (index: number): number => data[index];
    for (let index = 0; index < data.length; index += 1) {
      const value = at(index);
      this.a = Math.imul(this.a ^ value, 0x01000193) >>> 0;
      this.b = (Math.imul(this.b, 31) + value + (this.a >>> 7)) >>> 0;
    }
    this.length += data.length;
    return this;
  }

  digest(): string {
    return [this.a, this.b, this.length >>> 0].map((part) => part.toString(16).padStart(8, '0')).join('');
  }
}

export function createHash(): TextFingerprint {
  return new TextFingerprint();
}
