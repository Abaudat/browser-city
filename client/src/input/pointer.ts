// The DOM glue for FR148: `pointerdown`/`pointermove`/`pointerleave` on
// the canvas *element*, plus `window`'s own `blur`/`focus`/`visibilitychange`
// -- the same idiom `input/keyboard.ts`'s `attachKeyboard` uses, and for
// the same reason (Artie's direction, story 1.15: the mark must never
// survive a lost focus or a hidden tab) -- and nothing else. Deliberately
// no PixiJS -- no `eventMode`, no `interactive`, no `on("pointer…")` on
// any display object anywhere (Tim's direction): per-sprite federated
// events do not scale to a dense pool, and they would bypass the derived
// index that decides what is under the pointer.
//
// This file stays as thin as `attachKeyboard`: every decision belongs to
// `input/pick.ts`, which is pure. What is here is listener wiring, the
// screen-to-world conversion, and the visible feedback Artie's grammar
// calls for:
//
//   - hovering an interactable in reach: `pointer` cursor, and that
//     object's own drawables highlighted (the caller decides how).
//   - hovering an interactable out of reach: `pointer`, highlight
//     withheld -- that withholding is what "out of reach" looks like.
//   - clicking in reach: the intent is emitted, and nothing else happens.
//     Whatever consumes the intent owns the response; until Epic 8 that
//     means nothing visible, which is correct.
//   - clicking out of reach: no intent, and the cursor blips to
//     `not-allowed` for [`IGNORED_CURSOR_MS`] before returning to the
//     hover cursor. This is the whole "visibly ignored" treatment: no
//     toast, no floating mark, no tile flash, and never a repeat -- it
//     cannot pulse, so it cannot flash (the accessibility floor).
//   - empty ground or a non-interactable prop: `default`, and nothing at
//     all happens. There is no click-to-move and no ground marker.
//
// Two distinct "the world isn't listening" states, deliberately not one
// (Derek's direction): the options menu opening (`suspend`/`resume`)
// leaves the mark's own truth condition -- "the pointer is over this
// object and the player is in reach" -- unchanged, so it does not clear
// an already-true mark; only a lost window focus or a hidden tab
// (`blur`/`visibilitychange`) genuinely makes the pointer's whereabouts
// unknowable, and that is the one case that clears it and latches against
// a scene-driven `refresh()` relighting it while unfocused (Artie's
// direction, cycle 2) until `focus`/visibility-restored explicitly
// re-resolves.

import { worldCellFromScreenPx } from "../render/screen-position";
import type { IgnoredSink, IntentSink } from "./intent";
import type { PickContext, PickPlayer } from "./pick";
import { resolveClick } from "./pick";

/** How long the refused-click cursor shows before returning to the hover
 * cursor. One named constant, so the feel is a dial rather than a number
 * buried in a listener (Artie's direction). */
export const IGNORED_CURSOR_MS = 250;

const CURSOR_DEFAULT = "default";
const CURSOR_INTERACTABLE = "pointer";
const CURSOR_REFUSED = "not-allowed";

export interface PointerOptions {
  /** The canvas element itself -- never a Pixi display object. */
  readonly element: HTMLElement;
  /** Where `window`'s own `blur`/`focus`/`visibilitychange` are read from
   * -- `attachKeyboard`'s own idiom, injected for the same reason: a test
   * mounts on a bare element with no real global `window` focus to drive. */
  readonly target?: Window;
  /** Client coordinates to the world-pixel space `screenPositionPx`
   * produces, undoing whatever camera offset and zoom the scene applied.
   * Injected because the camera belongs to the scene, and this module
   * must not import PixiJS to ask it. */
  readonly toWorldPx: (
    clientX: number,
    clientY: number,
  ) => { readonly x: number; readonly y: number };
  /** Read per event, never captured once: the index, the defs and the
   * visibility predicate all change as the world streams and the player
   * walks between enclosures. */
  readonly context: () => PickContext;
  /** The player's own live position and floor -- the viewer's floor is
   * what a click resolves on. */
  readonly player: () => PickPlayer;
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly onIntent: IntentSink;
  readonly onIgnored?: IgnoredSink;
  /** Called only when the highlighted object actually changes, never on
   * every mouse move -- `undefined` means "nothing highlighted". */
  readonly onHighlightChange?: (objectId: bigint | undefined) => void;
}

