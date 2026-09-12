// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { attachKeyboard, KeyboardState } from "../../../src/world/keyboard";

describe("KeyboardState", () => {
  it("no keys held is a zero direction", () => {
    const state = new KeyboardState();
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("keydown then keyup returns to zero", () => {
    const state = new KeyboardState();
    state.keydown("ArrowRight");
    expect(state.direction()).toEqual({ x: 1, y: 0 });
    state.keyup("ArrowRight");
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("combines multiple held keys, including a diagonal", () => {
    const state = new KeyboardState();
    state.keydown("ArrowRight");
    state.keydown("ArrowUp");
    expect(state.direction()).toEqual({ x: 1, y: -1 });
  });

  it("opposite keys held together cancel to zero", () => {
    const state = new KeyboardState();
    state.keydown("ArrowLeft");
    state.keydown("ArrowRight");
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("wasd and arrow keys agree on direction", () => {
    const state = new KeyboardState();
    state.keydown("d");
    expect(state.direction()).toEqual({ x: 1, y: 0 });
    state.keyup("d");
    state.keydown("a");
    expect(state.direction()).toEqual({ x: -1, y: 0 });
  });

  it("ignores a key that is not a direction key", () => {
    const state = new KeyboardState();
    state.keydown("Shift");
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("releaseAll drops every held key at once", () => {
    const state = new KeyboardState();
    state.keydown("ArrowUp");
    state.keydown("ArrowLeft");
    state.releaseAll();
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("a repeated keydown for the same key is idempotent", () => {
    const state = new KeyboardState();
    state.keydown("ArrowUp");
    state.keydown("ArrowUp");
    expect(state.direction()).toEqual({ x: 0, y: -1 });
  });

  it("keyup for a key that was never held is a no-op", () => {
    const state = new KeyboardState();
    state.keyup("ArrowUp");
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });

  it("keyup ignores a key that is not a direction key", () => {
    const state = new KeyboardState();
    state.keydown("ArrowUp");
    state.keyup("Shift");
    expect(state.direction()).toEqual({ x: 0, y: -1 });
  });
});

describe("attachKeyboard", () => {
  it("wires keydown/keyup to the given window", () => {
    const state = new KeyboardState();
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(state.direction()).toEqual({ x: 0, y: 1 });
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    detach();
  });

  it("releases every held key on window blur", () => {
    const state = new KeyboardState();
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(state.direction()).toEqual({ x: 1, y: 0 });
    window.dispatchEvent(new Event("blur"));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    detach();
  });

  it("releases every held key on document visibilitychange", () => {
    const state = new KeyboardState();
    const detach = attachKeyboard(state, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(state.direction()).toEqual({ x: 1, y: 0 });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
    detach();
  });

  it("detach removes every listener it added", () => {
    const state = new KeyboardState();
    const detach = attachKeyboard(state, window);
    detach();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(state.direction()).toEqual({ x: 0, y: 0 });
  });
});
