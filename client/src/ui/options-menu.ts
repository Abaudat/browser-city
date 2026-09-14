// FR151's options menu -- the only settings surface this client has, and
// one of exactly three DOM surfaces the whole game is allowed (the boot
// name prompt and connection-state notices are the other two). Plain DOM,
// no framework, no dependency.
//
// It is structured as *the* options menu from the start, with Audio and
// Display as later sections of this same panel rather than a separate
// "keybindings" dialog somebody has to merge in later. Only Controls
// exists today, and nothing is invented to fill the others.
//
// Artie's rules, which are what the styling below is:
//   - one small centred panel over a semi-transparent backdrop. The city
//     stays visible behind it and keeps running: the world never pauses.
//   - system font stack, near-black panel, off-white text, one accent.
//     No pixel-font imitation, no wood or leather frame, no UI sprite
//     sheet. The menu sits outside the fiction and should look like it.
//   - `Escape` opens and closes it, and is listed as fixed because it is
//     reserved (`input/keybindings.ts`) -- a player cannot bind it away.
//   - a key already bound elsewhere swaps, and both rows flash. Never an
//     error dialog: there is no `confirm()` or `alert()` in this file,
//     including on "Reset to defaults".

import type { BindableAction, Bindings } from "../input/keybindings";
import { BINDABLE_ACTIONS, DEFAULT_BINDINGS, rebind } from "../input/keybindings";

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

const ARROW_GLYPHS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const CAPTURE_PROMPT = "Press a key…";

/** What a keycap prints: the letter or digit a physical code stands for,
 * an arrow glyph for the arrow keys (never the word "ArrowUp"), and
 * otherwise the code itself, which is at least something a player can
 * recognise. */
export function keycapLabel(code: string): string {
  const arrow = ARROW_GLYPHS[code];
  if (arrow) return arrow;
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
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
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #ececec;
}
[data-bc-panel] {
  background: #14161a;
  border: 1px solid #2b2f36;
  border-radius: 6px;
  padding: 20px 24px;
  min-width: 320px;
  max-width: 420px;
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
  color: #8b93a1;
  margin: 0 0 8px;
}
[data-bc-row] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 5px 6px;
  border-radius: 4px;
}
[data-bc-row][data-bc-flash="true"] {
  background: rgba(94, 158, 214, 0.22);
}
[data-bc-keys] {
  display: flex;
  gap: 6px;
}
[data-bc-keycap], [data-bc-reset], [data-bc-close] {
  font: inherit;
  font-size: 12px;
  color: #ececec;
  background: #20242b;
  border: 1px solid #363b44;
  border-radius: 4px;
  padding: 3px 9px;
  cursor: pointer;
}
[data-bc-keycap]:hover, [data-bc-reset]:hover, [data-bc-close]:hover {
  background: #272c34;
}
[data-bc-keycap]:focus-visible, [data-bc-reset]:focus-visible, [data-bc-close]:focus-visible {
  outline: 2px solid #5e9ed6;
  outline-offset: 2px;
}
[data-bc-keycap][data-bc-capturing="true"] {
  border-color: #5e9ed6;
  color: #5e9ed6;
}
[data-bc-note] {
  font-size: 11px;
  color: #8b93a1;
  margin: 14px 0 0;
}
[data-bc-actions] {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  doc.head.appendChild(style);
}

/**
 * Mounts the options menu into `container`, closed. Returns a handle the
 * caller drives (and must `destroy()`); the menu owns one `keydown`
 * listener on the window, which is how `Escape` reaches it whether or not
 * the panel has focus.
 */
export function mountOptionsMenu(options: OptionsMenuOptions): OptionsMenuHandle {
  const { container, initialBindings, onBindingsChange, onOpenChange } = options;
  const doc = container.ownerDocument;
  ensureStyle(doc);

  let bindings = initialBindings;
  let open = false;
  let capturing: { action: BindableAction; slot: number } | undefined;
  const flashTimers = new Map<BindableAction, ReturnType<typeof setTimeout>>();

  const backdrop = doc.createElement("div");
  backdrop.setAttribute("data-bc-backdrop", "");
  backdrop.setAttribute("data-bc-options", "");
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "false");
  backdrop.setAttribute("aria-label", "Options");
  backdrop.hidden = true;

  const panel = doc.createElement("div");
  panel.setAttribute("data-bc-panel", "");
  backdrop.appendChild(panel);

  const title = doc.createElement("h2");
  title.textContent = "Options";
  panel.appendChild(title);

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
    capturing = undefined;
    render();
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

  function applyBindings(next: Bindings, flashed: readonly BindableAction[] = []): void {
    bindings = next;
    for (const action of flashed) flash(action);
    render();
    onBindingsChange(next);
  }

  function captureInto(action: BindableAction, slot: number): void {
    capturing = { action, slot };
    render();
  }

  function render(): void {
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
      }
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    backdrop.hidden = !next;
    if (!next) capturing = undefined;
    render();
    onOpenChange?.(next);
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (capturing) {
      // Escape cancels the capture; it never binds, and never closes the
      // menu out from under a player who was mid-rebind.
      event.preventDefault();
      if (event.code === "Escape") {
        stopCapture();
        return;
      }
      const { action, slot } = capturing;
      const previousOwner = BINDABLE_ACTIONS.find(
        (other) => other !== action && bindings[other].includes(event.code),
      );
      const next = rebind(bindings, action, slot, event.code);
      capturing = undefined;
      applyBindings(next, previousOwner ? [action, previousOwner] : []);
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      setOpen(!open);
    }
  };

  const onResetClick = (): void => {
    capturing = undefined;
    applyBindings(DEFAULT_BINDINGS);
  };
  const onCloseClick = (): void => setOpen(false);

  reset.addEventListener("click", onResetClick);
  close.addEventListener("click", onCloseClick);
  const view = doc.defaultView;
  view?.addEventListener("keydown", onKeyDown);

  render();

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
      backdrop.remove();
    },
  };
}