export interface PointerHandle {
  /** Re-resolves the hover at the last known pointer position, for when
   * the *world* moved rather than the mouse. Movement is keyboard-only
   * (FR149), so a player walking into or out of an object's reach with
   * the mouse held still is the normal case, not an edge one -- without
   * this the affordance keeps showing the reach the player used to have.
   * A no-op while the pointer is outside the canvas, or before it has
   * ever been over it, and while suspended or unfocused (a scene-driven
   * refresh must never relight a mark the player cannot currently see
   * update). Driven by the scene's own events (a movement step, a
   * visibility change), never polled per frame. */
  refresh(): void;
  /** Ignores every pointer event on the canvas element until [`resume`],
   * *without* touching whatever is currently marked -- the options menu
   * opening does not make the pointer's own position or the player's own
   * reach any less true, only a DOM panel gets drawn over part of the
   * screen (Derek's direction). `main.ts` calls this from the options
   * menu's own `onOpenChange(true)`. */
  suspend(): void;
  /** Stops ignoring pointer events, and re-resolves the hover at the last
   * known pointer position, if any -- `main.ts` calls this from
   * `onOpenChange(false)`. Harmless when nothing changed while suspended
   * (the world cannot move while the menu holds the keyboard), and is
   * what picks up a hover that started only after the menu opened. */
  resume(): void;
  /** Removes every listener (the canvas element's own, and `window`'s
   * `blur`/`focus`/`visibilitychange`) and cancels a pending cursor blip. */
  detach(): void;
}

/**
 * Wires one element's pointer events to [`resolveClick`]. Returns a
 * cleanup function that removes every listener it added and cancels a
 * pending cursor blip, so a detached scene can never write to an element
 * it no longer owns.
 */
