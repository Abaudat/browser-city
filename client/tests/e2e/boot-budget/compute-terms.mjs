// Story 1.14 (NFR1), cycle 2 (Quentin's direction): the attribution logic,
// moved out of the Playwright spec into its own pure module -- the early
// ATLAS_READY placement bug (cycle 1) was found here, and a fallback that
// turns a missing mark into a silent zero-length term is exactly the kind
// of thing that would have hidden it rather than failing loudly. Every
// required mark is asserted present; a missing one throws, never falls
// back to `?? 0`.
//
// `raw` (as captured by boot-budget.spec.ts's `page.evaluate`) is:
//   {
//     marks: Record<string, number>,           // performance.mark() startTime, by name
//     firstPaintMs: number | null,              // first-contentful-paint entry
//     entryScriptUrl: string,                   // document.querySelector('script[type=module]').src
//     resources: Array<{
//       name, initiatorType, fetchStart, requestStart, responseEnd,
//       transferSize, nextHopProtocol,
//     }>,
//   }

/** Cycle 3 (both leads' direction): the subset of `terms` that are
 * genuinely sequential, non-overlapping phases in the real boot sequence
 * -- `reduce.mjs`'s `summarizeTerms` sums exactly this list for the
 * "unattributed remainder" row, never every term. `atlasFetch` is left
 * out because it is a sub-interval of `atlasDecoded` (both nested,
 * same fetches), and `handshake`/`subscriptionDecode` are left out
 * because `main.ts` never awaits `connect()` before starting the street
 * scene -- they run concurrently with `defs`/`atlasDecoded`, not after
 * them. The sequential, awaited chain is: bundle -> eval -> defs (awaited
 * before the scene mounts) -> atlasDecoded (the scene's own texture
 * loading, the last awaited phase before the ticker starts) ->
 * toControllable. */
export const DISJOINT_TERM_NAMES = ["bundle", "eval", "defs", "atlasDecoded", "toControllable"];

const REQUIRED_MARKS = [
  "bc-boot:main-start",
  "bc-boot:handshake-open",
  "bc-boot:subscription-applied",
  "bc-boot:atlas-ready",
  "bc-boot:interactive-prompt",
  "bc-boot:player-controllable",
];

function requireMark(marks, name) {
  const value = marks[name];
  if (typeof value !== "number") {
    throw new Error(
      `computeSampleTerms: missing required boot mark '${name}' -- a sample missing a mark must fail loudly, never silently report a zero-length term`,
    );
  }
  return value;
}

