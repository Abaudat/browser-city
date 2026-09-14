import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../../../src/input/keybindings";
import {
  actionForCode,
  BINDABLE_ACTIONS,
  DEFAULT_BINDINGS,
  isBindableCode,
  isReservedCode,
  normaliseBindings,
  RESERVED_CODES,
  rebind,
} from "../../../src/input/keybindings";

function codesOf(bindings: Bindings): string[] {
  return BINDABLE_ACTIONS.flatMap((action) => [...bindings[action]]);
}

/** Every action is present, every code is a usable string, and no code is
 * bound to two actions. */
function expectValid(bindings: Bindings): void {
  for (const action of BINDABLE_ACTIONS) {
    expect(Array.isArray(bindings[action])).toBe(true);
    for (const code of bindings[action]) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
      expect(isReservedCode(code)).toBe(false);
    }
  }
  const codes = codesOf(bindings);
  expect(new Set(codes).size).toBe(codes.length);
}

/** Valid, and additionally playable: every direction still has a key.
 * `rebind` guarantees this outright -- it refuses a rebind that would
 * take another action's last key. `normaliseBindings` guarantees it for
 * everything short of storage hand-edited to give one action every one of
 * another's keys, which no path in the game produces. */
function expectNoStrandedAction(bindings: Bindings): void {
  expectValid(bindings);
  for (const action of BINDABLE_ACTIONS) {
    expect(bindings[action].length, `${action} has no key bound`).toBeGreaterThan(0);
  }
}

describe("DEFAULT_BINDINGS", () => {
  it("binds WASD and the arrow keys, by KeyboardEvent.code (FR149)", () => {
    expect(DEFAULT_BINDINGS.move_up).toEqual(["KeyW", "ArrowUp"]);
    expect(DEFAULT_BINDINGS.move_down).toEqual(["KeyS", "ArrowDown"]);
    expect(DEFAULT_BINDINGS.move_left).toEqual(["KeyA", "ArrowLeft"]);
    expect(DEFAULT_BINDINGS.move_right).toEqual(["KeyD", "ArrowRight"]);
  });

  it("is itself valid", () => {
    expectValid(DEFAULT_BINDINGS);
  });

  it("reserves Escape for the options menu, so it can never be bound", () => {
    expect(RESERVED_CODES).toContain("Escape");
    expect(isReservedCode("Escape")).toBe(true);
    expect(isReservedCode("KeyW")).toBe(false);
  });
});

describe("isBindableCode", () => {
  // One definition of "a code a player can actually bind", shared by
  // `rebind` and `normaliseBindings` -- otherwise the menu can save a
  // binding that silently vanishes on the next load.
  it("accepts a real physical key code", () => {
    for (const code of ["KeyW", "ArrowUp", "Space", "Numpad8", "F5", "Semicolon"]) {
      expect(isBindableCode(code)).toBe(true);
    }
  });

  it("rejects the empty string", () => {
    expect(isBindableCode("")).toBe(false);
  });

  it("rejects 'Unidentified', which an IME or a virtual keyboard can send", () => {
    expect(isBindableCode("Unidentified")).toBe(false);
  });

  it("rejects a reserved code", () => {
    expect(isBindableCode("Escape")).toBe(false);
  });

  it("rejects anything that is not a string at all", () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(isBindableCode(value as unknown as string)).toBe(false);
    }
  });
});

describe("actionForCode", () => {
  it("resolves every default code to its own action", () => {
    expect(actionForCode(DEFAULT_BINDINGS, "KeyW")).toBe("move_up");
    expect(actionForCode(DEFAULT_BINDINGS, "ArrowUp")).toBe("move_up");
    expect(actionForCode(DEFAULT_BINDINGS, "ArrowRight")).toBe("move_right");
  });

  it("resolves an unbound code to nothing", () => {
    expect(actionForCode(DEFAULT_BINDINGS, "KeyQ")).toBeUndefined();
    expect(actionForCode(DEFAULT_BINDINGS, "Escape")).toBeUndefined();
  });

  it("is case-sensitive on the code, never on the printed character", () => {
    // `KeyboardEvent.code` is physical: Shift or CapsLock never change it,
    // which is exactly why bindings are keyed on it (a `.key` of "W" is
    // the bug this replaces).
    expect(actionForCode(DEFAULT_BINDINGS, "keyw")).toBeUndefined();
    expect(actionForCode(DEFAULT_BINDINGS, "W")).toBeUndefined();
  });
});

