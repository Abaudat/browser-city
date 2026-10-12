// NFR16 (D-L3): L3 stays client-simulated, so the server schema carries none
// of what L3 derives per body per frame -- a sub-tile position or offset, a
// sidestep, a facing, a frame, an activity, a heading or speed, a gait phase, a
// flavour. Egress is ~2.4 GB/month only while that holds.
//
// The guard is an allowlist: every table or column of that shape must be named
// here with its reason. A new one fails until someone adds it on purpose, which
// is a review. Names are matched by whole snake_case tokens, so `level3_unlock`
// is not a hit and `citizen_pose` is.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Snapshot {
  tables: { accessor: string; columns: { name: string }[] }[];
}

/** The tokens of a name that say "a pose, an offset or a frame". */
const POSE_TOKENS = new Set([
  "x",
  "y",
  "z",
  "dx",
  "dy",
  "offset",
  "sidestep",
  "avoid",
  "avoidance",
  "facing",
  "direction",
  "heading",
  "speed",
  "frame",
  "animation",
  "activity",
  "gait",
  "phase",
  "flavour",
  "flavor",
  "pose",
  "micro",
  "l3",
]);

function isPoseShaped(name: string): boolean {
  return name.split("_").some((token) => POSE_TOKENS.has(token));
}

/** Every table and column that is allowed to be pose-shaped, and why. None is
 * a citizen body's per-frame state: those are authoritative cells and a
 * player's own position, never L3 output. */
const ALLOWED: Readonly<Record<string, string>> = {
  "floor_transition.x": "the cell of a stairway or door",
  "floor_transition.y": "the cell of a stairway or door",
  "floor_transition.target_x": "the cell a transition lands on",
  "floor_transition.target_y": "the cell a transition lands on",
  "item_held.slot_x": "a grid slot in an inventory, not a world position",
  "item_held.slot_y": "a grid slot in an inventory, not a world position",
  "item_placed.x": "the cell an item is placed in",
  "item_placed.y": "the cell an item is placed in",
  "item_placed.offset_x": "where in its cell a placed item sits: placed once, never per frame",
  "item_placed.offset_y": "where in its cell a placed item sits: placed once, never per frame",
  "placed_object.x": "the cell an object is placed in",
  "placed_object.y": "the cell an object is placed in",
  "player_position.x": "a player's own authoritative cell (FR128), not an L3 body",
  "player_position.y": "a player's own authoritative cell (FR128), not an L3 body",
  "player_position.frac_x": "a player's own authoritative sub-cell (FR128), not an L3 body",
  "player_position.frac_y": "a player's own authoritative sub-cell (FR128), not an L3 body",
  "world_clock.speed": "the city clock's rate",
};

function poseShaped(snapshot: Snapshot): string[] {
  const found: string[] = [];
  for (const t of snapshot.tables) {
    if (isPoseShaped(t.accessor)) found.push(t.accessor);
    for (const c of t.columns) if (isPoseShaped(c.name)) found.push(`${t.accessor}.${c.name}`);
  }
  return found.sort();
}

/** What is pose-shaped and not allowed, and what is allowed and gone. */
function violations(snapshot: Snapshot, allowed: Readonly<Record<string, string>>) {
  const found = poseShaped(snapshot);
  return {
    unlisted: found.filter((n) => !(n in allowed)),
    stale: Object.keys(allowed).filter((n) => !found.includes(n)),
  };
}

describe("the server schema carries no per-body L3 state (NFR16)", () => {
  const snapshot = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../server/schema.snapshot.json"), "utf8"),
  ) as Snapshot;

  it("has no pose-shaped table or column that is not allowlisted with a reason", () => {
    expect(snapshot.tables.length).toBeGreaterThan(0);
    expect(violations(snapshot, ALLOWED)).toEqual({ unlisted: [], stale: [] });
  });

  it("gives every allowlisted entry a reason", () => {
    for (const [name, why] of Object.entries(ALLOWED)) {
      expect(why.length, name).toBeGreaterThan(8);
    }
  });

  it("goes red on a planted citizen_pose table, a body_frame table and a citizen offset column", () => {
    const planted: Snapshot = {
      tables: [
        { accessor: "citizen_pose", columns: [{ name: "id" }, { name: "x" }, { name: "facing" }] },
        { accessor: "body_frame", columns: [{ name: "dx" }, { name: "dy" }] },
        { accessor: "citizen", columns: [{ name: "id" }, { name: "offset_x" }] },
      ],
    };
    const { unlisted } = violations(planted, {});
    expect(unlisted).toEqual(
      expect.arrayContaining([
        "citizen_pose",
        "citizen_pose.x",
        "citizen_pose.facing",
        "body_frame",
        "body_frame.dx",
        "body_frame.dy",
        "citizen.offset_x",
      ]),
    );
  });

  it("matches whole tokens: level3_unlock and an `avoided` column are not hits", () => {
    const calm: Snapshot = {
      tables: [{ accessor: "level3_unlock", columns: [{ name: "id" }, { name: "avoided_count" }] }],
    };
    expect(poseShaped(calm)).toEqual([]);
  });

  it("goes red on an allowlist entry whose column is gone, so the list cannot rot", () => {
    const empty: Snapshot = { tables: [{ accessor: "t", columns: [{ name: "id" }] }] };
    expect(violations(empty, { "t.x": "a reason that is long enough" }).stale).toEqual(["t.x"]);
  });
});
