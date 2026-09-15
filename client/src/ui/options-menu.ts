// FR151's options menu -- one of exactly three DOM surfaces the whole
// game is allowed (the boot name prompt and the connection notice,
// `ui/connection-notice.ts`, are the other two). Plain DOM, no framework,
// no dependency.
//
// One panel, three sections in this fixed order -- Audio, Display,
// Controls -- as stacked headings, never tabs (Artie's direction: too few
// settings to justify an application-style tab strip). Every control has
// a real consumer today or a persisted value a named later story reads
// (Tim's wiring rule): Audio's volume/mute are FR153's audio story's
// input; Display's highlight strength (the U1 dial, `docs/ux.md`) drives
// `test-street/scene.ts`'s affordance overlay live, and its fullscreen
// toggle drives `document.fullscreenElement` directly; Controls is
// FR149's rebinding, unchanged. Nothing decorative is ever added here.
//
// Artie's rules, which are what the styling below is:
//   - one small centred panel over a semi-transparent backdrop. The city
//     stays visible behind it and keeps running: the world never pauses.
//   - system font stack, near-black panel, off-white text, one accent
//     (`index.html`'s shared custom properties, the same ones the
//     connection notice uses). No pixel-font imitation, no wood or
//     leather frame, no UI sprite sheet. The menu sits outside the
//     fiction and should look like it.
//   - `Escape` opens and closes it, and is listed as fixed because it is
//     reserved (`input/keybindings.ts`) -- a player cannot bind it away.
//   - a key already bound elsewhere swaps, and both rows flash. Never an
//     error dialog: this file never calls the browser's native blocking
//     dialogs, including on "Reset to defaults" (which resets Controls
//     only -- Audio and Display are separate persisted groups, untouched
//     by it). `scripts/ci/check-no-canvas-ui.sh` bans them repo-wide.

import type { BindableAction, Bindings } from "../input/keybindings";
import { BINDABLE_ACTIONS, DEFAULT_BINDINGS, isBindableCode, rebind } from "../input/keybindings";
import type { AudioSettings } from "../settings/audio-settings";
import {
  type DisplaySettings,
  HIGHLIGHT_STRENGTH_MAX,
  HIGHLIGHT_STRENGTH_MIN,
} from "../settings/display-settings";
import { ensureStyle } from "./style";

/** Every `mountOptionsMenu` call gets its own id prefix, so two mounted
 * instances (never true in `main.ts`, but true across adjacent unit
 * tests that do not always `destroy()` before the next `mount()`) never
 * collide on a `<label for>` target. */
let mountCounter = 0;

/** How long both rows of a swap stay marked, so the player sees what
 * moved. A steady mark that ends, never a pulse -- nothing in this menu
 * flashes repeatedly. */
export const SWAP_FLASH_MS = 600;

const ACTION_LABELS: Readonly<Record<BindableAction, string>> = {
  move_up: "Walk up",
  move_down: "Walk down",
  move_left: "Walk left",
  move_right: "Walk right",
};

/** What the common non-letter keys are called on a keyboard, rather than
 * in the `KeyboardEvent.code` vocabulary: a player who binds Shift should
 * not be shown "ShiftLeft". */
const CODE_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  CapsLock: "Caps Lock",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

const CAPTURE_PROMPT = "Press a key…";

/** What a keycap prints: the letter or digit a physical code stands for,
 * an arrow glyph for the arrow keys (never the word "ArrowUp"), and
 * otherwise the code itself, which is at least something a player can
 * recognise. */
export function keycapLabel(code: string): string {
  const named = CODE_LABELS[code];
  if (named) return named;
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad") && code.length === 7) return `Num ${code.slice(6)}`;
  return code;
}

export interface OptionsMenuOptions {
  readonly container: HTMLElement;
  readonly initialBindings: Bindings;
  /** Called with the new map whenever the player rebinds or resets --
   * persisting it and handing it to the keyboard is the caller's job, so
   * this module touches neither storage nor input state. */
  readonly onBindingsChange: (bindings: Bindings) => void;
  /** Called when the menu opens or closes, so the caller can take the
   * keyboard off movement while it is open (Artie's direction). */
  readonly onOpenChange?: (open: boolean) => void;
  readonly initialAudio: AudioSettings;
  /** Called with the new value on every committed slider/toggle change.
   * Persisting it is the caller's job, same as `onBindingsChange`. */
  readonly onAudioChange: (audio: AudioSettings) => void;
  readonly initialDisplay: DisplaySettings;
  readonly onDisplayChange: (display: DisplaySettings) => void;
}

