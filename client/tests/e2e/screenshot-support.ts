// The options every committed visual baseline shares (`toHaveScreenshot`
// in test-street, debug-overlays and enclosure specs). Each spec adds its
// own absolute `maxDiffPixels`, sized to the object it guards.
export const SCREENSHOT_OPTIONS = {
  animations: "disabled",
  // Playwright's per-pixel colour tolerance (0-1): absorbs anti-aliasing
  // noise without widening how many pixels may differ.
  threshold: 0.2,
  // A cold headless Chromium on an unfamiliar CI runner can need longer
  // than Playwright's 5s default to settle its compositor and fonts.
  timeout: 30_000,
} as const;
