// NFR16 (D-L3): L3 stays client-simulated, so no table of the server schema
// may carry per-body L3 state. Egress is ~2.4 GB/month only while that holds.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Snapshot {
  tables: { accessor: string; columns: { name: string }[] }[];
}

/** Names that would carry what L3 solves per body per frame. */
const L3_STATE = /sidestep|side_step|avoid|gait|micro_?path|body_offset|l3/i;

function replicatedL3State(snapshot: Snapshot): string[] {
  const found: string[] = [];
  for (const t of snapshot.tables) {
    if (L3_STATE.test(t.accessor)) found.push(t.accessor);
    for (const c of t.columns) if (L3_STATE.test(c.name)) found.push(`${t.accessor}.${c.name}`);
  }
  return found;
}

describe("the server schema carries no per-body L3 state (NFR16)", () => {
  it("has no table or column for L3 positions, offsets or gait", () => {
    const snapshot = JSON.parse(
      readFileSync(resolve(__dirname, "../../../../server/schema.snapshot.json"), "utf8"),
    ) as Snapshot;
    expect(snapshot.tables.length).toBeGreaterThan(0);
    expect(replicatedL3State(snapshot)).toEqual([]);
  });

  it("goes red on a planted replicated sidestep column and a planted L3 table", () => {
    const planted: Snapshot = {
      tables: [
        { accessor: "citizen", columns: [{ name: "id" }, { name: "sidestep_offset_x" }] },
        { accessor: "l3_body", columns: [{ name: "id" }] },
      ],
    };
    expect(replicatedL3State(planted)).toEqual(["citizen.sidestep_offset_x", "l3_body"]);
  });
});
