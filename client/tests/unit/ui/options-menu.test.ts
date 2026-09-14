// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../../src/input/keybindings";
import { DEFAULT_BINDINGS, rebind } from "../../../src/input/keybindings";
import type { OptionsMenuHandle } from "../../../src/ui/options-menu";
import { keycapLabel, mountOptionsMenu, SWAP_FLASH_MS } from "../../../src/ui/options-menu";

interface Harness {
  readonly menu: OptionsMenuHandle;
  readonly changes: Bindings[];
  readonly openStates: boolean[];
  bindings(): Bindings;
}

function mount(initial: Bindings = DEFAULT_BINDINGS): Harness {
  const changes: Bindings[] = [];
  const openStates: boolean[] = [];
  let current = initial;
  const menu = mountOptionsMenu({
    container: document.body,
    initialBindings: initial,
    onBindingsChange: (next) => {
      current = next;
      changes.push(next);
    },
    onOpenChange: (open) => openStates.push(open),
  });
  return { menu, changes, openStates, bindings: () => current };
}

function pressKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

function rowFor(action: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-bc-action="${action}"]`);
  if (!row) throw new Error(`no row for ${action}`);
  return row;
}

function keycapsOf(action: string): HTMLButtonElement[] {
  return [...rowFor(action).querySelectorAll<HTMLButtonElement>("[data-bc-keycap]")];
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mountOptionsMenu", () => {
  it("mounts closed, so the menu never covers the city uninvited", () => {
    const h = mount();
    expect(h.menu.isOpen()).toBe(false);
    expect(document.querySelector("[data-bc-options]")?.getAttribute("hidden")).not.toBeNull();
    h.menu.destroy();
  });

  it("a closed menu is display:none, so it never swallows a click meant for the world", () => {
    // The panel is a full-screen flex backdrop, and `display: flex` beats
    // the `hidden` attribute's own UA rule -- without an explicit
    // `[hidden] { display: none }` a closed menu stays an invisible sheet
    // over the whole city that intercepts every click.
    const h = mount();
    const backdrop = document.querySelector<HTMLElement>("[data-bc-backdrop]");
    if (!backdrop) throw new Error("no backdrop");
    expect(window.getComputedStyle(backdrop).display).toBe("none");
    h.menu.open();
    expect(window.getComputedStyle(backdrop).display).not.toBe("none");
    h.menu.destroy();
  });

  it("Escape opens it and Escape closes it again (FR151)", () => {
    const h = mount();
    pressKey("Escape");
    expect(h.menu.isOpen()).toBe(true);
    pressKey("Escape");
    expect(h.menu.isOpen()).toBe(false);
    expect(h.openStates).toEqual([true, false]);
    h.menu.destroy();
  });

  it("the close button closes it too", () => {
    const h = mount();
    h.menu.open();
    document.querySelector<HTMLButtonElement>("[data-bc-close]")?.click();
    expect(h.menu.isOpen()).toBe(false);
    h.menu.destroy();
  });

  it("reports open state so the caller can take the keyboard off movement", () => {
    const h = mount();
    h.menu.open();
    expect(h.openStates).toEqual([true]);
    h.menu.close();
    expect(h.openStates).toEqual([true, false]);
    h.menu.destroy();
  });

  it("toggle opens then closes, the same as pressing Escape twice", () => {
    const h = mount();
    h.menu.toggle();
    expect(h.menu.isOpen()).toBe(true);
    h.menu.toggle();
    expect(h.menu.isOpen()).toBe(false);
    h.menu.destroy();
  });

  it("setBindings redraws what it shows without reporting a change back", () => {
    const h = mount();
    h.menu.open();
    h.menu.setBindings(rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyI"));
    expect(keycapsOf("move_up").map((b) => b.textContent)).toEqual(["I", "↑"]);
    // The caller already knows -- it is the one that changed them.
    expect(h.changes).toEqual([]);
    h.menu.destroy();
  });

  it("is one panel over a backdrop, with the world left running behind it", () => {
    const h = mount();
    h.menu.open();
    expect(document.querySelectorAll("[data-bc-options]")).toHaveLength(1);
    expect(document.querySelector("[data-bc-backdrop]")).not.toBeNull();
    h.menu.destroy();
  });

  it("shows the Controls section and invents no placeholder settings", () => {
    const h = mount();
    h.menu.open();
    const text = document.querySelector("[data-bc-options]")?.textContent ?? "";
    expect(text).toContain("Controls");
    expect(text).toContain("Options");
    // Audio and Display are later stories: no empty rows, no disabled
    // sliders, nothing invented.
    expect(text).not.toContain("Volume");
    expect(text).not.toContain("Fullscreen");
    h.menu.destroy();
  });

  it("says that Escape is fixed, rather than offering it as a binding", () => {
    const h = mount();
    h.menu.open();
    const text = document.querySelector("[data-bc-options]")?.textContent ?? "";
    expect(text).toContain("Escape");
    h.menu.destroy();
  });

  it("names each action in plain words, never by its own code", () => {
    const h = mount();
    h.menu.open();
    expect(rowFor("move_up").textContent).toContain("Walk up");
    expect(rowFor("move_left").textContent).toContain("Walk left");
    const text = document.querySelector("[data-bc-options]")?.textContent ?? "";
    expect(text).not.toContain("move_up");
    h.menu.destroy();
  });

  it("shows both of an action's keys, arrows as glyphs", () => {
    const h = mount();
    h.menu.open();
    expect(keycapsOf("move_up").map((b) => b.textContent)).toEqual(["W", "↑"]);
    expect(keycapsOf("move_right").map((b) => b.textContent)).toEqual(["D", "→"]);
    h.menu.destroy();
  });

  it("every control is a focusable button, so the menu about keys is usable by keyboard", () => {
    const h = mount();
    h.menu.open();
    for (const cap of keycapsOf("move_up")) expect(cap.tagName).toBe("BUTTON");
    expect(document.querySelector("[data-bc-reset]")?.tagName).toBe("BUTTON");
    expect(document.querySelector("[data-bc-close]")?.tagName).toBe("BUTTON");
    h.menu.destroy();
  });
});

describe("rebinding through the menu", () => {
  it("a keycap asks for a key, and the next key press binds it", () => {
    const h = mount();
    h.menu.open();
    (keycapsOf("move_up")[0] as HTMLButtonElement).click();
    expect(keycapsOf("move_up")[0]?.textContent).toBe("Press a key…");

    pressKey("KeyI");
    expect(h.bindings().move_up).toEqual(["KeyI", "ArrowUp"]);
    expect(keycapsOf("move_up").map((b) => b.textContent)).toEqual(["I", "↑"]);
    expect(h.changes).toHaveLength(1);
    h.menu.destroy();
  });

  it("Escape cancels the capture without closing the menu or binding anything", () => {
    const h = mount();
    h.menu.open();
    const cap = keycapsOf("move_up")[0] as HTMLButtonElement;
    cap.click();
    pressKey("Escape");
    expect(h.menu.isOpen()).toBe(true);
    expect(h.changes).toEqual([]);
    expect(keycapsOf("move_up")[0]?.textContent).toBe("W");
    h.menu.destroy();
  });

  it("swaps with the action that already had the key, and flashes both rows", () => {
    vi.useFakeTimers();
    const h = mount();
    h.menu.open();
    (keycapsOf("move_up")[0] as HTMLButtonElement).click();
    pressKey("KeyS");

    expect(h.bindings().move_up).toEqual(["KeyS", "ArrowUp"]);
    expect(h.bindings().move_down).toEqual(["KeyW", "ArrowDown"]);
    expect(rowFor("move_up").dataset.bcFlash).toBe("true");
    expect(rowFor("move_down").dataset.bcFlash).toBe("true");

    vi.advanceTimersByTime(SWAP_FLASH_MS);
    expect(rowFor("move_up").dataset.bcFlash).toBeUndefined();
    expect(rowFor("move_down").dataset.bcFlash).toBeUndefined();
    h.menu.destroy();
  });

  it("never blocks with a dialog: no alert, no confirm", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const h = mount();
    h.menu.open();
    (keycapsOf("move_up")[0] as HTMLButtonElement).click();
    pressKey("KeyS");
    document.querySelector<HTMLButtonElement>("[data-bc-reset]")?.click();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
    h.menu.destroy();
  });

  it("resets to defaults with no confirmation step", () => {
    const h = mount();
    h.menu.open();
    (keycapsOf("move_up")[0] as HTMLButtonElement).click();
    pressKey("KeyI");
    document.querySelector<HTMLButtonElement>("[data-bc-reset]")?.click();
    expect(h.bindings()).toEqual(DEFAULT_BINDINGS);
    expect(keycapsOf("move_up").map((b) => b.textContent)).toEqual(["W", "↑"]);
    h.menu.destroy();
  });

  it("a key press with no capture pending never rebinds anything", () => {
    const h = mount();
    h.menu.open();
    pressKey("KeyI");
    expect(h.changes).toEqual([]);
    h.menu.destroy();
  });

  it("shows whatever bindings it was given, including the defaults after cleared storage", () => {
    const h = mount(DEFAULT_BINDINGS);
    h.menu.open();
    expect(keycapsOf("move_up").map((b) => b.textContent)).toEqual(["W", "↑"]);
    // No "your settings were reset" notice anywhere.
    expect(document.querySelector("[data-bc-options]")?.textContent).not.toContain("reset to");
    h.menu.destroy();
  });

  it("destroy removes the menu and stops listening for Escape", () => {
    const h = mount();
    h.menu.destroy();
    expect(document.querySelector("[data-bc-options]")).toBeNull();
    pressKey("Escape");
    expect(h.openStates).toEqual([]);
  });
});

describe("keyboard navigation", () => {
  // A menu about keys has to be usable without a mouse.
  it("focuses the first keycap on open, so Tab starts inside the panel", () => {
    const h = mount();
    h.menu.open();
    expect(document.activeElement).toBe(keycapsOf("move_up")[0]);
    h.menu.destroy();
  });

  it("returns focus to the page on close, so movement keys are not typed into a button", () => {
    const h = mount();
    h.menu.open();
    h.menu.close();
    expect(document.activeElement).not.toBe(keycapsOf("move_up")[0]);
    expect(["BODY", undefined]).toContain(document.activeElement?.tagName);
    h.menu.destroy();
  });

  it("keeps Tab inside the panel rather than leaking to the page behind it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const h = mount();
    h.menu.open();

    const focusables = [...document.querySelectorAll<HTMLElement>("[data-bc-panel] button")];
    const last = focusables[focusables.length - 1] as HTMLElement;
    const first = focusables[0] as HTMLElement;

    // Tab off the last control wraps to the first, never to `outside`.
    last.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    // Shift+Tab off the first wraps to the last.
    first.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(last);
    h.menu.destroy();
  });

  it("Tab cancels a capture instead of binding itself as a movement key", () => {
    const h = mount();
    h.menu.open();
    (keycapsOf("move_up")[0] as HTMLButtonElement).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", bubbles: true }));

    expect(h.changes).toEqual([]);
    expect(h.bindings().move_up).toEqual(DEFAULT_BINDINGS.move_up);
    expect(keycapsOf("move_up")[0]?.textContent).toBe("W");
    expect(h.menu.isOpen()).toBe(true);
    h.menu.destroy();
  });

  it("a key that cannot be bound is ignored, never saved to vanish on reload", () => {
    const h = mount();
    h.menu.open();
    (keycapsOf("move_up")[0] as HTMLButtonElement).click();
    // Some IMEs and virtual keyboards report this for every key.
    pressKey("Unidentified");
    expect(h.changes).toEqual([]);
    // Still capturing: the player's next real key press is what binds.
    expect(keycapsOf("move_up")[0]?.textContent).toBe("Press a key…");
    pressKey("KeyI");
    expect(h.bindings().move_up).toEqual(["KeyI", "ArrowUp"]);
    h.menu.destroy();
  });
});

describe("keycapLabel", () => {
  it("prints a letter key as its letter and an arrow as its glyph", () => {
    expect(keycapLabel("KeyW")).toBe("W");
    expect(keycapLabel("ArrowUp")).toBe("↑");
    expect(keycapLabel("ArrowDown")).toBe("↓");
    expect(keycapLabel("ArrowLeft")).toBe("←");
    expect(keycapLabel("ArrowRight")).toBe("→");
  });

  it("prints a digit key as its digit", () => {
    expect(keycapLabel("Digit1")).toBe("1");
    expect(keycapLabel("Numpad8")).toBe("Num 8");
  });

  it("gives the common non-letter keys readable names, never a code identifier", () => {
    expect(keycapLabel("Space")).toBe("Space");
    expect(keycapLabel("ShiftLeft")).toBe("Left Shift");
    expect(keycapLabel("ShiftRight")).toBe("Right Shift");
    expect(keycapLabel("ControlLeft")).toBe("Left Ctrl");
    expect(keycapLabel("AltLeft")).toBe("Left Alt");
    expect(keycapLabel("Enter")).toBe("Enter");
    expect(keycapLabel("Tab")).toBe("Tab");
  });

  it("prints punctuation as the character it is, not as its code name", () => {
    expect(keycapLabel("Semicolon")).toBe(";");
    expect(keycapLabel("Comma")).toBe(",");
    expect(keycapLabel("Period")).toBe(".");
    expect(keycapLabel("Slash")).toBe("/");
    expect(keycapLabel("BracketLeft")).toBe("[");
    expect(keycapLabel("BracketRight")).toBe("]");
  });

  it("falls back to the code itself for anything it has no name for", () => {
    expect(keycapLabel("F5")).toBe("F5");
  });
});
