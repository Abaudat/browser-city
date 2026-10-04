// Story 4.8: the sender stops on leaving `connected`, restarts on the next
// one, and its first send is the scene's position -- never the spawn, never
// a call on a dead connection. Real sender and scheduler, fake connection.
import { describe, expect, it } from "vitest";
import { startPositionSender } from "../../../src/net/position-sender";
import { createSenderLifecycle } from "../../../src/net/sender-lifecycle";

function rig() {
  const sent: Array<{ via: number; x: number }> = [];
  let live = 0;
  let generation = 0;
  let position = { x: 1, y: 1, floor: 0 };
  let now = 0;
  const ticks = new Map<number, () => void>();
  let handle = 0;
  const lifecycle = createSenderLifecycle(() => {
    const via = ++generation;
    live = via;
    return startPositionSender({
      conn: () => ({
        reducers: {
          setPlayerPosition: (p) => {
            // A call on a connection that is not the live one is the bug.
            if (via !== live) throw new Error("send on a dead connection");
            sent.push({ via, x: p.x });
            return Promise.resolve();
          },
        },
      }),
      position: () => position,
      periodMs: 100,
      unitsPerCell: 256,
      now: () => now,
      setInterval: (fn) => {
        ticks.set(++handle, fn);
        return handle;
      },
      clearInterval: (h) => {
        ticks.delete(h as number);
      },
    });
  });
  const advance = (ms: number) => {
    now += ms;
    for (const fn of [...ticks.values()]) fn();
  };
  return {
    lifecycle,
    sent,
    advance,
    timers: () => ticks.size,
    move: (x: number) => {
      position = { x, y: 1, floor: 0 };
    },
    drop: () => {
      live = 0;
    },
  };
}

describe("sender lifecycle", () => {
  it("does nothing until connected and ready", () => {
    const r = rig();
    r.lifecycle.setReady(true);
    r.advance(100);
    expect(r.sent).toEqual([]);
    r.lifecycle.setConnected(true);
    r.advance(100);
    expect(r.sent).toHaveLength(1);
  });

  it("stops when the connection leaves connected, and sends nothing while away", () => {
    const r = rig();
    r.lifecycle.setReady(true);
    r.lifecycle.setConnected(true);
    r.advance(100);
    r.lifecycle.setConnected(false);
    r.drop();
    r.move(5);
    for (let i = 0; i < 50; i++) r.advance(100);
    expect(r.sent).toHaveLength(1);
    expect(r.timers()).toBe(0);
  });

  it("restarts on the next connected, first sending the scene's current position", () => {
    const r = rig();
    r.lifecycle.setReady(true);
    r.lifecycle.setConnected(true);
    r.advance(100);
    r.lifecycle.setConnected(false);
    r.drop();
    r.move(7);
    r.lifecycle.setConnected(true);
    r.advance(100);
    expect(r.sent.at(-1)).toEqual({ via: 2, x: 7 });
  });

  it("50 cycles leave exactly one timer", () => {
    const r = rig();
    r.lifecycle.setReady(true);
    for (let i = 0; i < 50; i++) {
      r.lifecycle.setConnected(true);
      r.lifecycle.setConnected(true);
      r.lifecycle.setConnected(false);
    }
    r.lifecycle.setConnected(true);
    expect(r.timers()).toBe(1);
  });

  it("a character or scene that goes away stops it", () => {
    const r = rig();
    r.lifecycle.setConnected(true);
    r.lifecycle.setReady(true);
    expect(r.timers()).toBe(1);
    r.lifecycle.setReady(false);
    expect(r.timers()).toBe(0);
  });
});
