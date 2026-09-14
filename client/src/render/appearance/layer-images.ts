// The "load every layer's sheet, then release every one that did load if
// any of them failed" step `appearance-texture.ts`'s `buildCompositeFrames`
// needs -- generic over an injected `load`/`release` pair, so this is
// testable with fake async functions and belongs to the small set of
// pieces this pipeline pulls out of its two browser-only adapters
// (`part-sheets.ts`, `appearance-texture.ts`) specifically to keep their
// own coverage exclusion honest.

/** Resolves every non-`null` sheet in `sheets` via `load`, in parallel.
 * If any of them rejects, every sheet that *did* load is passed to
 * `release` before the first rejection is rethrown -- a `hairstyle`
 * fetch failing after `body`/`eyes`/`outfit` already resolved must never
 * leave those three permanently referenced (the exact ~2.3MB-per-sheet
 * retention the ref-counted cache in front of `load` exists to prevent,
 * now on the failure path too). On success, returns one value (or `null`
 * for a `null` sheet) per key of `sheets`. */
export async function loadLayerImages<K extends string, T>(
  sheets: Readonly<Record<K, string | null>>,
  load: (sheet: string) => Promise<T>,
  release: (sheet: string, value: T) => void,
): Promise<Readonly<Record<K, T | null>>> {
  const keys = Object.keys(sheets) as K[];
  const settled = await Promise.allSettled(
    keys.map(async (key) => {
      const sheet = sheets[key];
      const value = sheet === null ? null : await load(sheet);
      return { key, sheet, value };
    }),
  );

  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) {
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.sheet !== null) {
        release(result.value.sheet, result.value.value as T);
      }
    }
    throw rejected.reason;
  }

  const images = {} as Record<K, T | null>;
  for (const result of settled) {
    // `rejected` is undefined here, so every entry is fulfilled -- this
    // narrows the type without repeating the check.
    if (result.status === "fulfilled") images[result.value.key] = result.value.value;
  }
  return images;
}
