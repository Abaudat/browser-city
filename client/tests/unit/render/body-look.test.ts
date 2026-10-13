import { describe, expect, it } from "vitest";
import { CitizenBody } from "../../../src/l3/citizen";
import { walkFramesPerCycle } from "../../../src/l3/config";
import { StreetLife, standState } from "../../../src/render/street-life";
import { l3Config, quietLife } from "../l3/defs-config";
import { CFG, TestGrid } from "../l3/support";
import { committedDefs } from "../support/committed-defs";

const cfg = l3Config();
const gait = {
  strideCells: cfg.strideCells,
  framesPerCycle: walkFramesPerCycle(committedDefs(), "adult"),
};
const walk = new TestGrid();
const make = (id: string) => () => ({
  body: new CitizenBody(walk, CFG, gait, id, quietLife()),
});

describe("a citizen's look through the street's life", () => {
  it("agreement carries the stored look whether or not the citizen has a body", () => {
    const life = new StreetLife(cfg, walk);
    const stand = standState({ x: 3, y: 3 }, 0, "down");
    life.declare({ id: "far", stand, look: "1,2,3,4,5,-1,-1", remake: make("far") });
    const near = life.add({
      id: "near",
      stand,
      look: "5,4,3,2,1,-1,-1",
      remake: make("near"),
      body: make("near")().body,
    });
    const withBody = life.agreementAt(0).map((s) => [s.id, s.look]);
    life.remove(near);
    const afterDespawn = life.agreementAt(0).map((s) => [s.id, s.look]);
    expect(withBody).toEqual([
      ["far", "1,2,3,4,5,-1,-1"],
      ["near", "5,4,3,2,1,-1,-1"],
    ]);
    // Despawn drops the body, never the citizen: nothing about its look moves.
    expect(afterDespawn).toEqual(withBody);
  });
});

describe("StreetLife: posing, reading and dropping bodies", () => {
  it("poses one body alone at its spawn instant, never moving another", () => {
    const life = new StreetLife(cfg, walk);
    const a = life.add({
      id: "a",
      stand: standState({ x: 2, y: 2 }, 0, "down"),
      standAt: { x: 2.5, y: 2.5 },
      look: "a",
      remake: make("a"),
      body: make("a")().body,
    });
    const b = life.add({
      id: "b",
      stand: standState({ x: 8, y: 8 }, 0, "left"),
      standAt: { x: 8.5, y: 8.5 },
      look: "b",
      remake: make("b"),
      body: make("b")().body,
    });
    const bBefore = { x: b.frame.x, y: b.frame.y };
    life.pose(a, 100);
    expect(a.frame.x).toBeCloseTo(2.5, 6);
    expect({ x: b.frame.x, y: b.frame.y }).toEqual(bBefore);
  });

  it("reads the live state without disturbing the last solve", () => {
    const life = new StreetLife(cfg, walk);
    life.add({
      id: "a",
      stand: standState({ x: 2, y: 2 }, 0, "down"),
      standAt: { x: 2.5, y: 2.5 },
      look: "a",
      remake: make("a"),
      body: make("a")().body,
    });
    life.solve(10);
    const before = life.liveAt(50).map((s) => s.id);
    life.remove(life.members[0] as NonNullable<(typeof life.members)[number]>);
    expect(before).toEqual(["a"]);
    // With nothing solved yet, a read restores nothing and fails nothing.
    const fresh = new StreetLife(cfg, walk);
    expect(fresh.liveAt(0)).toEqual([]);
  });

  it("drops a body it is not holding without complaint", () => {
    const life = new StreetLife(cfg, walk);
    const a = life.add({
      id: "a",
      stand: standState({ x: 2, y: 2 }, 0, "down"),
      look: "a",
      remake: make("a"),
      body: make("a")().body,
    });
    life.remove(a);
    expect(() => life.remove(a)).not.toThrow();
  });
});
