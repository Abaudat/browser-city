// D-L3 (story 5.24): the L3 solve runs in a worker. These tests drive the
// real solver and the real client over a loopback port that structured-clones
// every message and transfers its buffers, and hold the protocol to what the
// leads required: the same body states as the in-process solve, transferred
// buffers, no blocking, stale frames counted, buffers growing with the street.

import { describe, expect, it } from "vitest";
import { CitizenBody } from "../../../src/l3/citizen";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import { L3Client } from "../../../src/l3-worker/client";
import {
  type CitizenInit,
  type FromWorker,
  type Port,
  slotsIn,
  type ToWorker,
} from "../../../src/l3-worker/protocol";
import { L3Solver } from "../../../src/l3-worker/solver";
import { stagingBounds, withStagingKerb } from "../../../src/test-street/citizens";
import { buildRushCrowd } from "../../../src/test-street/rush-crowd";
import {
  type LifeSample,
  lifeDialsFor,
  StreetLife,
  standState,
} from "../../../src/test-street/street-life";
import { Timetable } from "../../../src/test-street/timetable";
import { bodyZoneOf } from "../../../src/world/body-zone";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { WalkFeed } from "../../../src/world/walk-mirror";
import { l3Config } from "../l3/defs-config";
import { committedDefs, streetWorldIndex } from "../test-street/street-world";

const cfg = l3Config();
const defs = committedDefs();
const path = pathConfigOf(cfg);
const crowd = buildRushCrowd(defs);
const gait = { strideCells: cfg.strideCells, framesPerCycle: walkFramesPerCycle(defs, "adult") };
const life = lifeDialsFor(defs, cfg, "adult");
const SMALL = crowd.fixtures.slice(0, 60);

/** A loopback: messages are structured-cloned (buffers transferred) and
 * delivered synchronously, or held until `flush`. */
function loopback(hold = false) {
  let solver: L3Solver | undefined;
  const toWorker: ToWorker[] = [];
  const toMain: { message: FromWorker; transfer: Transferable[] }[] = [];
  const queue: { message: ToWorker; transfer: Transferable[] }[] = [];
  const main: Port<FromWorker, ToWorker> = {
    onmessage: null,
    postMessage(message, transfer = []) {
      queue.push({ message: structuredClone(message, { transfer }), transfer });
      if (!hold) flush();
    },
  };
  function deliverToMain(): void {
    for (const { message } of toMain.splice(0)) main.onmessage?.({ data: message });
  }
  function flush(): void {
    for (const { message } of queue.splice(0)) {
      toWorker.push(message);
      solver?.handle(message);
    }
    if (!hold) deliverToMain();
  }
  let clock = 0;
  solver = new L3Solver({
    post: (message, transfer = []) => {
      toMain.push({ message: structuredClone(message, { transfer }), transfer });
    },
    now: () => (clock += 0.25),
  });
  return { port: main, flush, deliverToMain, toWorker, solver };
}

function initsOf(walk: ReturnType<typeof withStagingKerb>, fixtures = SMALL): CitizenInit[] {
  return fixtures.map((f) => {
    const spec = crowd.specs[f.id];
    return {
      id: f.id,
      spec,
      walkMilli: spec ? new Timetable(spec, cfg, walk, path).walkMilli : undefined,
      stand: spec
        ? undefined
        : standState({ x: Math.floor(f.gridX), y: Math.floor(f.gridY) }, 0, f.facing as never),
      standAt: spec ? undefined : { x: f.gridX, y: f.gridY },
      look: f.id,
      life,
      gait,
    };
  });
}

function street() {
  const index = streetWorldIndex();
  const walk = withStagingKerb(npcWalkability(index));
  const b = stagingBounds();
  const feed = new WalkFeed(walk, index, [{ x0: b.x0, y0: b.y1, x1: b.x1, y1: b.y1, floor: 0 }]);
  return { walk, feed };
}

function inProcess(walk: ReturnType<typeof withStagingKerb>, inits: readonly CitizenInit[]) {
  const s = new StreetLife(cfg, walk);
  const make = (c: CitizenInit) => () => ({
    timetable: c.spec ? new Timetable(c.spec, cfg, walk, path, c.walkMilli) : undefined,
    body: new CitizenBody(walk, path, gait, c.id, life),
  });
  const members = inits.map((c) =>
    s.add({
      id: c.id,
      ...make(c)(),
      stand: c.stand,
      standAt: c.standAt,
      look: c.look,
      remake: make(c),
    }),
  );
  return { s, members };
}

function connected(hold = false, inits?: readonly CitizenInit[]) {
  const { walk, feed } = street();
  const lb = loopback(hold);
  const client = new L3Client(lb.port, 0);
  const list = inits ?? initsOf(walk);
  client.init(cfg);
  client.declare(list);
  client.feedWalk(feed.collect());
  return { walk, lb, client, list };
}

