import { Timestamp } from "spacetimedb";
import { describe, expect, it, vi } from "vitest";
import { startNetClockSync, type VisibilitySource } from "../../src/net/clock-sync";
import { ServerClock } from "../../src/time/server-clock";

function fakeDoc(): VisibilitySource & { fire(): void; listeners: number } {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "hidden",
    addEventListener: (_t: "visibilitychange", l: () => void) => listeners.add(l),
    removeEventListener: (_t: "visibilitychange", l: () => void) => listeners.delete(l),
    fire: () => {
      for (const l of listeners) l();
    },
    get listeners() {
      return listeners.size;
    },
  };
  return doc;
}

describe("startNetClockSync", () => {
  it("turns the procedure's server timestamp into a skew sample", async () => {
    const serverClock = new ServerClock(() => performance.now());
    const syncClock = vi.fn(async () => Timestamp.fromDate(new Date(9_000)));
    const sync = startNetClockSync({ procedures: { syncClock } } as never, serverClock, fakeDoc());
    await sync.syncNow();
    expect(syncClock).toHaveBeenCalledWith({});
    const now = serverClock.nowMicros() as bigint;
    expect(now).toBeGreaterThanOrEqual(9_000_000n);
    expect(now).toBeLessThan(9_000_000n + 1_000_000n);
    sync.stop();
  });

  it("re-samples only when the tab becomes visible, and unhooks on stop", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = fakeDoc() as ReturnType<typeof fakeDoc> & { visibilityState: string };
    const syncClock = vi.fn(async () => Timestamp.fromDate(new Date(1)));
    const sync = startNetClockSync(
      { procedures: { syncClock } } as never,
      new ServerClock(() => performance.now()),
      doc,
    );
    await sync.syncNow();
    const before = syncClock.mock.calls.length;
    doc.fire();
    expect(syncClock.mock.calls.length).toBe(before);
    doc.visibilityState = "visible";
    doc.fire();
    expect(syncClock.mock.calls.length).toBe(before + 1);
    sync.stop();
    expect(doc.listeners).toBe(0);
  });
});
