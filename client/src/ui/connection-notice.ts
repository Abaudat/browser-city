// One of exactly three DOM surfaces the whole game is allowed (FR151,
// story 1.11) -- a small, top-centre banner in the shared style
// (`index.html`'s injected custom properties), above the options menu in
// z-order so a player with the menu open can still see they are
// disconnected. No error codes, no retry counters, no countdown, no
// spinner: the one animation this surface ever has is the fade on
// recovery (nothing in this game pulses or flashes, `docs/ux.md`'s
// motion rule).
//
// The wording is a claim about what is actually true today (Artie/
// Quentin's direction, cycle 2): this build never retries a dropped
// connection (reconnection is story 4.16's work), so the notice never
// says "reconnecting" -- that would promise something that is not
// happening. "Connecting…" and "Connection lost" are the only two
// not-connected messages; "Reconnected" only ever plays if something
// calls `setStatus("connected")` after a drop, which nothing in this
// build does yet (kept for 4.16 to wire, not dead weight to delete).
//
// A generic notice slot, not a single-purpose "offline" banner (Artie's
// direction): `setStatus` takes `ConnectionStatus`
// (`net/connection-status.ts`, the one module `src/ui/**` is allow-
// listed to import from `net/`) and only the connection-drop wording is
// wired in this story. The same mechanism is the future two-tab notice
// ("This character is being driven in another tab.", `docs/ux.md` §4).
//
// The world never dims, blurs or pauses for this: nothing here ever
// touches the Pixi Application, the scene, its ticker or any pool -- the
// notice is the disconnect's only consumer (`net/connection.ts`'s own
// `onDisconnect`/`onConnectError` do the same), which is what makes "the
// world keeps rendering its last known state" hold by construction.
//
// Never takes focus, never suspends the keyboard, never uses
// `alert`/`confirm`/`prompt`; announced with `role="status"`/`aria-live`
// so it reaches a screen reader without stealing anything from the page.

import type { ConnectionStatus } from "../net/connection-status";
import { ensureStyle } from "./style";

export type { ConnectionStatus } from "../net/connection-status";

export interface ConnectionNoticeOptions {
  readonly container: HTMLElement;
  /** How long the link must be down before the notice actually shows, ms
   * -- so a network blip never flickers it on and off (Artie's
   * direction). Defaults to 1000. */
  readonly debounceMs?: number;
  /** How long "Reconnected" stays up before it starts fading, ms.
   * Defaults to 1500. */
  readonly recoveredHoldMs?: number;
  /** The fade-out duration, ms -- the only animation this surface ever
   * has. Drives the element's own `transition-duration` directly
   * (Tim's direction, cycle 2), so overriding this can never desync from
   * the CSS. Defaults to 300. */
  readonly fadeMs?: number;
}

export interface ConnectionNoticeHandle {
  readonly element: HTMLElement;
  /** Feeds the connection's current status. Hidden while `"connected"`;
   * shown, after the debounce, for `"connecting"` ("Connecting…") or
   * `"disconnected"` ("Connection lost", including a connect error at
   * boot); on a later `"connected"` while shown, switches to
   * "Reconnected" for `recoveredHoldMs`, then fades out over `fadeMs`.
   * Once shown, the notice stays up until an explicit `"connected"`
   * call -- there is no internal retry or polling here.
   *
   * `"updating"` (story 2.8, FR147) is shown immediately, with no
   * debounce, and is sticky: once entered, no later status (including
   * `"connected"`) ever hides, fades or re-labels it -- the boot gate has
   * already given up rendering this session. */
  setStatus(status: ConnectionStatus): void;
  destroy(): void;
}

const STYLE_ID = "bc-connection-notice-style";

const CONNECTING_MESSAGE = "Connecting…";
const LOST_MESSAGE = "Connection lost";
const RECOVERED_MESSAGE = "Reconnected";
/** Story 2.8 (FR147): the boot gate gave up rendering this session -- a
 * guarded reload already happened once for this exact server version and
 * the mismatch is still there. Shown immediately, sticky for the rest of
 * the session (see `setStatus` below): there is nothing later that
 * clears it, since Tim's direction is no further automatic reload this
 * session. */
const UPDATING_MESSAGE = "Updating…";

const DEFAULT_DEBOUNCE_MS = 1000;
const DEFAULT_RECOVERED_HOLD_MS = 1500;
const DEFAULT_FADE_MS = 300;