describe("rebind", () => {
  it("replaces the chosen slot, leaving the action's other key alone", () => {
    const next = rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyI");
    expect(next.move_up).toEqual(["KeyI", "ArrowUp"]);
    expectNoStrandedAction(next);
  });

  it("never mutates the map it was given", () => {
    const before = JSON.stringify(DEFAULT_BINDINGS);
    rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyI");
    expect(JSON.stringify(DEFAULT_BINDINGS)).toBe(before);
  });

  it("swaps with the action that already had the code, rather than refusing", () => {
    // Binding move_up's first slot to KeyS (move_down's own key) hands
    // move_down the key move_up just gave up -- never an error dialog,
    // and never an action left with fewer keys than it had.
    const next = rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyS");
    expect(next.move_up).toEqual(["KeyS", "ArrowUp"]);
    expect(next.move_down).toEqual(["KeyW", "ArrowDown"]);
    expectNoStrandedAction(next);
  });

  it("refuses a reserved code, leaving the map exactly as it was", () => {
    expect(rebind(DEFAULT_BINDINGS, "move_up", 0, "Escape")).toEqual(DEFAULT_BINDINGS);
  });

  it("refuses a code no loader would keep, rather than saving one that vanishes", () => {
    // `rebind` and `normaliseBindings` must agree on what is bindable:
    // anything the menu can write must survive the next load.
    for (const code of ["", "Unidentified"]) {
      expect(rebind(DEFAULT_BINDINGS, "move_up", 0, code)).toEqual(DEFAULT_BINDINGS);
    }
  });

  it("binding into a slot past the end appends, without duplicating a key the action already has", () => {
    // Found by `inv_rebind_survives_reload`: a slot index past the end
    // appends, so the appended code lands at the end rather than at that
    // index. Treating the two as the same position made the "move it
    // within this action" branch match nothing, drop every copy, and
    // leave the action with no keys at all.
    const oneKey = { ...DEFAULT_BINDINGS, move_up: ["ArrowUp"] };
    const next = rebind(oneKey, "move_up", 2, "ArrowUp");
    expect(next.move_up).toEqual(["ArrowUp"]);
    expectNoStrandedAction(next);
  });

  it("never leaves an action with no keys, whatever slot is targeted", () => {
    // Walking up with nothing bound to it is unplayable, and the menu
    // offers no way back: it shows one keycap per bound key.
    let bindings: Bindings = DEFAULT_BINDINGS;
    bindings = rebind(bindings, "move_right", 2, "KeyW");
    bindings = rebind(bindings, "move_right", 3, "ArrowUp");
    expectNoStrandedAction(bindings);
  });

  it("refuses to take the last key of another action, rather than disabling it", () => {
    const oneKey: Bindings = { ...DEFAULT_BINDINGS, move_up: ["KeyW"] };
    // move_right has two keys and a free slot to append into, so there is
    // nothing to give back in a swap -- taking KeyW would strand move_up.
    const next = rebind(oneKey, "move_right", 5, "KeyW");
    expect(next).toEqual(oneKey);
  });

  it("still swaps when the other action keeps a key, which is the normal case", () => {
    // The menu only ever targets an occupied slot, so a real rebind
    // always has something to give back.
    const next = rebind(DEFAULT_BINDINGS, "move_right", 0, "KeyW");
    expect(next.move_right).toEqual(["KeyW", "ArrowRight"]);
    expect(next.move_up).toEqual(["KeyD", "ArrowUp"]);
    expectNoStrandedAction(next);
  });

  it("inv_rebind_survives_reload", () => {
    // Whatever any sequence of rebinds produces, loading it back yields
    // exactly the same map -- no binding the player set can disappear on
    // the next boot.
    const codeArb = fc.oneof(
      fc.constantFrom(
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowLeft",
        "KeyI",
        "Space",
        "Numpad8",
        "Escape",
        "Unidentified",
        "",
      ),
      fc.string(),
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.constantFrom(...BINDABLE_ACTIONS),
            slot: fc.integer({ min: 0, max: 2 }),
            code: codeArb,
          }),
          { maxLength: 20 },
        ),
        (steps) => {
          let bindings = DEFAULT_BINDINGS;
          for (const step of steps) bindings = rebind(bindings, step.action, step.slot, step.code);
          expect(normaliseBindings(bindings)).toEqual(bindings);
        },
      ),
    );
  });

  it("rebinding a slot to the code it already holds changes nothing", () => {
    expect(rebind(DEFAULT_BINDINGS, "move_up", 0, "KeyW")).toEqual(DEFAULT_BINDINGS);
  });

  it("moving a code within one action never duplicates it", () => {
    const next = rebind(DEFAULT_BINDINGS, "move_up", 1, "KeyW");
    expect(next.move_up).toEqual(["ArrowUp", "KeyW"]);
    expectNoStrandedAction(next);
  });

  it("inv_keybindings_injective", () => {
    // After any sequence of rebinds, no code is ever bound to two
    // actions, and every action still exists.
    const codeArb = fc.constantFrom(
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyI",
      "KeyJ",
      "Escape",
      "Space",
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.constantFrom(...BINDABLE_ACTIONS),
            slot: fc.integer({ min: 0, max: 2 }),
            code: codeArb,
          }),
          { maxLength: 25 },
        ),
        (steps) => {
          let bindings = DEFAULT_BINDINGS;
          for (const step of steps) {
            bindings = rebind(bindings, step.action, step.slot, step.code);
            expectNoStrandedAction(bindings);
          }
        },
      ),
    );
  });
});