function medianOf(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Turns one page's raw marks/paint/resource-timing entries into the named
 * terms the report's attribution table reads. Every term is its own
 * self-contained wall-clock duration for its own phase (Resource Timing
 * for fetch/decode, the boot marks for everything the browser cannot see
 * on its own), not a disjoint slice of the total -- terms can legitimately
 * overlap (the handshake proceeds concurrently with the defs/atlas fetch
 * in the real boot sequence today), so they are never forced to sum to the
 * total; `reduce.mjs`'s `summarizeTerms` computes the remainder from
 * exactly this shape. */
export function computeSampleTerms(raw) {
  for (const name of REQUIRED_MARKS) requireMark(raw.marks, name);

  const mainStart = raw.marks["bc-boot:main-start"];
  const handshakeOpen = raw.marks["bc-boot:handshake-open"];
  const subscriptionApplied = raw.marks["bc-boot:subscription-applied"];
  const atlasReady = raw.marks["bc-boot:atlas-ready"];
  const interactivePrompt = raw.marks["bc-boot:interactive-prompt"];
  const playerControllable = raw.marks["bc-boot:player-controllable"];

  // Quentin's direction: `bundle` is the entry script's own Resource
  // Timing, never `mainStart` -- `mainStart` lumps HTML parse, bundle
  // transfer *and* module evaluation together under one name. The
  // evaluation gap (script finished loading, but `main()` had not yet run)
  // is its own term, `eval`, rather than folded back into `bundle`.
  if (!raw.entryScriptUrl) {
    throw new Error(
      "computeSampleTerms: raw.entryScriptUrl is required to attribute the bundle term",
    );
  }
  const entryResource = raw.resources.find((r) => r.name === raw.entryScriptUrl);
  if (!entryResource) {
    throw new Error(
      `computeSampleTerms: no Resource Timing entry found for the entry script (${raw.entryScriptUrl})`,
    );
  }
  const bundleMs = entryResource.responseEnd - entryResource.fetchStart;
  const evalMs = Math.max(0, mainStart - entryResource.responseEnd);

  const defsResources = raw.resources.filter((r) => r.name.endsWith("/defs/defs.json"));
  const defsMs =
    defsResources.length > 0
      ? Math.max(...defsResources.map((r) => r.responseEnd - r.fetchStart))
      : 0;

  // There is no real atlas yet: every image fetched before the player is
  // controllable stands in for it. Tim's direction: `atlasFetch` is
  // transfer only (first fetchStart -> last responseEnd); `atlasDecoded`
  // is the term that actually matches "fetching and decoding" -- first
  // fetchStart -> ATLAS_READY, the mark that fires once every texture is
  // actually decoded and uploaded, not merely downloaded.
  const imageResources = raw.resources.filter(
    (r) => /\.(png|jpe?g|webp)$/i.test(r.name) && r.responseEnd <= playerControllable,
  );
  // Quentin's cycle-3 direction: the whole point of measuring over
  // BC_BOOT_HTTPS is that the atlas term reflects the protocol production
  // actually serves (GitHub Pages, HTTP/2). A silent fallback to HTTP/1.1
  // (a misconfigured preview, an ALPN negotiation failure) must never reach
  // the report as if it were a production reading -- so every image
  // response's own negotiated protocol is asserted here, not assumed.
  for (const r of imageResources) {
    if (r.nextHopProtocol !== "h2") {
      throw new Error(
        `computeSampleTerms: image resource '${r.name}' negotiated '${r.nextHopProtocol}', not 'h2' -- the milestone sweep must be served over HTTP/2 (BC_BOOT_HTTPS=1) for the atlas term to mean what the report says it means`,
      );
    }
  }
  const atlasFetchMs =
    imageResources.length > 0
      ? Math.max(...imageResources.map((r) => r.responseEnd)) -
        Math.min(...imageResources.map((r) => r.fetchStart))
      : 0;
  const firstImageFetchStart =
    imageResources.length > 0 ? Math.min(...imageResources.map((r) => r.fetchStart)) : atlasReady;
  const atlasDecodedMs = Math.max(0, atlasReady - firstImageFetchStart);
  const atlasBytes = imageResources.reduce((sum, r) => sum + (r.transferSize ?? 0), 0);
  const atlasMedianQueuingMs = medianOf(
    imageResources.map((r) => Math.max(0, (r.requestStart ?? r.fetchStart) - r.fetchStart)),
  );
  /** @type {Record<string, number>} */
  const atlasProtocolCounts = {};
  for (const r of imageResources) {
    const protocol = r.nextHopProtocol || "unknown";
    atlasProtocolCounts[protocol] = (atlasProtocolCounts[protocol] ?? 0) + 1;
  }

  const terms = {
    bundle: bundleMs,
    eval: evalMs,
    defs: defsMs,
    atlasFetch: atlasFetchMs,
    atlasDecoded: atlasDecodedMs,
    handshake: Math.max(0, handshakeOpen - mainStart),
    subscriptionDecode: Math.max(0, subscriptionApplied - handshakeOpen),
    toControllable: Math.max(0, playerControllable - Math.max(atlasReady, subscriptionApplied)),
  };

  return {
    totalMs: playerControllable,
    firstPaintMs: raw.firstPaintMs,
    interactivePromptMs: interactivePrompt,
    playerControllableMs: playerControllable,
    terms,
    atlasRequestCount: imageResources.length,
    atlasBytes,
    atlasMedianQueuingMs,
    atlasProtocolCounts,
  };
}