export interface OptionsMenuHandle {
  readonly element: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Replaces what the menu displays -- for a caller that changed the
   * bindings by some other route. Never calls `onBindingsChange` back. */
  setBindings(bindings: Bindings): void;
  destroy(): void;
}

const STYLE_ID = "bc-options-style";

const STYLE_TEXT = `
[data-bc-backdrop] {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  font-family: var(--bc-font);
  color: var(--bc-text);
}
/* display:flex above would otherwise beat the hidden attribute's own UA
   rule, leaving a closed menu as an invisible full-screen sheet over the
   city that swallows every click meant for the world. */
[data-bc-backdrop][hidden] {
  display: none;
}
[data-bc-panel] {
  background: var(--bc-panel-bg);
  border: 1px solid var(--bc-border);
  border-radius: 6px;
  padding: 20px 24px;
  min-width: 320px;
  max-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
[data-bc-panel] h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px;
}
[data-bc-panel] h3 {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bc-muted);
  margin: 20px 0 8px;
}
[data-bc-panel] h3:first-of-type {
  margin-top: 0;
}
/* One grid for every row -- Audio, Display and Controls alike (Artie's
   direction, cycle 2): the label in the left column, the row's one
   control block flush against the right column, so every right edge
   (a keycap's, a slider's readout, the fullscreen button's) lines up on
   the same column regardless of section. */
[data-bc-row] {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 5px 6px;
  border-radius: 4px;
}
[data-bc-row][data-bc-flash="true"] {
  background: rgba(94, 158, 214, 0.22);
}
[data-bc-control] {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
[data-bc-keys] {
  display: flex;
  gap: 6px;
}
/* The panel itself is focused on open (Artie's direction, cycle 2: a
   ring around the volume slider the instant the menu appears reads as
   an already-made selection) -- programmatic focus on a non-interactive
   container draws no ring of its own. */
[data-bc-panel]:focus {
  outline: none;
}
[data-bc-keycap], [data-bc-reset], [data-bc-close], [data-bc-fullscreen-toggle] {
  font: inherit;
  font-size: 12px;
  color: var(--bc-text);
  background: var(--bc-control-bg);
  border: 1px solid #363b44;
  border-radius: 4px;
  padding: 3px 9px;
  cursor: pointer;
}
[data-bc-keycap]:hover, [data-bc-reset]:hover, [data-bc-close]:hover, [data-bc-fullscreen-toggle]:hover {
  background: var(--bc-control-bg-hover);
}
[data-bc-keycap]:focus-visible, [data-bc-reset]:focus-visible, [data-bc-close]:focus-visible,
[data-bc-fullscreen-toggle]:focus-visible, [data-bc-volume-slider]:focus-visible,
[data-bc-highlight-slider]:focus-visible, [data-bc-mute-toggle]:focus-visible {
  outline: 2px solid var(--bc-accent);
  outline-offset: 2px;
}
[data-bc-keycap][data-bc-capturing="true"] {
  border-color: var(--bc-accent);
  color: var(--bc-accent);
}
/* One accent across keycaps, focus rings and form controls (Artie's
   direction, cycle 2): without this Chrome paints the range thumb/track
   and the checkbox in its own saturated system blue, a second accent
   colour next to ours. A thin track in --bc-control-bg is the fallback
   for a browser that still renders the unfilled range track in a light
   system colour despite accent-color. */
[data-bc-volume-slider], [data-bc-highlight-slider] {
  accent-color: var(--bc-accent);
  width: 140px;
}
[data-bc-volume-slider]::-webkit-slider-runnable-track, [data-bc-highlight-slider]::-webkit-slider-runnable-track {
  background: var(--bc-control-bg);
  border-radius: 2px;
}
[data-bc-volume-slider]::-moz-range-track, [data-bc-highlight-slider]::-moz-range-track {
  background: var(--bc-control-bg);
  border-radius: 2px;
}
[data-bc-mute-toggle] {
  accent-color: var(--bc-accent);
}
[data-bc-note] {
  font-size: 11px;
  color: var(--bc-muted);
  margin: 14px 0 0;
}
[data-bc-actions] {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
}
[data-bc-value] {
  display: inline-block;
  font-size: 12px;
  color: var(--bc-muted);
  width: 3em;
  text-align: right;
}
`;

