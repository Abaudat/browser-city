// Story 4.6 (FR144): the character-name rule, mirrored from the server's
// `sim::identity::plan_name` so the prompt never offers a name the server
// would refuse. The server is the only authority; both read the one case
// table `fixtures/character-names.v1.tsv`, which keeps them from drifting.
//
// Trimmed, 1..=max scalar values, no control character and no invisible
// format character (zero-width, bidirectional override, BOM).

export type NameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: "empty" | "too-long" | "forbidden-character" };

type Range = readonly [number, number];

/** Rust's `char::is_whitespace`, which `str::trim` uses. */
const WHITESPACE: readonly Range[] = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

/** Control (Cc) and the invisible format characters the server refuses. */
const FORBIDDEN: readonly Range[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
];

const inRanges = (ranges: readonly Range[], cp: number): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

export function planName(raw: string, maxChars: number): NameResult {
  const scalars = [...raw].map((c) => c.codePointAt(0) as number);
  let start = 0;
  let end = scalars.length;
  while (start < end && inRanges(WHITESPACE, scalars[start] as number)) start += 1;
  while (end > start && inRanges(WHITESPACE, scalars[end - 1] as number)) end -= 1;
  const name = scalars.slice(start, end);
  if (name.length === 0) return { ok: false, reason: "empty" };
  if (name.some((cp) => inRanges(FORBIDDEN, cp))) {
    return { ok: false, reason: "forbidden-character" };
  }
  if (name.length > maxChars) return { ok: false, reason: "too-long" };
  return { ok: true, name: String.fromCodePoint(...name) };
}
