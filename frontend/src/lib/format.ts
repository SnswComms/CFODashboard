// Formatters and status colours, ported verbatim from the design's app-script.js.

/** Design font stack (Poppins via next/font CSS variable). */
export const FONT = "var(--font-poppins), 'Poppins', sans-serif";

/** Full-figure currency: $1,234,567 / negatives as ($1,234,567). */
export function fmtF(x: number): string {
  const s = '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
  return x < 0 ? '(' + s + ')' : s;
}

/** Compact currency: $1.23M / $45K / $999 / negatives in parentheses. */
export function fmtC(x: number): string {
  const n = Math.abs(x);
  let s: string;
  if (n >= 1e6) s = '$' + (n / 1e6).toFixed(2) + 'M';
  else if (n >= 1e3) s = '$' + Math.round(n / 1e3) + 'K';
  else s = '$' + Math.round(n);
  return x < 0 ? '(' + s + ')' : s;
}

/** Status class used across the design. Anything else falls through to ink/neutral. */
export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | '';

/** Foreground colour for a status class (default ink #1B2430). */
export function color(cls: string): string {
  return cls === 'good' ? '#3E7A55' : cls === 'warn' ? '#8A6A2A' : cls === 'bad' ? '#A8443B' : '#1B2430';
}

/** Background tint for a status class (default neutral tint #F1EFEA). */
export function tint(cls: string): string {
  return cls === 'good' ? '#EEF3EF' : cls === 'warn' ? '#F7F1E6' : cls === 'bad' ? '#F7ECEA' : '#F1EFEA';
}
