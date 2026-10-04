// Story 4.8: the supervisor, driven with fake timers, a fake event target
// and a fake connection.
import { describe, expect, it } from "vitest";
import type { ConnectionStatus } from "../../../src/net/connection-status";
import { startSupervisor, type WakeTarget } from "../../../src/net/reconnect";
import { BACKOFF, CONNECT_TIMEOUT_MS, PROBE_TIMEOUT_MS } from "../../../src/net/reconnect-policy";

class FakeTarget implements WakeTarget {
  visibilityState = "visible";
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  count() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

interface FakeConn {
  readonly id: number;
  readonly report: (s: ConnectionStatus) => void;
  closed: boolean;
  closes: number;
  socketClosed: boolean;
  probeResult: "answer" | "silent" | "reject";
}

function rig(random = () => 0.5) {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  const statuses: ConnectionStatus[] = [];
  const conns: FakeConn[] = [];
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextTimer = 1;
  const sup = startSupervisor<FakeConn>({
    open: (_gen, report) => {
      const c: FakeConn = {
        id: conns.length,
        report,
        closed: false,
        closes: 0,
        socketClosed: false,
        probeResult: "answer",
      };
      conns.push(c);
      report("connecting");
      return c;
    },
    probe: (c) =>
      c.probeResult === "answer"
        ? Promise.resolve()
        : c.probeResult === "reject"
          ? Promise.reject(new Error("dead"))
          : new Promise(() => {}),
    isClosed: (c) => c.socketClosed,
    close: (c) => {
      c.closed = true;
      c.closes += 1;
    },
    onStatus: (s) => statuses.push(s),
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    random,
    window: win,
    document: doc,
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const last = () => conns[conns.length - 1] as FakeConn;
  return { sup, win, doc, statuses, conns, timers, advance, flush, last };
}

describe("reconnect supervisor", () => {
  it("reports connecting then connected on a first success", () => {
    const r = rig();
    r.last().report("connected");
    expect(r.statuses).toEqual(["connecting", "connected"]);
    expect(r.sup.liveCount()).toBe(1);
  });

  it("after a drop, reports disconnected once and retries silently at the backoff", () => {
    const r = rig(() => 0.5);
    r.last().report("connected");
    r.last().report("disconnected");
    expect(r.statuses).toEqual(["connecting", "connected", "disconnected"]);
    expect(r.conns).toHaveLength(1);
    r.advance(BACKOFF.baseMs * 0.5);
    expect(r.conns).toHaveLength(2);
    r.last().report("connecting");
    r.last().report("disconnected"); // that attempt failed
    r.advance(BACKOFF.baseMs);
    expect(r.conns).toHaveLength(3);
    r.last().report("connected");
    expect(r.statuses).toEqual(["connecting", "connected", "disconnected", "connected"]);
  });

  it("a boot failure keeps retrying and never gives up", () => {
    const r = rig(() => 0.999);
    for (let i = 0; i < 12; i++) {
      r.last().report("disconnected");
      r.advance(BACKOFF.capMs);
    }
    // At least one attempt per round; a hung one is failed by its deadline too.
    expect(r.conns.length).toBeGreaterThanOrEqual(13);
    expect(r.statuses).toEqual(["connecting", "disconnected"]);
  });

  it.each([
    ["window", "online"],
    ["window", "pageshow"],
    ["window", "focus"],
    ["document", "visibilitychange"],
  ] as const)("%s %s while waiting cancels the timer and attempts at once", (who, type) => {
    const r = rig();
    r.last().report("connected");
    r.last().report("disconnected");
    expect(r.timers.size).toBe(1);
    (who === "window" ? r.win : r.doc).fire(type);
    expect(r.conns).toHaveLength(2);
    // Only the new attempt's deadline is pending; the backoff wait is gone.
    expect(r.timers.size).toBe(1);
  });

  describe("a connect attempt has a deadline", () => {
    it("an attempt that never reports is failed at the deadline and retried on the backoff", () => {
      const r = rig(() => 0.5);
      r.advance(CONNECT_TIMEOUT_MS - 1);
      expect(r.conns[0]?.closed).toBe(false);
      expect(r.statuses).toEqual(["connecting"]);
      r.advance(1);
      expect(r.conns[0]?.closed).toBe(true);
      expect(r.statuses).toEqual(["connecting", "disconnected"]);
      expect(r.conns).toHaveLength(1);
      r.advance(BACKOFF.baseMs);
      expect(r.conns).toHaveLength(2);
    });

    it("a late connected from the timed-out attempt is ignored", () => {
      const r = rig();
      const hung = r.last();
      r.advance(CONNECT_TIMEOUT_MS);
      hung.report("connected");
      expect(r.statuses).toEqual(["connecting", "disconnected"]);
      r.win.fire("focus");
      r.last().report("connected");
      expect(r.statuses.at(-1)).toBe("connected");
      expect(r.conns).toHaveLength(2);
    });

    it("a burst of wakes during a hung attempt makes no second attempt before the deadline", () => {
      const r = rig();
      r.win.fire("online");
      r.win.fire("focus");
      r.doc.fire("visibilitychange");
      r.advance(CONNECT_TIMEOUT_MS - 1);
      r.win.fire("pageshow");
      expect(r.conns).toHaveLength(1);
    });

    it("a connected attempt cancels its deadline", () => {
      const r = rig();
      r.last().report("connected");
      r.advance(CONNECT_TIMEOUT_MS * 3);
      expect(r.conns[0]?.closed).toBe(false);
      expect(r.statuses).toEqual(["connecting", "connected"]);
    });
  });

  it("ignores visibilitychange to hidden", () => {
    const r = rig();
    r.last().report("connected");
    r.last().report("disconnected");
    r.doc.visibilityState = "hidden";
    r.doc.fire("visibilitychange");
    expect(r.conns).toHaveLength(1);
  });

  it("single flight: a lid-open burst of all four events makes exactly one attempt", () => {
    const r = rig();
    r.last().report("connected");
    r.last().report("disconnected");
    r.doc.fire("visibilitychange");
    r.win.fire("focus");
    r.win.fire("online");
    r.win.fire("pageshow");
    expect(r.conns).toHaveLength(2);
  });

  it("makes no attempt on a wake while connected and answering", async () => {
    const r = rig();
    r.last().report("connected");
    r.win.fire("focus");
    await r.flush();
    expect(r.conns).toHaveLength(1);
    expect(r.last().closed).toBe(false);
  });

  it("rebuilds a connection whose socket is already closed", () => {
    const r = rig();
    r.last().report("connected");
    r.last().socketClosed = true;
    r.win.fire("focus");
    expect(r.statuses.at(-1)).toBe("disconnected");
    expect(r.conns[0]?.closed).toBe(true);
    r.win.fire("focus");
    expect(r.conns).toHaveLength(2);
  });

  it("rebuilds a connection that stays silent past the probe timeout, once", () => {
    const r = rig();
    r.last().report("connected");
    r.last().probeResult = "silent";
    r.win.fire("focus");
    r.win.fire("online"); // a second probe is not started
    r.advance(PROBE_TIMEOUT_MS - 1);
    expect(r.conns[0]?.closed).toBe(false);
    r.advance(1);
    expect(r.conns[0]?.closed).toBe(true);
    expect(r.statuses.at(-1)).toBe("disconnected");
  });

  it("rebuilds a connection whose probe is rejected", async () => {
    const r = rig();
    r.last().report("connected");
    r.last().probeResult = "reject";
    r.win.fire("focus");
    await r.flush();
    expect(r.conns[0]?.closed).toBe(true);
    expect(r.statuses.at(-1)).toBe("disconnected");
  });

  it("a probe answered after the connection already dropped changes nothing", async () => {
    const r = rig();
    r.last().report("connected");
    r.win.fire("focus");
    r.last().report("disconnected");
    await r.flush();
    expect(r.conns).toHaveLength(1);
    expect(r.statuses.at(-1)).toBe("disconnected");
  });

  it("ignores every report from a superseded connection", () => {
    const r = rig();
    r.last().report("connected");
    const old = r.last();
    old.report("disconnected");
    r.win.fire("focus");
    const fresh = r.last();
    fresh.report("connected");
    const before = [...r.statuses];
    old.report("disconnected");
    old.report("connected");
    old.report("updating");
    expect(r.statuses).toEqual(before);
    expect(r.sup.current()).toBe(fresh);
  });

  it("passes a terminal status such as updating straight through", () => {
    const r = rig();
    r.last().report("updating");
    expect(r.statuses.at(-1)).toBe("updating");
  });

  it("closes a connection that failed, and a dropped one, exactly once", () => {
    const r = rig();
    r.last().report("connected");
    r.last().report("disconnected");
    r.last().report("disconnected");
    r.win.fire("focus");
    expect(r.conns[0]?.closes).toBe(1);
  });

  it("50 drop/reconnect cycles leak nothing", () => {
    const r = rig();
    const afterFirst = r.win.count() + r.doc.count();
    for (let i = 0; i < 50; i++) {
      r.last().report("connected");
      r.last().report("disconnected");
      r.win.fire("focus");
    }
    r.last().report("connected");
    expect(r.win.count() + r.doc.count()).toBe(afterFirst);
    expect(r.sup.liveCount()).toBe(1);
    expect(r.conns.filter((c) => !c.closed)).toHaveLength(1);
    expect(r.timers.size).toBe(0);
    r.sup.stop();
    expect(r.win.count() + r.doc.count()).toBe(0);
    expect(r.conns.filter((c) => !c.closed)).toHaveLength(0);
    r.sup.wake();
    expect(r.conns).toHaveLength(51);
  });

  it("treats an open() that throws as a failed attempt and retries", () => {
    let throwNext = true;
    const timers: Array<() => void> = [];
    const statuses: ConnectionStatus[] = [];
    const errors = console.error;
    console.error = () => {};
    try {
      startSupervisor<object>({
        open: (_g, report) => {
          report("connecting");
          if (throwNext) {
            throwNext = false;
            throw new Error("boom");
          }
          return {};
        },
        probe: () => Promise.resolve(),
        isClosed: () => false,
        close: () => {
          throw new Error("close failed");
        },
        onStatus: (s) => statuses.push(s),
        setTimer: (fn) => timers.push(fn),
        clearTimer: () => {},
        random: () => 0,
        window: new FakeTarget(),
        document: new FakeTarget(),
      });
    } finally {
      console.error = errors;
    }
    expect(statuses).toEqual(["connecting", "disconnected"]);
    expect(timers).toHaveLength(1);
  });
});
