// The L3 worker's edges: a solver asked before it is told anything, slots that
// are reused or unknown, the diagnostics a debug overlay asks for, the sweep,
// and a pinned scene that no ticker drives.
import { describe, expect, it } from "vitest";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import { L3Client } from "../../../src/l3-worker/client";
import {
  B_FALLBACKS,
  B_FLAGS,
  BYTES_PER_SLOT_FIELDS,
  type CitizenInit,
  F_PRESENT,
  type FromWorker,
  H_T,
  H_WANT_DIAG,
  type Port,
  type ToWorker,
  tickBytes,
  viewTick,
} from "../../../src/l3-worker/protocol";
import { L3Solver } from "../../../src/l3-worker/solver";
import { buildRushCrowd } from "../../../src/test-street/rush-crowd";
import { lifeDialsFor, standState } from "../../../src/test-street/street-life";
import { Timetable } from "../../../src/test-street/timetable";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { l3Config } from "../l3/defs-config";
import { committedDefs, streetWorldIndex } from "../test-street/street-world";

const cfg = l3Config();
const defs = committedDefs();
const crowd = buildRushCrowd(defs);
const walk = npcWalkability(streetWorldIndex());
const gait = { strideCells: cfg.strideCells, framesPerCycle: walkFramesPerCycle(defs, "adult") };
const life = lifeDialsFor(defs, cfg, "adult");

function init(fixtureIndex: number): CitizenInit {
  const f = crowd.fixtures[fixtureIndex];
  if (!f) throw new Error("no fixture");
  const spec = crowd.specs[f.id];
  return {
    id: f.id,
    spec,
    walkMilli: spec ? new Timetable(spec, cfg, walk, pathConfigOf(cfg)).walkMilli : undefined,
    stand: spec
      ? undefined
      : standState({ x: Math.floor(f.gridX), y: Math.floor(f.gridY) }, 0, f.facing as never),
    standAt: spec ? undefined : { x: f.gridX, y: f.gridY },
    look: f.id,
    life,
    gait,
  };
}

function solverWithLog() {
  const out: FromWorker[] = [];
  let clock = 0;
  const solver = new L3Solver({
    post: (m) => void out.push(m),
    now: () => (clock += 1),
  });
  return { solver, out };
}

function tickBuffer(slots: number, t: number, wantDiag = false): ArrayBuffer {
  const buf = new ArrayBuffer(tickBytes(slots));
  const f = viewTick(buf).head;
  f[H_T] = t;
  f[H_WANT_DIAG] = wantDiag ? 1 : 0;
  return buf;
}

describe("L3Solver before it is told anything", () => {
  it("answers a tick with the buffer untouched and ignores queries and adds", () => {
    const { solver, out } = solverWithLog();
    solver.handle({ type: "add", id: "nobody", slot: 0 });
    solver.handle({ type: "query", kind: "live", id: 1, t: 0 });
    solver.handle({ type: "declare", citizens: [init(0)] });
    solver.handle({ type: "tick", buf: tickBuffer(2, 5) });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("result");
  });

  it("sweeps to a zero-filled series when there is no street", () => {
    const { solver, out } = solverWithLog();
    solver.handle({ type: "sweep", id: 3, start: 0, step: 1, frames: 4 });
    const swept = out[0];
    expect(swept?.type === "swept" && Array.from(swept.solveMs)).toEqual([0, 0, 0, 0]);
  });
});

describe("L3Solver with a street", () => {
  function started() {
    const s = solverWithLog();
    s.solver.handle({ type: "init", config: cfg });
    s.solver.handle({ type: "declare", citizens: [init(0), init(1)] });
    return s;
  }

  it("ignores an unknown id and a removed slot, replaces an occupied slot", () => {
    const { solver, out } = started();
    solver.handle({ type: "add", id: "ghost", slot: 0 });
    solver.handle({ type: "add", id: init(0).id, slot: 0 });
    solver.handle({ type: "add", id: init(1).id, slot: 0 });
    solver.handle({ type: "remove", slot: 7 });
    const buf = tickBuffer(2, 100);
    solver.handle({ type: "tick", buf });
    const result = out.find((m) => m.type === "result");
    if (result?.type !== "result") throw new Error("no result");
    const { bytes } = viewTick(result.buf);
    expect((bytes[B_FLAGS] as number) & F_PRESENT).toBe(F_PRESENT);
    expect((bytes[BYTES_PER_SLOT_FIELDS + B_FLAGS] as number) & F_PRESENT).toBe(0);
    expect(result.names?.length).toBeGreaterThan(0);
  });

  it("refreshes the diagnostics only when asked, then repeats them", () => {
    const { solver, out } = started();
    solver.handle({ type: "add", id: init(0).id, slot: 0 });
    solver.handle({ type: "tick", buf: tickBuffer(1, 100, true) });
    solver.handle({ type: "tick", buf: tickBuffer(1, 101, false) });
    const results = out.filter((m) => m.type === "result");
    expect(results).toHaveLength(2);
    for (const r of results) {
      if (r.type !== "result") continue;
      expect(viewTick(r.buf).bytes[B_FALLBACKS]).toBe(0);
    }
  });

  it("sweeps a timed solve per instant", () => {
    const { solver, out } = started();
    solver.handle({ type: "add", id: init(0).id, slot: 0 });
    solver.handle({ type: "tick", buf: tickBuffer(1, 100) });
    solver.handle({ type: "sweep", id: 9, start: 100, step: 0.5, frames: 5 });
    const swept = out.find((m) => m.type === "swept");
    if (swept?.type !== "swept") throw new Error("no sweep");
    expect(swept.id).toBe(9);
    expect(Array.from(swept.solveMs)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("L3Client edges", () => {
  function pair() {
    const sent: ToWorker[] = [];
    const port: Port<FromWorker, ToWorker> = {
      onmessage: null,
      postMessage: (m) => void sent.push(m),
    };
    return { sent, port, client: new L3Client(port, 0) };
  }

  it("does not post an empty walkability feed and ignores a foreign member", () => {
    const { sent, client } = pair();
    client.feedWalk([]);
    expect(sent).toHaveLength(0);
    const a = client.add("a");
    const other = pair().client.add("a");
    client.remove(other);
    expect(sent.filter((m) => m.type === "remove")).toHaveLength(0);
    client.remove(a);
    expect(sent.filter((m) => m.type === "remove")).toHaveLength(1);
  });

  it("settles at once when no buffer is free, and ignores a reply nobody asked for", async () => {
    const { client, port } = pair();
    for (let i = 0; i < 4; i++) client.request(i, undefined);
    await client.settle(10, undefined);
    port.onmessage?.({ data: { type: "calibrated", id: 999, ms: 1 } });
    expect(client.stats.skipped).toBe(1);
  });

  it("has no drawn instant until a result is applied", () => {
    const { client } = pair();
    expect(Number.isNaN(client.drawnInstant)).toBe(true);
  });

  it("keeps the diagnostics fresh for a while after they were asked for", () => {
    const { sent, client } = pair();
    client.wantDiagnostics();
    client.request(1, undefined);
    const tick = sent.find((m) => m.type === "tick");
    if (tick?.type !== "tick") throw new Error("no tick");
    expect(viewTick(tick.buf).head[H_WANT_DIAG]).toBe(1);
  });
});