const STYLE_TEXT = `
[data-bc-notice] {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  background: var(--bc-panel-bg);
  border: 1px solid var(--bc-border);
  border-radius: 6px;
  padding: 8px 16px;
  font-family: var(--bc-font);
  font-size: 13px;
  color: var(--bc-text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  opacity: 1;
}
[data-bc-notice][hidden] {
  display: none;
}
[data-bc-notice][data-bc-fading="true"] {
  opacity: 0;
  transition-property: opacity;
  transition-timing-function: linear;
}
`;

/** Not-connected statuses only -- `"connected"` never reaches `show()`. */
type NotConnectedStatus = "connecting" | "disconnected";

type InternalState = "hidden" | "pending" | "shown" | "recovered" | "fading";

function messageFor(status: NotConnectedStatus): string {
  return status === "disconnected" ? LOST_MESSAGE : CONNECTING_MESSAGE;
}

/**
 * Mounts the notice into `container`, hidden. Returns a handle the caller
 * drives with `setStatus`; the element is created once and only ever
 * shown/hidden/re-labelled -- never re-created (so at most one notice
 * exists, whatever sequence of statuses arrives).
 */
export function mountConnectionNotice(options: ConnectionNoticeOptions): ConnectionNoticeHandle {
  const {
    container,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    recoveredHoldMs = DEFAULT_RECOVERED_HOLD_MS,
    fadeMs = DEFAULT_FADE_MS,
  } = options;
  const doc = container.ownerDocument;
  ensureStyle(doc, STYLE_ID, STYLE_TEXT);

  const element = doc.createElement("div");
  element.setAttribute("data-bc-notice", "");
  element.setAttribute("data-bc-surface", "connection-notice");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.hidden = true;
  // Drives `transition-duration` directly from `fadeMs`, so the CSS
  // fade above can never desync from the option (Tim's direction).
  element.style.transitionDuration = `${fadeMs}ms`;
  container.appendChild(element);

  let state: InternalState | "stuck" = "hidden";
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers(): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    debounceTimer = undefined;
    holdTimer = undefined;
    fadeTimer = undefined;
  }

  function show(status: NotConnectedStatus): void {
    state = "shown";
    element.textContent = messageFor(status);
    element.hidden = false;
    delete element.dataset.bcFading;
  }

  function showRecovered(): void {
    state = "recovered";
    element.textContent = RECOVERED_MESSAGE;
    element.hidden = false;
    delete element.dataset.bcFading;
    holdTimer = setTimeout(() => {
      state = "fading";
      element.dataset.bcFading = "true";
      fadeTimer = setTimeout(() => {
        state = "hidden";
        element.hidden = true;
        delete element.dataset.bcFading;
      }, fadeMs);
    }, recoveredHoldMs);
  }

  function hideImmediately(): void {
    state = "hidden";
    element.hidden = true;
    delete element.dataset.bcFading;
  }

  function onNotConnected(status: NotConnectedStatus): void {
    clearTimers();
    if (state === "shown") {
      // Already up -- switch the wording in place if the status changed
      // (e.g. the initial "Connecting…" becomes "Connection lost" the
      // moment a real connect error arrives), never restart the
      // debounce for a status that is already visible.
      show(status);
      return;
    }
    // "recovered"/"fading": the link dropped again before the recovery
    // animation finished. Re-show immediately -- the player is not
    // connected right now, and there is no reason to make them wait out
    // a fresh debounce for a fact already established this session.
    if (state === "recovered" || state === "fading") {
      show(status);
      return;
    }
    // "hidden"/"pending": start (or restart) the debounce.
    state = "pending";
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      show(status);
    }, debounceMs);
  }

  function onConnected(): void {
    clearTimers();
    if (state === "shown") {
      showRecovered();
      return;
    }
    // "hidden"/"pending"/"recovered"/"fading": nothing was ever actually
    // shown as a drop the player saw, or the recovery already ran --
    // either way there is nothing left to announce.
    hideImmediately();
  }

  function setStatus(status: ConnectionStatus): void {
    // FR147/NFR42: "stuck" is terminal once entered -- only a fresh page
    // load (Tim's direction: no further automatic reload this session)
    // ever leaves it, so nothing here un-sticks it, including a socket
    // that is perfectly healthy.
    if (state === "stuck") return;
    if (status === "updating") {
      clearTimers();
      state = "stuck";
      element.textContent = UPDATING_MESSAGE;
      element.hidden = false;
      delete element.dataset.bcFading;
      return;
    }
    if (status === "connected") {
      onConnected();
    } else {
      onNotConnected(status);
    }
  }

  return {
    element,
    setStatus,
    destroy: () => {
      clearTimers();
      element.remove();
    },
  };
}