export function attachPointer(options: PointerOptions): PointerHandle {
  const {
    element,
    target = window,
    toWorldPx,
    context,
    player,
    tileSizePx,
    storeyHeightPx,
    onIntent,
    onIgnored,
    onHighlightChange,
  } = options;

  let highlighted: bigint | undefined;
  let hoverCursor: string = CURSOR_DEFAULT;
  let blipTimer: ReturnType<typeof setTimeout> | undefined;
  let detached = false;
  /** While the options menu (a DOM panel over the canvas) is open --
   * `suspend`/`resume`, below. Every real pointer event on the canvas
   * element is ignored while this is set: the menu's own backdrop
   * intercepts them in a real browser, so this is defence in depth, not
   * the primary mechanism. Deliberately does *not* clear the mark --
   * see the module doc for why that is a different case from
   * `unfocused`. */
  let suspended = false;
  /** While the window is blurred or the tab is hidden -- the pointer's
   * own whereabouts genuinely stop being knowable, unlike `suspended`.
   * Set alongside clearing the mark; latches `refresh()` (a scene-driven
   * call, e.g. a visibility change) so nothing can relight the mark
   * while unfocused, until `focus`/visibility-restored explicitly
   * re-resolves (Artie's direction, cycle 2). */
  let unfocused = false;
  /** Where the pointer last was, in client coordinates -- cleared when it
   * leaves, so a world change never revives a hover for a pointer that is
   * somewhere else entirely. */
  let lastClientX: number | undefined;
  let lastClientY: number | undefined;

  function setHighlight(objectId: bigint | undefined): void {
    if (highlighted === objectId) return;
    highlighted = objectId;
    onHighlightChange?.(objectId);
  }

  function setCursor(cursor: string): void {
    element.style.cursor = cursor;
  }

  function resolveAt(clientX: number, clientY: number) {
    const worldPx = toWorldPx(clientX, clientY);
    const viewer = player();
    // The cell for the index lookup, and the world pixel for the
    // drawn-sprite test -- converted once, here, so `pick.ts` never
    // floors a coordinate itself.
    const cell = worldCellFromScreenPx(
      worldPx.x,
      worldPx.y,
      viewer.floor,
      tileSizePx,
      storeyHeightPx,
    );
    // The world pixel goes through untouched: a drawn rect comes from the
    // sprite that produced it, which already carries FR124's floor
    // offset, so undoing that offset here would compare two different
    // spaces.
    return resolveClick(
      {
        cellX: cell.cellX,
        cellY: cell.cellY,
        worldXPx: worldPx.x,
        worldYPx: worldPx.y,
      },
      viewer.floor,
      viewer,
      context(),
    );
  }

  function applyHover(clientX: number, clientY: number): void {
    lastClientX = clientX;
    lastClientY = clientY;
    const resolution = resolveAt(clientX, clientY);
    if (resolution && "intent" in resolution) {
      hoverCursor = CURSOR_INTERACTABLE;
      setHighlight(resolution.intent.objectId);
    } else if (resolution) {
      // Interactable, but out of reach: the cursor still says "this is a
      // thing", and withholding the highlight is what says "not from
      // here".
      hoverCursor = CURSOR_INTERACTABLE;
      setHighlight(undefined);
    } else {
      hoverCursor = CURSOR_DEFAULT;
      setHighlight(undefined);
    }
    // A refused-click blip owns the cursor until it expires.
    if (blipTimer === undefined) setCursor(hoverCursor);
  }

  const onPointerMove = (event: MouseEvent): void => {
    if (suspended || unfocused) return;
    applyHover(event.clientX, event.clientY);
  };

  const onPointerLeave = (): void => {
    lastClientX = undefined;
    lastClientY = undefined;
    hoverCursor = CURSOR_DEFAULT;
    setHighlight(undefined);
    if (blipTimer === undefined) setCursor(hoverCursor);
  };

  /** The mark and the cursor both fall back to their unmarked/default
   * state -- used only by a real window `blur`/tab-hide (Artie's
   * direction: the mark must never survive its context). Deliberately
   * does not touch `lastClientX`/`lastClientY`: the pointer has not left
   * the canvas, only lost focus or been covered, so the matching
   * focus/visible handler can re-resolve the same position once it is
   * meaningful again. */
  function clearFeedback(): void {
    hoverCursor = CURSOR_DEFAULT;
    setHighlight(undefined);
    if (blipTimer !== undefined) {
      clearTimeout(blipTimer);
      blipTimer = undefined;
    }
    setCursor(hoverCursor);
  }

  const onWindowBlur = (): void => {
    if (detached) return;
    unfocused = true;
    clearFeedback();
  };

  const onWindowFocus = (): void => {
    if (detached) return;
    unfocused = false;
    // Symmetric restore (Derek's direction): a click is fully live the
    // instant focus returns, so the mark must be too, or the mark
    // withholds a promise the pointer is already keeping again. A no-op
    // if the pointer had left the canvas in the meantime (`lastClientX`/
    // `lastClientY` already cleared).
    if (lastClientX !== undefined && lastClientY !== undefined) {
      applyHover(lastClientX, lastClientY);
    }
  };

  const onVisibilityChange = (): void => {
    if (detached) return;
    if (target.document?.visibilityState === "hidden") {
      unfocused = true;
      clearFeedback();
    } else {
      onWindowFocus();
    }
  };

  const onPointerDown = (event: MouseEvent): void => {
    if (suspended || unfocused) return;
    // Primary button only: a right-click opens the browser's own menu and
    // must never also act on the world.
    if (event.button !== 0) return;

    const resolution = resolveAt(event.clientX, event.clientY);
    if (!resolution) return;

    if ("intent" in resolution) {
      onIntent(resolution.intent);
      applyHover(event.clientX, event.clientY);
      return;
    }

    onIgnored?.(resolution.ignored);
    applyHover(event.clientX, event.clientY);
    if (blipTimer !== undefined) clearTimeout(blipTimer);
    setCursor(CURSOR_REFUSED);
    blipTimer = setTimeout(() => {
      blipTimer = undefined;
      if (detached) return;
      setCursor(hoverCursor);
    }, IGNORED_CURSOR_MS);
  };

  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerleave", onPointerLeave);
  element.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("blur", onWindowBlur);
  target.addEventListener("focus", onWindowFocus);
  target.document?.addEventListener("visibilitychange", onVisibilityChange);

  return {
    refresh: () => {
      if (detached || suspended || unfocused) return;
      if (lastClientX === undefined || lastClientY === undefined) return;
      applyHover(lastClientX, lastClientY);
    },
    suspend: () => {
      if (detached) return;
      suspended = true;
    },
    resume: () => {
      if (detached) return;
      suspended = false;
      // Re-resolve at the last known pointer position, if any -- picks up
      // a hover that only started while the menu was open (nothing else
      // can have changed: the world cannot move while the menu holds the
      // keyboard).
      if (lastClientX !== undefined && lastClientY !== undefined) {
        applyHover(lastClientX, lastClientY);
      }
    },
    detach: () => {
      detached = true;
      target.removeEventListener("blur", onWindowBlur);
      target.removeEventListener("focus", onWindowFocus);
      target.document?.removeEventListener("visibilitychange", onVisibilityChange);
      if (blipTimer !== undefined) {
        clearTimeout(blipTimer);
        blipTimer = undefined;
      }
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