/**
 * Mounts the options menu into `container`, closed. Returns a handle the
 * caller drives (and must `destroy()`); the menu owns one `keydown`
 * listener on the window, which is how `Escape` reaches it whether or not
 * the panel has focus.
 */
export function mountOptionsMenu(options: OptionsMenuOptions): OptionsMenuHandle {
  const {
    container,
    initialBindings,
    onBindingsChange,
    onOpenChange,
    initialAudio,
    onAudioChange,
    initialDisplay,
    onDisplayChange,
  } = options;
  const doc = container.ownerDocument;
  ensureStyle(doc, STYLE_ID, STYLE_TEXT);
  const idPrefix = `bc-options-${++mountCounter}`;

  let bindings = initialBindings;
  let audio = initialAudio;
  let display = initialDisplay;
  let open = false;
  let capturing: { action: BindableAction; slot: number } | undefined;
  const flashTimers = new Map<BindableAction, ReturnType<typeof setTimeout>>();

  const backdrop = doc.createElement("div");
  backdrop.setAttribute("data-bc-backdrop", "");
  backdrop.setAttribute("data-bc-options", "");
  backdrop.setAttribute("data-bc-surface", "options-menu");
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "false");
  backdrop.setAttribute("aria-label", "Options");
  backdrop.hidden = true;

  const panel = doc.createElement("div");
  panel.setAttribute("data-bc-panel", "");
  // Focused on open instead of the first real control (Artie's
  // direction, cycle 2) -- see the `:focus { outline: none }` rule
  // above. `tabindex="-1"` keeps it out of the normal Tab order, so the
  // very next Tab after open lands on the first real control (the
  // browser's own "next tabbable node after the focused one" behaviour),
  // which is exactly where the ring belongs.
  panel.tabIndex = -1;
  backdrop.appendChild(panel);

  const title = doc.createElement("h2");
  title.textContent = "Options";
  panel.appendChild(title);

  // --- Audio ---------------------------------------------------------
  const audioHeading = doc.createElement("h3");
  audioHeading.textContent = "Audio";
  panel.appendChild(audioHeading);

  const volumeRow = doc.createElement("div");
  volumeRow.setAttribute("data-bc-row", "");
  const volumeId = `${idPrefix}-volume`;
  const volumeLabel = doc.createElement("label");
  volumeLabel.textContent = "Master volume";
  volumeLabel.htmlFor = volumeId;
  const volumeControl = doc.createElement("div");
  volumeControl.setAttribute("data-bc-control", "");
  const volumeSlider = doc.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.id = volumeId;
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.setAttribute("data-bc-volume-slider", "");
  const volumeValue = doc.createElement("span");
  volumeValue.setAttribute("data-bc-value", "");
  volumeControl.append(volumeSlider, volumeValue);
  volumeRow.append(volumeLabel, volumeControl);
  panel.appendChild(volumeRow);

  const muteRow = doc.createElement("div");
  muteRow.setAttribute("data-bc-row", "");
  const muteId = `${idPrefix}-mute`;
  const muteLabel = doc.createElement("label");
  muteLabel.textContent = "Mute";
  muteLabel.htmlFor = muteId;
  const muteControl = doc.createElement("div");
  muteControl.setAttribute("data-bc-control", "");
  const muteToggle = doc.createElement("input");
  muteToggle.type = "checkbox";
  muteToggle.id = muteId;
  muteToggle.setAttribute("data-bc-mute-toggle", "");
  muteControl.appendChild(muteToggle);
  muteRow.append(muteLabel, muteControl);
  panel.appendChild(muteRow);

  // --- Display ---------------------------------------------------------
  const displayHeading = doc.createElement("h3");
  displayHeading.textContent = "Display";
  panel.appendChild(displayHeading);

  const highlightRow = doc.createElement("div");
  highlightRow.setAttribute("data-bc-row", "");
  const highlightId = `${idPrefix}-highlight`;
  const highlightLabel = doc.createElement("label");
  // "Object highlight", not "Highlight strength" (Artie's direction,
  // cycle 2): the earlier label named the dial, not what it does.
  highlightLabel.textContent = "Object highlight";
  highlightLabel.htmlFor = highlightId;
  const highlightControl = doc.createElement("div");
  highlightControl.setAttribute("data-bc-control", "");
  const highlightSlider = doc.createElement("input");
  highlightSlider.type = "range";
  highlightSlider.id = highlightId;
  // 20, not 0 (Artie's direction, cycle 2): zero would mean no
  // affordance at all, which reopens the "can't find the game" failure
  // the affordance exists to prevent (`docs/ux.md` §1).
  highlightSlider.min = String(HIGHLIGHT_STRENGTH_MIN);
  highlightSlider.max = String(HIGHLIGHT_STRENGTH_MAX);
  highlightSlider.setAttribute("data-bc-highlight-slider", "");
  const highlightValue = doc.createElement("span");
  highlightValue.setAttribute("data-bc-value", "");
  highlightControl.append(highlightSlider, highlightValue);
  highlightRow.append(highlightLabel, highlightControl);
  panel.appendChild(highlightRow);

  const fullscreenRow = doc.createElement("div");
  fullscreenRow.setAttribute("data-bc-row", "");
  const fullscreenLabel = doc.createElement("span");
  fullscreenLabel.textContent = "Fullscreen";
  const fullscreenControl = doc.createElement("div");
  fullscreenControl.setAttribute("data-bc-control", "");
  const fullscreenToggle = doc.createElement("button");
  fullscreenToggle.type = "button";
  fullscreenToggle.setAttribute("data-bc-fullscreen-toggle", "");
  fullscreenControl.appendChild(fullscreenToggle);
  fullscreenRow.append(fullscreenLabel, fullscreenControl);
  panel.appendChild(fullscreenRow);
  // No Fullscreen API in this environment (Artie's direction, cycle 2):
  // hide the row entirely rather than show a button that does nothing.
  const fullscreenSupported = typeof doc.documentElement.requestFullscreen === "function";
  fullscreenRow.hidden = !fullscreenSupported;

  // --- Controls ---------------------------------------------------------
  const controlsHeading = doc.createElement("h3");
  controlsHeading.textContent = "Controls";
  panel.appendChild(controlsHeading);

  const rows = new Map<BindableAction, HTMLElement>();
  const keyLists = new Map<BindableAction, HTMLElement>();

  for (const action of BINDABLE_ACTIONS) {
    const row = doc.createElement("div");
    row.setAttribute("data-bc-row", "");
    row.dataset.bcAction = action;

    const label = doc.createElement("span");
    label.textContent = ACTION_LABELS[action];
    row.appendChild(label);

    const keys = doc.createElement("div");
    keys.setAttribute("data-bc-keys", "");
    row.appendChild(keys);

    panel.appendChild(row);
    rows.set(action, row);
    keyLists.set(action, keys);
  }

  const note = doc.createElement("p");
  note.setAttribute("data-bc-note", "");
  note.textContent = "Escape opens and closes this menu, and cannot be rebound.";
  panel.appendChild(note);

  const actions = doc.createElement("div");
  actions.setAttribute("data-bc-actions", "");
  const reset = doc.createElement("button");
  reset.type = "button";
  reset.setAttribute("data-bc-reset", "");
  reset.textContent = "Reset to defaults";
  const close = doc.createElement("button");
  close.type = "button";
  close.setAttribute("data-bc-close", "");
  close.textContent = "Close";
  actions.append(reset, close);
  panel.appendChild(actions);

  container.appendChild(backdrop);

  function stopCapture(): void {
    const cancelled = capturing;
    capturing = undefined;
    render(cancelled);
  }

  function flash(action: BindableAction): void {
    const row = rows.get(action);
    if (!row) return;
    row.dataset.bcFlash = "true";
    const existing = flashTimers.get(action);
    if (existing !== undefined) clearTimeout(existing);
    flashTimers.set(
      action,
      setTimeout(() => {
        flashTimers.delete(action);
        delete row.dataset.bcFlash;
      }, SWAP_FLASH_MS),
    );
  }

  function applyBindings(
    next: Bindings,
    flashed: readonly BindableAction[] = [],
    focusOn?: { action: BindableAction; slot: number },
  ): void {
    bindings = next;
    for (const action of flashed) flash(action);
    render(focusOn);
    onBindingsChange(next);
  }

  function captureInto(action: BindableAction, slot: number): void {
    capturing = { action, slot };
    render(capturing);
  }

  /** Which keycap to leave focused after a rebuild. `render` replaces
   * every keycap, so the button the player was on is destroyed -- without
   * this, focus drops to the body after each rebind and a keyboard player
   * loses their place mid-menu (Artie's cycle-2 note). */
  function render(focusOn?: { action: BindableAction; slot: number }): void {
    for (const action of BINDABLE_ACTIONS) {
      const keys = keyLists.get(action);
      if (!keys) continue;
      keys.replaceChildren();
      const codes = bindings[action];
      const slots = Math.max(codes.length, 1);
      for (let slot = 0; slot < slots; slot++) {
        const code = codes[slot];
        const cap = doc.createElement("button");
        cap.type = "button";
        cap.setAttribute("data-bc-keycap", "");
        const isCapturing = capturing?.action === action && capturing.slot === slot;
        if (isCapturing) cap.dataset.bcCapturing = "true";
        cap.textContent = isCapturing ? CAPTURE_PROMPT : code ? keycapLabel(code) : "—";
        cap.setAttribute(
          "aria-label",
          `${ACTION_LABELS[action]}, key ${slot + 1}${code ? `: ${code}` : ""}`,
        );
        cap.addEventListener("click", () => captureInto(action, slot));
        keys.appendChild(cap);
        if (focusOn && focusOn.action === action && focusOn.slot === slot) cap.focus();
      }
    }
  }

  /** Every control inside the panel, in DOM order -- what Tab cycles
   * through, and what the trap below wraps around. Excludes anything
   * inside a `[hidden]` row (the fullscreen row, when the Fullscreen API
   * is absent) -- an unfocusable control must never be picked as the
   * first/last stop of the trap. */
  function focusables(): HTMLElement[] {
    return [...panel.querySelectorAll<HTMLElement>("button, input")].filter(
      (el) => el.closest("[hidden]") === null,
    );
  }

  function renderAudio(): void {
    volumeSlider.value = String(audio.masterVolume);
    volumeValue.textContent = `${audio.masterVolume}%`;
    muteToggle.checked = audio.muted;
  }

  function renderDisplay(): void {
    highlightSlider.value = String(display.highlightStrength);
    highlightValue.textContent = `${display.highlightStrength}%`;
  }

  /** Reflects `doc.fullscreenElement` on the button's own label, so it
   * always says what clicking it will do (Artie's direction, cycle 2),
   * and stays correct even when fullscreen was entered or left outside
   * this menu (F11, the browser's own Esc handling) -- wired to
   * `fullscreenchange`, never assumed from the click alone. */
  function renderFullscreen(): void {
    const isFullscreen = doc.fullscreenElement != null;
    fullscreenToggle.textContent = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    backdrop.hidden = !next;
    if (!next) capturing = undefined;
    render();
    if (next) {
      // The panel itself, not the first real control (Artie's direction,
      // cycle 2): a ring around the volume slider the instant the menu
      // opens reads as an already-made selection. The next real Tab
      // lands there instead, which is where the ring belongs.
      panel.focus();
    } else {
      // Hand focus back to the page, or a movement key would be typed
      // into whichever button was still focused.
      (doc.activeElement as HTMLElement | null)?.blur();
      doc.body.focus?.();
    }
    onOpenChange?.(next);
  }

  /** Keeps Tab inside the panel while it is open -- without this it walks
   * straight out to the page behind the backdrop, where nothing is
   * visible to a sighted player. */
  function trapTab(event: KeyboardEvent): void {
    const controls = focusables();
    if (controls.length === 0) return;
    const first = controls[0] as HTMLElement;
    const last = controls[controls.length - 1] as HTMLElement;
    const active = doc.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (capturing) {
      // Escape cancels the capture, and so does Tab: binding Tab would
      // take away the only way to move around this menu without a mouse.
      // Neither ever binds, and neither closes the menu out from under a
      // player who was mid-rebind.
      event.preventDefault();
      if (event.code === "Escape" || event.code === "Tab") {
        stopCapture();
        return;
      }
      // A key no loader would keep is simply not a binding: stay in
      // capture and wait for a real one, rather than saving something
      // that disappears on the next reload.
      if (!isBindableCode(event.code)) return;
      const { action, slot } = capturing;
      const previousOwner = BINDABLE_ACTIONS.find(
        (other) => other !== action && bindings[other].includes(event.code),
      );
      const next = rebind(bindings, action, slot, event.code);
      capturing = undefined;
      applyBindings(next, previousOwner ? [action, previousOwner] : [], { action, slot });
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      setOpen(!open);
      return;
    }
    if (open && event.code === "Tab") trapTab(event);
  };

  const onResetClick = (): void => {
    capturing = undefined;
    applyBindings(DEFAULT_BINDINGS);
  };
  const onCloseClick = (): void => setOpen(false);

  // Live readout on every drag tick ('input'), but only committed (and
  // persisted, through the caller's onAudioChange/onDisplayChange) on
  // 'change' -- the same idiom a native OS volume slider uses, so a drag
  // never writes to storage on every intermediate tick.
  const onVolumeInput = (): void => {
    volumeValue.textContent = `${volumeSlider.value}%`;
  };
  const onVolumeChange = (): void => {
    audio = { ...audio, masterVolume: Number(volumeSlider.value) };
    onAudioChange(audio);
  };
  const onMuteChange = (): void => {
    audio = { ...audio, muted: muteToggle.checked };
    onAudioChange(audio);
  };
  const onHighlightInput = (): void => {
    highlightValue.textContent = `${highlightSlider.value}%`;
  };
  const onHighlightChange = (): void => {
    display = { ...display, highlightStrength: Number(highlightSlider.value) };
    onDisplayChange(display);
  };
  // The browser owns fullscreen state (Artie's direction) -- nothing here
  // persists it. `requestFullscreen`/`exitFullscreen` are absent in
  // environments with no Fullscreen API (jsdom included); the optional
  // call is the whole of that guard, and the row is hidden entirely in
  // that case (above), so this listener is unreachable there anyway.
  const onFullscreenClick = (): void => {
    if (doc.fullscreenElement) {
      void doc.exitFullscreen?.();
    } else {
      void doc.documentElement.requestFullscreen?.();
    }
  };
  const onFullscreenChange = (): void => renderFullscreen();

  reset.addEventListener("click", onResetClick);
  close.addEventListener("click", onCloseClick);
  volumeSlider.addEventListener("input", onVolumeInput);
  volumeSlider.addEventListener("change", onVolumeChange);
  muteToggle.addEventListener("change", onMuteChange);
  highlightSlider.addEventListener("input", onHighlightInput);
  highlightSlider.addEventListener("change", onHighlightChange);
  fullscreenToggle.addEventListener("click", onFullscreenClick);
  doc.addEventListener("fullscreenchange", onFullscreenChange);
  const view = doc.defaultView;
  view?.addEventListener("keydown", onKeyDown);

  render();
  renderAudio();
  renderDisplay();
  renderFullscreen();

  return {
    element: backdrop,
    isOpen: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    setBindings: (next) => {
      bindings = next;
      render();
    },
    destroy: () => {
      for (const timer of flashTimers.values()) clearTimeout(timer);
      flashTimers.clear();
      view?.removeEventListener("keydown", onKeyDown);
      reset.removeEventListener("click", onResetClick);
      close.removeEventListener("click", onCloseClick);
      volumeSlider.removeEventListener("input", onVolumeInput);
      volumeSlider.removeEventListener("change", onVolumeChange);
      muteToggle.removeEventListener("change", onMuteChange);
      highlightSlider.removeEventListener("input", onHighlightInput);
      highlightSlider.removeEventListener("change", onHighlightChange);
      fullscreenToggle.removeEventListener("click", onFullscreenClick);
      doc.removeEventListener("fullscreenchange", onFullscreenChange);
      backdrop.remove();
    },
  };
}