describe("the L3 worker protocol", () => {
  it("draws the same body states as the in-process solve, at every instant", () => {
    const { walk, client, list } = connected();
    const reference = inProcess(walk, list);
    const members = list.map((c) => client.add(c.id));
    const step = 1000 / 60 / (cfg.realMsPerCityMinute / 1000);
    const frames = 40;
    const mismatches: string[] = [];
    let compared = 0;
    for (let k = 0; k < frames; k++) {
      const t = 40_000 + k * step * 25;
      client.request(t, undefined);
      expect(client.apply()).toBe(true);
      reference.s.solve(t);
      members.forEach((m, i) => {
        const r = reference.members[i];
        if (!r) throw new Error("no reference member");
        const got = [
          m.solved,
          m.frame.x,
          m.frame.y,
          m.frame.animation,
          m.frame.direction,
          m.frame.frameIndex,
          m.frame.flavour,
          m.frame.moving,
          m.offsetX,
          m.offsetY,
        ];
        const want = [
          true,
          r.frame.x,
          r.frame.y,
          r.frame.animation,
          r.frame.direction,
          r.frame.frameIndex,
          r.frame.flavour,
          r.frame.moving,
          reference.s.offsetX(r),
          reference.s.offsetY(r),
        ];
        if (got.some((v, n) => !Object.is(v, want[n]))) mismatches.push(`${m.id}@${k}`);
        compared++;
      });
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBe(frames * list.length);
    expect(client.stats.stale).toBe(0);
  });

  it("answers agreement and live queries as the in-process solve does", async () => {
    const { walk, client, list, lb } = connected(true);
    const reference = inProcess(walk, list);
    const t = 52_345;
    const agreement = client.agreementAt(t);
    lb.flush();
    lb.deliverToMain();
    const fromWorker = await agreement;
    const strip = (xs: readonly LifeSample[]) => xs.map((s) => ({ ...s }));
    expect(strip(fromWorker)).toEqual(strip(reference.s.agreementAt(t)));

    for (const c of list) client.add(c.id);
    lb.flush();
    const live = client.liveAt(t);
    lb.flush();
    lb.deliverToMain();
    expect(strip(await live)).toEqual(strip(reference.s.liveAt(t)));
  });

  it("transfers its buffers: the sent one is detached, the returned one is whole", () => {
    const lb = loopback(true);
    const sentBuffers: ArrayBuffer[] = [];
    const post = lb.port.postMessage.bind(lb.port);
    lb.port.postMessage = (message, transfer) => {
      if (message.type === "tick") sentBuffers.push(message.buf);
      post(message, transfer);
    };
    const { walk } = street();
    const client = new L3Client(lb.port, 0);
    const list = initsOf(walk);
    client.init(cfg);
    client.declare(list);
    for (const c of list) client.add(c.id);
    client.request(1000, undefined);
    expect(sentBuffers).toHaveLength(1);
    expect(sentBuffers[0]?.byteLength).toBe(0);
    lb.flush();
    lb.deliverToMain();
    expect(client.apply()).toBe(true);
    expect(client.request(1100, undefined)).toBe(true);
    expect(sentBuffers[1]?.byteLength).toBe(0);
  });

  it("never blocks: with every buffer out the request is skipped and counted", () => {
    const { client, lb, list } = connected(true);
    for (const c of list) client.add(c.id);
    for (let i = 0; i < 4; i++) expect(client.request(i, undefined)).toBe(true);
    expect(client.request(5, undefined)).toBe(false);
    expect(client.stats.skipped).toBe(1);
    lb.flush();
    lb.deliverToMain();
    expect(client.apply()).toBe(true);
    expect(client.request(6, undefined)).toBe(true);
  });

  it("counts a frame that draws with a request in flight as stale, after the first result", () => {
    const { client, lb, list } = connected(true);
    for (const c of list) client.add(c.id);
    // Before any result has landed the pipeline is warming, not stale.
    client.request(1, undefined);
    expect(client.apply()).toBe(false);
    expect(client.stats.stale).toBe(0);
    lb.flush();
    lb.deliverToMain();
    expect(client.apply()).toBe(true);
    client.request(2, undefined);
    expect(client.apply()).toBe(false);
    expect(client.stats.stale).toBe(1);
    lb.flush();
    lb.deliverToMain();
    expect(client.apply()).toBe(true);
    expect(client.apply()).toBe(false);
    // Nothing in flight, nothing stale.
    expect(client.stats.stale).toBe(1);
  });

  it("applies the latest of two results that arrive between frames and recycles the older", () => {
    const { client, lb, list } = connected(true);
    const members = list.map((c) => client.add(c.id));
    client.request(10_000, undefined);
    client.request(10_500, undefined);
    lb.flush();
    lb.deliverToMain();
    expect(client.apply()).toBe(true);
    expect(members.every((m) => m.solved)).toBe(true);
    expect(client.apply()).toBe(false);
    // Both buffers are back in the pool.
    expect(client.request(11_000, undefined)).toBe(true);
    expect(client.request(11_500, undefined)).toBe(true);
  });

  it("leaves a removed body's slot empty and reuses it", () => {
    const { client, lb, list } = connected();
    const a = client.add(list[0]?.id as string);
    client.request(2_000, undefined);
    client.apply();
    expect(a.solved).toBe(true);
    client.remove(a);
    const b = client.add(list[1]?.id as string);
    expect(b.slot).toBe(a.slot);
    client.request(2_100, undefined);
    client.apply();
    expect(b.solved).toBe(true);
    expect(lb.toWorker.filter((m) => m.type === "remove")).toHaveLength(1);
  });

  it("grows its buffers with the street instead of dropping bodies", () => {
    const sent: ToWorker[] = [];
    const port: Port<FromWorker, ToWorker> = {
      onmessage: null,
      postMessage: (m) => void sent.push(m),
    };
    const client = new L3Client(port, 0);
    for (let i = 0; i < 600; i++) client.add(`c${i}`);
    client.request(1, undefined);
    const tick = sent.find((m) => m.type === "tick");
    if (tick?.type !== "tick") throw new Error("no tick sent");
    expect(slotsIn(tick.buf.byteLength / 8)).toBeGreaterThanOrEqual(600);
  });

  it("carries the body zone: a body outside it walks its ledger line", () => {
    const { walk, client, list, lb } = connected();
    const reference = inProcess(walk, list);
    const members = list.map((c) => client.add(c.id));
    const zone = bodyZoneOf({ x0: 0, y0: 0, x1: 20, y1: 20 }, 0, 0, 2);
    const t = 60_000;
    client.request(t, zone);
    client.apply();
    reference.s.solve(t, zone);
    members.forEach((m, i) => {
      const r = reference.members[i];
      if (!r) throw new Error("no reference member");
      expect(m.offsetX).toBe(reference.s.offsetX(r));
      expect(m.offsetY).toBe(reference.s.offsetY(r));
    });
    expect(lb.toWorker.some((m) => m.type === "tick")).toBe(true);
  });

  it("times the solve inside the worker and reports it with the result", () => {
    const { client, list } = connected();
    for (const c of list) client.add(c.id);
    client.request(5_000, undefined);
    client.apply();
    // The loopback clock advances 0.25 ms a reading.
    expect(client.stats.lastSolveMs).toBeCloseTo(0.25, 5);
  });

  it("runs the calibration workload inside the worker", async () => {
    const { client, lb } = connected(true);
    const ms = client.calibrate(1);
    lb.flush();
    lb.deliverToMain();
    expect(await ms).toBeGreaterThan(0);
  });

  it("with a lookahead, draws each result on the frame it was solved for", () => {
    const lb = loopback();
    const { walk } = street();
    const client = new L3Client(lb.port, 2);
    const list = initsOf(walk);
    client.init(cfg);
    client.declare(list);
    const members = list.map((c) => client.add(c.id));
    const frames: number[] = [];
    for (let k = 0; k < 8; k++) {
      const drew = client.apply();
      if (drew) frames.push(members[0]?.frame.x ?? Number.NaN);
      client.request(30_000 + (k + 2) * 10, undefined);
    }
    // Nothing is due on the first two frames; every later one draws.
    expect(frames).toHaveLength(6);
    expect(client.stats.stale).toBe(0);
    expect(client.stats.maxLagFrames).toBe(0);
  });

  it("counts the frame whose result is late as stale, then skips to the newest due result", () => {
    const lb = loopback(true);
    const { walk } = street();
    const client = new L3Client(lb.port, 1);
    const list = initsOf(walk);
    client.init(cfg);
    client.declare(list);
    for (const c of list) client.add(c.id);
    const step = (k: number, deliver: boolean): boolean => {
      const drew = client.apply();
      client.request(10_000 + k, undefined);
      if (deliver) {
        lb.flush();
        lb.deliverToMain();
      }
      return drew;
    };
    expect(step(0, true)).toBe(false);
    expect(step(1, true)).toBe(true);
    // The worker is late for frame 2: held back across one frame.
    expect(step(2, false)).toBe(true);
    expect(step(3, false)).toBe(false);
    expect(client.stats.stale).toBe(1);
    lb.flush();
    lb.deliverToMain();
    expect(client.apply()).toBe(true);
    // The late result and the one after it land together: the newer is due now.
    expect(client.stats.maxLagFrames).toBe(0);
  });

  it("answers many instants in one round trip, as one by one", async () => {
    const { walk, client, list, lb } = connected(true);
    const reference = inProcess(walk, list);
    for (const c of list) client.add(c.id);
    lb.flush();
    const ts = [10_000, 10_500, 31_000];
    const strip = (xs: readonly LifeSample[]) => xs.map((s) => ({ ...s }));
    const agreement = client.agreementAtMany(ts);
    const live = client.liveAtMany(ts);
    lb.flush();
    lb.deliverToMain();
    const [a, l] = [await agreement, await live];
    expect(a).toHaveLength(3);
    expect(lb.toWorker.filter((m) => m.type === "queryMany")).toHaveLength(2);
    ts.forEach((t, i) => {
      expect(strip(a[i] ?? [])).toEqual(strip(reference.s.agreementAt(t)));
      expect(strip(l[i] ?? [])).toEqual(strip(reference.s.liveAt(t)));
    });
  });
});
