// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, rebind } from "../../../src/input/keybindings";
import { attachKeyboard, KeyboardState } from "../../../src/input/keyboard";

/** The default map and a fully rebound one, so every movement rule below
 * is proven against bindings the player chose as well as the shipped
 * ones (Quentin's direction). */
const REBOUND = ["move_up", "move_down", "move_left", "move_right"].reduce(
  (bindings, action, i) =>
    rebind(bindings, action as "move_up", 0, ["KeyI", "KeyK", "KeyJ", "KeyL"][i] as string),
  DEFAULT_BINDINGS,
);

const MAPS = [
  { name: "the default bindings", bindings: DEFAULT_BINDINGS, up: "KeyW", right: "KeyD" },
  { name: "a rebound map", bindings: REBOUND, up: "KeyI", right: "KeyL" },
];

for (const { name, bindings, up, right } of MAPS) {
  describe(`KeyboardState against ${name}`, () => {
    it("no keys held is a zero direction", () => {
      expect(new KeyboardState(bindings).direction()).toEqual({ x: 0, y: 0 });
    });

    it("keydown then keyup returns to zero", () => {
      const state = new KeyboardState(bindings);
      state.keydown(right);
      expect(state.direction()).toEqual({ x: 1, y: 0 });
      state.keyup(right);
      expect(state.direction()).toEqual({ x: 0, y: 0 });
    });

    it("combines multiple held keys, including a diagonal", () => {
      const state = new KeyboardState(bindings);
      state.keydown(right);
      state.keydown(up);
      expect(state.direction()).toEqual({ x: 1, y: -1 });
    });

    it("opposite keys held together cancel to zero", () => {
      const state = new KeyboardState(bindings);
      state.keydown("ArrowLeft");
      state.keydown("ArrowRight");
      expect(state.direction()).toEqual({ x: 0, y: 0 });
    });

    it("the arrow keys keep working alongside the letter keys", () => {
      const state = new KeyboardState(bindings);
      state.keydown("ArrowUp");
      expect(state.direction()).toEqual({ x: 0, y: -1 });
    });

    it("ignores a code that is not bound to any action", () => {
      const state = new KeyboardState(bindings);
      state.keydown("ShiftLeft");
      expect(state.direction()).toEqual({ x: 0, y: 0 });
    });

    it("releaseAll drops every held key at once", () => {
      const state = new KeyboardState(bindings);
      state.keydown(up);
      state.keydown("ArrowLeft");
      state.releaseAll();
      expect(state.direction()).toEqual({ x: 0, y: 0 });
    });

    it("a repeated keydown for the same key is idempotent", () => {
      const state = new KeyboardState(bindings);
      state.keydown(up);
      state.keydown(up);
      expect(state.direction()).toEqual({ x: 0, y: -1 });
    });

    it("keyup for a key that was never held is a no-op", () => {
      const state = new KeyboardState(bindings);
      state.keyup(up);
      expect(state.direction()).toEqual({ x: 0, y: 0 });
    });

    it("keyup ignores an unbound code", () => {
      const state = new KeyboardState(bindings);
      state.keydown(up);
      state.keyup("ShiftLeft");
      expect(state.direction()).toEqual({ x: 0, y: -1 });
    });
  });
}

describe("KeyboardState and rebinding", () => {
  it("the old key stops working the moment the new one is bound", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    state.keydown("KeyW");
    expect(state.direction()).toEqual({ x: 0, y: -1 });

    state.setBindings(REBOUND);
    // Whatever was held is released with the map it belonged to: a code
    // that no longer means anything must not stay stuck down.
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    state.keydown("KeyW");
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    state.keydown("KeyI");
    expect(state.direction()).toEqual({ x: 0, y: -1 });
  });
});

describe("KeyboardState while the options menu has the keyboard", () => {
  it("suspending releases everything held and ignores further keys", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    state.keydown("KeyD");
    state.suspend();
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    state.keydown("KeyD");
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("resuming takes input again, but never with a key still held from before", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    state.suspend();
    state.keydown("KeyD");
    state.resume();
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    state.keydown("KeyD");
    expect(state.direction()).toEqual({ x: 1, y: 0 });
  });
});

describe("attachKeyboard", () => {
  it("resolves KeyboardEvent.code, never .key", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown", key: "ArrowDown" }));
    expect(state.direction()).toEqual({ x: 0, y: 1 });
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowDown", key: "ArrowDown" }));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    detach();
  });

  it("keeps walking with Shift or CapsLock down -- the .key regression", () => {
    // With `.key`, holding Shift turns "w" into "W" and movement stops
    // dead mid-walk. `.code` is "KeyW" either way.
    const state = new KeyboardState(DEFAULT_BINDINGS);
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyW", key: "W", shiftKey: true }),
    );
    expect(state.direction()).toEqual({ x: 0, y: -1 });
    detach();
  });

  it("moves on an AZERTY layout, where the same physical key prints 'z'", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "z" }));
    expect(state.direction()).toEqual({ x: 0, y: -1 });
    detach();
  });

  it("releases every held key on window blur", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(state.direction()).toEqual({ x: 1, y: 0 });
    window.dispatchEvent(new Event("blur"));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    detach();
  });

  it("releases every held key on document visibilitychange", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(state.direction()).toEqual({ x: 1, y: 0 });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    detach();
  });

  it("detach removes every listener it added", () => {
    const state = new KeyboardState(DEFAULT_BINDINGS);
    const detach = attachKeyboard(state, window);
    detach();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });
});
