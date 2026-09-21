// `fixture.ts`'s own transition data, checked directly (story 1.7): a
// regression test for a real bug this fixture found -- the subway's
// up-transition originally targeted the exact same cell the down
// transition anchors on. Landing there meant a still-held direction key,
// re-checked on the very next tick against that identical cell, retriggered
// the descent immediately: holding a direction key through the whole
// round trip bounced the player between floors instead of leaving them on
// the street. `client/tests/e2e/enclosure.spec.ts`'s subway test is what
// caught this for real, on a real keyboard walk; this unit test pins the
// data-level fact directly, so a future transition can never reintroduce
// the same shape of bug without a fast, non-flaky test catching it first.
import { describe, expect, it } from "vitest";
import {
  isDefStreetProp,
  STREET_PROPS,
  STREET_TRANSITIONS,
} from "../../../src/test-street/fixture";
import { committedDefs } from "./street-world";

// Story 2.13: pins the Epic 1 shortcut's retirement by name, so it can
// never silently regress -- a `defId` row dropped back to `solid`/
// `assetKey`, or a new row added with no real `defs/objects` id, changes
// this count and goes red here, in the fastest job, rather than only
// showing up as a raw texture import nobody meant to leave behind.
describe("every defId-placed prop draws from a real defs/objects entry", () => {
  const defs = committedDefs();
  const defRows = STREET_PROPS.filter(isDefStreetProp);

  it("has exactly the committed number of defId-placed rows, one per def-owned cell", () => {
    // Every `defId` row in this fixture, individually: the two shopfront
    // windows, the counter, the bin, the lamppost, the four parapet cells
    // and the four deck cells (story 2.13: one-cell defs, placed once per
    // cell -- `bridge_deck`'s and `wall_segment`'s own doc comments say
    // why), and the two flights of stairs. A human counting *distinct
    // props* on the street would say nine (the parapet and the deck each
    // read as one run); this array counts *placed rows*, which is more
    // once a multi-cell run is decomposed into one row per cell.
    expect(defRows.length).toBe(15);
  });

  it("names only real, currently-declared defs/objects keys", () => {
    const keys = new Set(
      defRows.map((prop) => {
        const object = defs.objects.find((o) => o.id === prop.defId);
        if (!object) {
          throw new Error(`fixture prop ${prop.id} names defId ${prop.defId}, absent from defs/`);
        }
        return object.key;
      }),
    );
    expect([...keys].sort()).toEqual([
      "bridge_deck",
      "foot_stairs",
      "lamppost",
      "shop_counter",
      "shop_window",
      "trash_bin",
      "wall_segment",
    ]);
  });

  it("no defId row also carries an assetKey -- the type itself forbids it, this is the runtime witness", () => {
    for (const prop of defRows) {
      expect("assetKey" in prop, `prop ${prop.id} carries both defId and assetKey`).toBe(false);
    }
  });
});

describe("STREET_TRANSITIONS", () => {
  it("is non-empty", () => {
    expect(STREET_TRANSITIONS.length).toBeGreaterThan(0);
  });

  it("no transition's target cell is itself a transition anchor", () => {
    // A player holding one direction key through a transition keeps
    // moving in that same direction afterwards; if the landing cell were
    // also an anchor, the very next tick (still holding the key) would
    // immediately re-trigger a transition from the cell the previous one
    // just landed on -- an infinite bounce for as long as the key stays
    // held, never a stable arrival.
    const anchors = new Set(STREET_TRANSITIONS.map((t) => `${t.x}|${t.y}|${t.floor}`));
    for (const t of STREET_TRANSITIONS) {
      const targetKey = `${t.targetX}|${t.targetY}|${t.targetFloor}`;
      expect(
        anchors.has(targetKey),
        `transition (${t.x}, ${t.y}, floor ${t.floor}) -> (${t.targetX}, ${t.targetY}, floor ${t.targetFloor}) lands exactly on a transition anchor`,
      ).toBe(false);
    }
  });
});
