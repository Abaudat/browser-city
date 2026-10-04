// Story 4.4 (FR138): the sender hands the reducer encoded positions at the
// dial's rate, driven by an injected timer and clock -- never the ticker.
import { describe, expect, it } from "vitest";
import { startPositionSender } from "../../../src/net/position-sender";

interface Call {
  x: number;
  y: number;
  floor: number;
  fracX: number;
  fracY: number;
}

function rig(periodMs = 100, unitsPerCell = 256) {
  const calls: Call[] = [];
  let now = 0;
  let tick: (() => void) | undefined;
  let intervalMs = -1;
  let cleared = false;
  let position: { x: number; y: number; floor: number } | undefined;
  const conn = {
    reducers: {
      setPlayerPosition: (c: Call) => {
        calls.push(c);
        return Promise.resolve();
      },
    },
  };
  const sender = startPositionSender({
    conn,
    position: () => position,
    periodMs,
    unitsPerCell,
    now: () => now,
    setInterval: (fn, ms) => {
      tick = fn;
      intervalMs = ms;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  });
  return {
    calls,
    sender,
    set: (p: typeof position) => {
      position = p;
    },
    advance: (ms: number) => {
      now += ms;
      tick?.();
    },
    intervalMs: () => intervalMs,
    cleared: () => cleared,
  };
}

describe("startPositionSender", () => {
  it("polls at half the period, never faster than the dial allows a send", () => {
    const r = rig(100);
    expect(r.intervalMs()).toBe(50);
  });

  it("sends nothing before there is a position, then the encoded position once", () => {
    const r = rig();
    r.advance(50);
    expect(r.calls).toEqual([]);
    r.set({ x: 3.5, y: -0.25, floor: 0 });
    r.advance(50);
    r.advance(50);
    expect(r.calls).toEqual([{ x: 3, y: -1, floor: 0, fracX: 128, fracY: 192 }]);
  });

  it("a standing player costs no further calls, and a move is sent within a period", () => {
    const r = rig();
    r.set({ x: 1, y: 1, floor: 0 });
    for (let i = 0; i < 20; i++) r.advance(50);
    expect(r.calls).toHaveLength(1);
    r.set({ x: 2, y: 1, floor: 0 });
    r.advance(50);
    r.advance(50);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1].x).toBe(2);
  });

  it("no reducer call is made after stop, even from a tick already queued (a dead connection would queue it)", () => {
    const r = rig();
    r.set({ x: 1, y: 1, floor: 0 });
    r.advance(50);
    expect(r.calls).toHaveLength(1);
    r.sender.stop();
    r.set({ x: 9, y: 9, floor: 0 });
    for (let i = 0; i < 20; i++) r.advance(50);
    expect(r.calls).toHaveLength(1);
  });

  it("stop clears the timer", () => {
    const r = rig();
    r.sender.stop();
    expect(r.cleared()).toBe(true);
  });

  it("a refused write is logged, never thrown", async () => {
    const calls: unknown[] = [];
    let tick: (() => void) | undefined;
    startPositionSender({
      conn: {
        reducers: {
          setPlayerPosition: (c) => {
            calls.push(c);
            return Promise.reject(new Error("no character"));
          },
        },
      },
      position: () => ({ x: 0, y: 0, floor: 0 }),
      periodMs: 100,
      unitsPerCell: 256,
      now: () => 0,
      setInterval: (fn) => {
        tick = fn;
        return 1;
      },
      clearInterval: () => {},
    });
    tick?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });
});