describe("normaliseBindings", () => {
  it("merges a partial map over the defaults, per action", () => {
    const next = normaliseBindings({ move_up: ["KeyI"] });
    expect(next.move_up).toEqual(["KeyI"]);
    expect(next.move_down).toEqual(DEFAULT_BINDINGS.move_down);
    expect(next.move_left).toEqual(DEFAULT_BINDINGS.move_left);
    expectValid(next);
  });

  it("drops unknown action names", () => {
    const next = normaliseBindings({ fly_up: ["KeyF"], move_up: ["KeyI"] });
    expect(next.move_up).toEqual(["KeyI"]);
    expect((next as Record<string, unknown>).fly_up).toBeUndefined();
    expectValid(next);
  });

  it("drops codes that are not usable strings, keeping the rest", () => {
    const next = normaliseBindings({ move_up: ["KeyI", 42, "", null, "KeyO"] });
    expect(next.move_up).toEqual(["KeyI", "KeyO"]);
    expectValid(next);
  });

  it("drops a reserved code rather than letting stored data steal Escape", () => {
    const next = normaliseBindings({ move_up: ["Escape", "KeyI"] });
    expect(next.move_up).toEqual(["KeyI"]);
    expectValid(next);
  });

  it("falls back to that action's defaults when its stored list cleans to nothing", () => {
    expect(normaliseBindings({ move_up: [] }).move_up).toEqual(DEFAULT_BINDINGS.move_up);
    expect(normaliseBindings({ move_up: "nope" }).move_up).toEqual(DEFAULT_BINDINGS.move_up);
  });

  it("resolves a code stored against two actions, never binding it twice", () => {
    const next = normaliseBindings({ move_up: ["KeyZ"], move_down: ["KeyZ"] });
    expectValid(next);
    expect(actionForCode(next, "KeyZ")).toBe("move_up");
  });

  it("keeps a direction playable when stored data gave its key to another action", () => {
    // Both actions stored the same code: the first in canonical order
    // keeps it, and the second falls back to whichever of its own
    // defaults are still free rather than being left unplayable.
    const next = normaliseBindings({ move_up: ["KeyZ"], move_down: ["KeyZ"] });
    expect(next.move_up).toEqual(["KeyZ"]);
    expectNoStrandedAction(next);
  });

  it("de-duplicates a code repeated within one action", () => {
    expect(normaliseBindings({ move_up: ["KeyZ", "KeyZ"] }).move_up).toEqual(["KeyZ"]);
  });

  it("returns the defaults for anything that is not a record at all", () => {
    for (const value of [undefined, null, 42, "nope", [], true]) {
      expect(normaliseBindings(value)).toEqual(DEFAULT_BINDINGS);
    }
  });

  it("inv_keybindings_parse_is_total", () => {
    // Any JSON value at all -- however hostile -- yields a complete,
    // valid map and never throws.
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const bindings = normaliseBindings(value);
        expect(Object.keys(bindings).sort()).toEqual([...BINDABLE_ACTIONS].sort());
        expectValid(bindings);
      }),
    );
  });
});
