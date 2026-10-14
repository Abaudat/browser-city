// Story 15.20 (FR117): a transition is reachable from every standable
// approach. Real stairs-world transitions, real collision grid, real
// `stepAndTransition` -- no hand-built grid and no exemption list.
import { describe, expect, it } from "vitest";
import {
  type FloorWalkResult,
  type FloorWalkState,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import { isBodyClear } from "../../../src/world/standable";
import {
  forwardOpenNeighbor,
  pairTransitions,
  reverseOpenNeighbor,
} from "../../../src/world/transitions";
import {
  STAIRS_ENTRY_DIRECTION,
  STAIRS_Y,
  STREET_FLOOR,
  STREET_TRANSITIONS,
  SUBWAY_ENTRANCE_X0,
  SUBWAY_FLOOR,
  streetFlightIndex,
  streetMovementConfig,
  streetTransitionIndex,
  streetWorldIndex,
} from "../support/stairs-world";

const config = streetMovementConfig();
const world = streetWorldIndex();
const transitions = streetTransitionIndex();
const s = config.subcellsPerCell;
const { pairings } = pairTransitions(STREET_TRANSITIONS);

type Dir = { x: number; y: number };
interface Side {
  readonly name: string;
  readonly floor: number;
  readonly cell: { readonly x: number; readonly y: number };
  readonly direction: Dir;
  readonly targetFloor: number;
}

const walkHeld = (start: FloorWalkState, dir: Dir) => {
  let state: FloorWalkResult = { ...start, transitioned: false };
  for (let i = 0; i < 400; i++) {
    const next = stepAndTransition(state, dir, 16, world, config, transitions, streetFlightIndex());
    if (next.transitioned) return next;
    if (next.x === state.x && next.y === state.y) return next;
    state = next;
  }
  throw new Error("walkHeld: never rested");
};

const sides: Side[] = pairings.flatMap((p) => {
  const f = forwardOpenNeighbor(p);
  const r = reverseOpenNeighbor(p);
  const tag = `(${p.forward.x},${p.forward.y})<->(${p.reverse.x},${p.reverse.y})`;
  return [
    {
      name: `${tag} down`,
      floor: p.forward.floor,
      cell: f.cell,
      direction: f.direction,
      targetFloor: p.forward.targetFloor,
    },
    {
      name: `${tag} up`,
      floor: p.reverse.floor,
      cell: r.cell,
      direction: r.direction,
      targetFloor: p.reverse.targetFloor,
    },
  ];
});

/** Every walk of one side; the failures are collected, never thrown on the first. */
function sweepSide(side: Side) {
  const perp = { x: -side.direction.y, y: side.direction.x };
  const clear = (cx: number, feet: number) => isBodyClear(world, config, side.floor, cx, feet);
  const blockedAhead = (cx: number, feet: number) =>
    !clear(cx + side.direction.x, feet + side.direction.y);
  const pressed = (cx: number, feet: number, sign: number) =>
    !clear(cx + sign * perp.x, feet + sign * perp.y);
  const starts: { cx: number; feet: number }[] = [];
  for (let cx = side.cell.x * s; cx < (side.cell.x + 1) * s; cx++) {
    for (let feet = side.cell.y * s + 1; feet <= (side.cell.y + 1) * s; feet++) {
      if (clear(cx, feet)) starts.push({ cx, feet });
    }
  }
  const failures: string[] = [];
  let walks = 0;
  let excluded = 0;
  let wallPressed = 0;
  const back = { x: -side.direction.x, y: -side.direction.y };
  for (const { cx, feet } of starts) {
    if (blockedAhead(cx, feet)) {
      excluded++;
      continue;
    }
    const dirs: Dir[] = [side.direction];
    for (const sign of [1, -1]) {
      if (pressed(cx, feet, sign)) {
        wallPressed++;
        dirs.push({ x: side.direction.x + sign * perp.x, y: side.direction.y + sign * perp.y });
      }
    }
    for (const dir of dirs) {
      walks++;
      const start = initialFloorWalkState(cx / s, feet / s, side.floor);
      const end = walkHeld(start, dir);
      const at = `start sub-cell (${cx}, ${feet}) holding (${dir.x}, ${dir.y})`;
      if (!end.transitioned || end.floor !== side.targetFloor) {
        failures.push(`${at} rested at (${end.x}, ${end.y}) floor ${end.floor}`);
        continue;
      }
      const returned = walkHeld(end, back);
      if (!returned.transitioned || returned.floor !== side.floor) {
        failures.push(`${at}: no round trip, rested at (${returned.x}, ${returned.y})`);
      }
    }
  }
  return { starts: starts.length, walks, excluded, wallPressed, failures };
}

describe("transitions are reachable from every standable approach (story 15.20)", () => {
  it("replays the demo: pressed against the subway flight's bottom wall, holding the flight's direction, reaches the subway", () => {
    const start = initialFloorWalkState(SUBWAY_ENTRANCE_X0 + 0.5, STAIRS_Y + 1, STREET_FLOOR);
    const end = walkHeld(start, STAIRS_ENTRY_DIRECTION);
    expect(end.floor).toBe(SUBWAY_FLOOR);
  });

  it("has at least four sides, both flights of the subway among them", () => {
    expect(sides.length).toBeGreaterThanOrEqual(4);
    const floors = new Set(sides.map((side) => side.floor));
    expect(floors.has(STREET_FLOOR) && floors.has(SUBWAY_FLOOR)).toBe(true);
  });

  const outs = new Map<Side, ReturnType<typeof sweepSide>>();
  const sweep = (side: Side) => {
    const known = outs.get(side);
    if (known) return known;
    const out = sweepSide(side);
    outs.set(side, out);
    return out;
  };

  describe("each side of every pairing: every standable start crosses, and walks back", () => {
    for (const side of sides) {
      it(`${side.name}: every standable start crosses, and walks back`, () => {
        const out = sweep(side);
        expect(out.starts).toBeGreaterThan(s);
        expect(out.wallPressed, "a wall-pressed start").toBeGreaterThan(0);
        expect(out.excluded).toBe(0);
        expect(out.failures).toEqual([]);
      });
    }
  });

  it("inv_transition_reachable_from_every_standable_approach", () => {
    const all = sides.map((side) => ({ side, out: sweep(side) }));
    expect(all.reduce((total, { out }) => total + out.walks, 0)).toBeGreaterThan(1000);
    expect(all.flatMap(({ side, out }) => out.failures.map((f) => `${side.name}: ${f}`))).toEqual(
      [],
    );
  });
});
