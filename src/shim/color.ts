/**
 * Small colour helpers for theme values OpenChamber sends as hex strings.
 *
 * Some tokens carry transparency (`#e5e1debf`). Mermaid's `base` theme wants plain six-digit
 * hex, so those are laid over the page background first.
 */

export type Rgb = readonly [number, number, number];

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. Returns the colour and its opacity, or null. */
export function parseHex(value: string | undefined): { rgb: Rgb; alpha: number } | null {
  const hex = (value ?? '').trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const channel = (index: number): number => Number.parseInt(full.slice(index, index + 2), 16);
  return { rgb: [channel(0), channel(2), channel(4)], alpha: full.length === 8 ? channel(6) / 255 : 1 };
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` of `b` mixed into `a`: 0 gives `a`, 1 gives `b`. */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

/** A token as a solid colour over `backdrop`. `fallback` is used when the token is missing or not hex. */
export function solid(value: string | undefined, backdrop: Rgb, fallback: Rgb): Rgb {
  const parsed = parseHex(value);
  if (!parsed) return fallback;
  return parsed.alpha >= 1 ? parsed.rgb : mix(backdrop, parsed.rgb, parsed.alpha);
}
