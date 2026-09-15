// Story 1.14 (NFR1): the boot budget's own milestones, marked with the
// browser's real `performance.mark()` so `docs/spikes/1.14-boot-
// budget.md`'s numbers come from the client, not from a guess (Tim's
// direction). This module has no dependencies and ships in production --
// unlike the `net/e2e-hooks.ts` surface, which `import.meta.env.DEV`
// strips out, User Timing marks are cheap enough to carry permanently, and
// NFR1 is a standing constraint, not a one-off measurement. Every mark
// this client ever sets goes through `markBoot` below; nothing else under
// `client/src/` calls `performance.mark` directly, so there is exactly one
// place a milestone name can be spelled wrong.
//
// `first-paint` is deliberately not a name here: it is read from the
// browser's own `first-contentful-paint` `PerformanceObserver` entry
// (`docs/spikes/1.14-boot-budget.md`'s harness), which already exists
// before any of this client's own code runs.

export const BOOT_MARK = {
  /** The first statement `main()` runs -- splits the bundle term into
   * fetch+parse/eval (Resource Timing, up to this point) and everything
   * after (module top-level evaluation was already done by the time this
   * line runs; this marks where the app's own logic starts). */
  MAIN_START: "bc-boot:main-start",
  /** `DbConnection`'s `onConnect` firing -- the handshake term's end. */
  HANDSHAKE_OPEN: "bc-boot:handshake-open",
  /** The first subscription's `onApplied` -- the subscription-decode
   * term's end. */
  SUBSCRIPTION_APPLIED: "bc-boot:subscription-applied",
  /** Every texture the street scene loads before its first frame has
   * resolved -- the atlas term's end (there is no real atlas yet; see
   * `docs/spikes/1.14-boot-budget.md` for the per-request breakdown this
   * pairs with, read from Resource Timing). */
  ATLAS_READY: "bc-boot:atlas-ready",
  /** The street scene's first rendered frame. */
  FIRST_FRAME_RENDERED: "bc-boot:first-frame-rendered",
  /** FR144's name prompt does not exist yet (Tim's direction): until it
   * does, this is a stand-in, fired the moment the keyboard listener is
   * attached and the first street frame has rendered -- the report says so
   * plainly, every time it is read. */
  INTERACTIVE_PROMPT: "bc-boot:interactive-prompt",
  /** Also a stand-in today, fired at the same instant as
   * `INTERACTIVE_PROMPT` (no separate name-submission step exists yet):
   * the harness proves this mark is honest by pressing a movement key
   * immediately after it and asserting the player's position actually
   * changes on a following frame -- a mark that fires before input really
   * moves the player is a lying mark and fails the spec. */
  PLAYER_CONTROLLABLE: "bc-boot:player-controllable",
} as const;

export type BootMarkName = (typeof BOOT_MARK)[keyof typeof BOOT_MARK];

/** Records `name` at the current time, relative to navigation start, the
 * same reference `first-contentful-paint` and every `PerformanceResourceTiming`
 * entry already use -- so a milestone and a resource fetch are always
 * directly comparable with no unit conversion. */
export function markBoot(name: BootMarkName): void {
  performance.mark(name);
}
