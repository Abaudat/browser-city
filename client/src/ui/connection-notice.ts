// One of exactly three DOM surfaces the whole game is allowed (FR151,
// story 1.11) -- a small, top-centre banner in the shared style
// (`ui/theme.ts`), above the options menu in z-order so a player with the
// menu open can still see they are disconnected. No error codes, no
// retry counters, no countdown, no spinner: at most a static ellipsis, and
// the one animation this surface ever has is the ~300ms fade on recovery
// (nothing in this game pulses or flashes, `docs/ux.md`'s motion rule).
//
// A generic notice slot, not a single-purpose "offline" banner (Artie's
// direction): `setStatus` takes any of the three-member `ConnectionStatus`
// shape (never imported from `net/connection.ts` -- `ui/**` may not
// import `net/**`, `client/biome.json`'s own override) and only the
// connection-drop wording is wired in this story. The same mechanism is
// the future two-tab notice ("This character is being driven in another
// tab.", `docs/ux.md` §4).
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

import { ensureStyle } from "./style";
import { ensureUiTheme } from "./theme";

/** Structurally the same union `net/connection.ts` exports -- duplicated
 * rather than imported, because `ui/**` may not import `net/**`
 * (`client/biome.json`'s own override): a DOM surface receives plain data
 * through its mount options, never reaches into the game. */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

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
   * has. Defaults to 300. */
  readonly fadeMs?: number;
}

export interface ConnectionNoticeHandle {
  readonly element: HTMLElement;
  /** Feeds the connection's current status. Hidden while `"connected"`;
   * shown, after the debounce, for `"connecting"` or `"disconnected"`
   * with "Connection lost — reconnecting…"; on a later `"connected"`
   * while shown, switches to "Reconnected" for `recoveredHoldMs`, then
   * fades out over `fadeMs`. This story does not implement reconnection
   * (`"reconnecting"` is not a status this build ever sends) -- once
   * shown, the notice stays up until an explicit `"connected"` call;
   * there is no internal retry or polling here. */
  setStatus(status: ConnectionStatus): void;
  destroy(): void;
}

const STYLE_ID = "bc-connection-notice-style";

const MESSAGE = "Connection lost — reconnecting…";
const RECOVERED_MESSAGE = "Reconnected";

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
  transition: opacity ${DEFAULT_FADE_MS}ms linear;
}
`;

type InternalState = "hidden" | "pending" | "shown" | "recovered" | "fading";

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
  ensureUiTheme(doc);
  ensureStyle(doc, STYLE_ID, STYLE_TEXT);

  const element = doc.createElement("div");
  element.setAttribute("data-bc-notice", "");
  element.setAttribute("data-bc-surface", "connection-notice");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.hidden = true;
  container.appendChild(element);

  let state: InternalState = "hidden";
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

  function show(): void {
    state = "shown";
    element.textContent = MESSAGE;
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

  function onNotConnected(): void {
    clearTimers();
    if (state === "shown") return; // already up -- idempotent.
    // "recovered"/"fading": the link dropped again before the recovery
    // animation finished. Re-show immediately -- the player is not
    // connected right now, and there is no reason to make them wait out
    // a fresh debounce for a fact already established this session.
    if (state === "recovered" || state === "fading") {
      show();
      return;
    }
    // "hidden"/"pending": start (or restart) the debounce.
    state = "pending";
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      show();
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
    if (status === "connected") {
      onConnected();
    } else {
      // "connecting" and "disconnected" both mean "not connected" for
      // this surface's own purposes -- a slow initial connect is shown
      // exactly like a later drop, once the debounce elapses either way.
      onNotConnected();
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
