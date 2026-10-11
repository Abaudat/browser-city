import { describe, expect, it } from "vitest";
import { CitizenBody } from "../../../src/l3/citizen";
import { walkFramesPerCycle } from "../../../src/l3/config";
import { StreetLife, standState } from "../../../src/test-street/street-life";
import { l3Config, quietLife } from "../l3/defs-config";
import { CFG, TestGrid } from "../l3/support";
import { committedDefs } from "./street-world";

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
