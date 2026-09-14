// A plain, serialisable pixel buffer -- shared between `demo/compare-
// pipeline-vs-stack.ts` (the one real producer) and `net/e2e-hooks.ts`
// (the one consumer, over `window.__bc`), so neither has to depend on the
// other's own directory for a type this small.

export interface PixelSnapshot {
  readonly width: number;
  readonly height: number;
  /** Plain, not typed-array, so this crosses a `page.evaluate` boundary
   * (Playwright's own serialisation, like every other `window.__bc`
   * value) with no special handling. */
  readonly data: readonly number[];
}
