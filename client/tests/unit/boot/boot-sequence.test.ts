// Story 2.8 (FR147), cycle 2 review (Quentin's finding 1): the gap
// between the boot gate settling and `main.ts` wiring up
// `post-mount-guard.ts` is not zero -- `Application.init()`'s own await
// alone is real async time, and a handshake landing during one of
// `runBootGate`'s own internal awaits (the first `fetchDefs`, or a
// refetch) was silently dropped, since `HandshakeLatch.settled()` only
// ever reports the *first* settlement. `runBootSequence` closes it: it
// builds the post-mount guard immediately once the gate resolves and
// replays `handshake.latest()` -- the most recent version ever seen,
// regardless of settlement -- through it once, synchronously, before
// returning anything to mount.
//
// Cycle 3 review (Quentin's and Tim's converging findings): that first
// replay closed the gap up to the gate resolving, but `Application.
// init()`'s own await (a WebGPU adapter/device request) is *itself* real
// async time between the first replay and `main.ts` ever being able to
// wire the guard for real -- and at that point there may be no renderer,
// so `stopDrawing()` calling into Pixi state can throw. `runBootSequence`
// now awaits the caller's own `appInitPromise` after the first replay
// and runs a *second* replay once it resolves (by which point a renderer
// always exists), and a throwing `stopDrawing` must never prevent the
// reload/degrade that follows either way (`post-mount-guard.ts`'s own
// try/catch).
import { describe, expect, it, vi } from "vitest";
import { type BootSequenceDeps, runBootSequence } from "../../../src/boot/boot-sequence";
import { createHandshakeLatch } from "../../../src/boot/handshake-latch";
import { DefsVersionMismatchError } from "../../../src/defs/load";
import type { Defs } from "../../../src/defs/types";

function defs(defsVersion: string): Defs {
  return { defsVersion } as unknown as Defs;
}

/** Flushes `n` microtask ticks -- used where a test must be certain a
 * chained sequence of `await`s (`settled()` -> `settleWithTimeout`'s own
 * wrapping -> `runBootGate` returning -> `runBootSequence`'s own first
 * replay) has fully unwound before delivering the next event, rather
 * than guessing an exact tick count. */
async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function baseDeps(
  overrides: Partial<BootSequenceDeps> & Pick<BootSequenceDeps, "handshake">,
): BootSequenceDeps {
  return {
    fetchDefs: vi.fn(async () => defs("d1")),
    defsPath: "/defs/defs.json",
    clientProtocolVersion: "p1",
    readReloadedFor: () => undefined,
    writeReloadedFor: vi.fn(() => true),
    reload: vi.fn(),
    onDegrade: vi.fn(),
    stopDrawing: vi.fn(),
    appInitPromise: Promise.resolve(),
    ...overrides,
  };
}

describe("runBootSequence", () => {
  it("the ordinary path: no late handshake -- returns the defs and a working guard", async () => {
    const latch = createHandshakeLatch();
    const deps = baseDeps({ handshake: latch });

    const promise = runBootSequence(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });

    const result = await promise;
    expect(result?.defs.defsVersion).toBe("d1");
    expect(deps.stopDrawing).not.toHaveBeenCalled();

    // The returned guard still works for anything arriving after this.
    expect(result?.guard.onHandshake({ defsVersion: "d2", protocolVersion: "p1" })).toBe(true);
    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
  });

  it("two handshakes arriving before the gate ever reads settled(): latest() reflects the second, which settled() alone could never report", async () => {
    const latch = createHandshakeLatch();
    const fetchDefs = vi.fn(async () => defs("d1"));
    const reload = vi.fn();
    const writeReloadedFor = vi.fn(() => true);
    const deps = baseDeps({ fetchDefs, reload, writeReloadedFor, handshake: latch });

    const promise = runBootSequence(deps);
    // Both delivered before runBootGate's own fetchDefs await resolves --
    // the latch settles on the first (a match, "proceed"), but the
    // second is still recorded as latest().
    latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });
    latch.resolveHandshake({ defsVersion: "d9", protocolVersion: "p1" });

    const result = await promise;

    expect(result).toBeUndefined();
    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
    expect(writeReloadedFor).toHaveBeenCalledWith({ defsVersion: "d9", protocolVersion: "p1" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a version that changes during a refetch (a republish mid-await) is caught by the replay, not silently mounted", async () => {
    const latch = createHandshakeLatch();
    let resolveRefetch: (d: Defs) => void = () => {};
    const refetchPromise = new Promise<Defs>((resolve) => {
      resolveRefetch = resolve;
    });
    const fetchDefs = vi.fn().mockResolvedValueOnce(defs("d1")).mockReturnValueOnce(refetchPromise);
    const reload = vi.fn();
    const writeReloadedFor = vi.fn(() => true);
    const deps = baseDeps({ fetchDefs, reload, writeReloadedFor, handshake: latch });

    const promise = runBootSequence(deps);
    await Promise.resolve();
    await Promise.resolve();
    // Only defs_version differs -> the gate starts a refetch, which calls
    // fetchDefs a second time and awaits the still-pending refetchPromise.
    latch.resolveHandshake({ defsVersion: "d2", protocolVersion: "p1" });

    await Promise.resolve();
    await Promise.resolve();
    // A second republish arrives while the refetch is still in flight --
    // the gate itself never sees this (its verdict is already computed),
    // but latest() does.
    latch.resolveHandshake({ defsVersion: "d3", protocolVersion: "p1" });

    resolveRefetch(defs("d2")); // the refetch itself succeeds, matching what was requested

    const result = await promise;

    expect(result).toBeUndefined();
    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
    expect(writeReloadedFor).toHaveBeenCalledWith({ defsVersion: "d3", protocolVersion: "p1" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("unreachable (e.g. a hung-socket timeout): a version already recorded as latest() by then is still caught, never silently mounted", async () => {
    const fetchDefs = vi.fn(async () => defs("d1"));
    const reload = vi.fn();
    const writeReloadedFor = vi.fn(() => true);
    // A fake handshake source, standing in for the real latch settling
    // "unreachable" (the boot gate's own timeout, or a real connect
    // failure) while a version had already arrived and been recorded as
    // latest() -- exactly Quentin's "handshake arriving shortly after
    // the timeout" case, expressed without depending on exact tick
    // timing.
    const handshake = {
      settled: async () => ({ kind: "unreachable" as const }),
      latest: () => ({ defsVersion: "d9", protocolVersion: "p1" }),
    };
    const deps = baseDeps({ fetchDefs, reload, writeReloadedFor, handshake });

    const result = await runBootSequence(deps);

    expect(result).toBeUndefined();
    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
    expect(writeReloadedFor).toHaveBeenCalledWith({ defsVersion: "d9", protocolVersion: "p1" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a late handshake that actually matches what mounted is a no-op -- the guard is still returned working", async () => {
    const latch = createHandshakeLatch();
    const deps = baseDeps({ handshake: latch });

    const promise = runBootSequence(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });
    // No further republish -- latest() still equals the reference.

    const result = await promise;
    expect(result?.defs.defsVersion).toBe("d1");
    expect(deps.stopDrawing).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("returns undefined, untouched, when the gate itself already handled the outcome (e.g. updating)", async () => {
    const latch = createHandshakeLatch();
    const onDegrade = vi.fn();
    const server = { defsVersion: "d1", protocolVersion: "p2" };
    const deps = baseDeps({ handshake: latch, onDegrade, readReloadedFor: () => server });

    const promise = runBootSequence(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake(server);

    const result = await promise;
    expect(result).toBeUndefined();
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it("propagates a first-fetch error only when the connection is also unreachable, same as runBootGate alone", async () => {
    const latch = createHandshakeLatch();
    const error = new Error("network down");
    const fetchDefs = vi.fn().mockRejectedValueOnce(error);
    const deps = baseDeps({ fetchDefs, handshake: latch });

    const promise = runBootSequence(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveUnreachable();

    await expect(promise).rejects.toThrow("network down");
  });

  it("a still-stale refetch degrades exactly as runBootGate alone does, and the replay finds nothing new", async () => {
    const latch = createHandshakeLatch();
    const fetchDefs = vi
      .fn()
      .mockResolvedValueOnce(defs("d1"))
      .mockRejectedValueOnce(new DefsVersionMismatchError("d2", "d1"));
    const onDegrade = vi.fn();
    const deps = baseDeps({ fetchDefs, onDegrade, handshake: latch });

    const promise = runBootSequence(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake({ defsVersion: "d2", protocolVersion: "p1" });

    const result = await promise;
    expect(result).toBeUndefined();
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  describe("the second replay, after appInitPromise (cycle 3 review)", () => {
    it("a version that changes while Application.init() is still pending is caught -- the scene is never mounted", async () => {
      const latch = createHandshakeLatch();
      const reload = vi.fn();
      const writeReloadedFor = vi.fn(() => true);
      let resolveAppInit: () => void = () => {};
      const appInitPromise = new Promise<void>((resolve) => {
        resolveAppInit = resolve;
      });
      const deps = baseDeps({ reload, writeReloadedFor, handshake: latch, appInitPromise });

      const promise = runBootSequence(deps);
      await flush();
      // The gate settles on a match -- the first replay finds nothing,
      // and moves on to await appInitPromise.
      latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });

      // Enough ticks for the first replay to have already run (and found
      // nothing) before delivering the next version -- appInitPromise
      // itself stays pending until resolveAppInit() below, so there is
      // no risk of racing past the *second* replay too.
      await flush();
      // Application.init() is still pending -- a republish arrives now,
      // in the window the first replay cannot see.
      latch.resolveHandshake({ defsVersion: "d9", protocolVersion: "p1" });

      resolveAppInit();

      const result = await promise;

      expect(result).toBeUndefined();
      expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
      expect(writeReloadedFor).toHaveBeenCalledWith({ defsVersion: "d9", protocolVersion: "p1" });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("a throwing stopDrawing during the second replay still reaches reload/degrade -- NFR42, no renderer yet is not a crash", async () => {
      const latch = createHandshakeLatch();
      const reload = vi.fn();
      const writeReloadedFor = vi.fn(() => true);
      const stopDrawing = vi.fn(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'stop')");
      });
      let resolveAppInit: () => void = () => {};
      const appInitPromise = new Promise<void>((resolve) => {
        resolveAppInit = resolve;
      });
      const deps = baseDeps({
        reload,
        writeReloadedFor,
        stopDrawing,
        handshake: latch,
        appInitPromise,
      });

      const promise = runBootSequence(deps);
      await flush();
      latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });

      await flush();
      latch.resolveHandshake({ defsVersion: "d9", protocolVersion: "p1" });

      resolveAppInit();

      const result = await promise;

      expect(result).toBeUndefined();
      expect(stopDrawing).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("no version change during Application.init() -- the ordinary path still mounts once it resolves", async () => {
      const latch = createHandshakeLatch();
      let resolveAppInit: () => void = () => {};
      const appInitPromise = new Promise<void>((resolve) => {
        resolveAppInit = resolve;
      });
      const deps = baseDeps({ handshake: latch, appInitPromise });

      const promise = runBootSequence(deps);
      await Promise.resolve();
      await Promise.resolve();
      latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });

      resolveAppInit();

      const result = await promise;
      expect(result?.defs.defsVersion).toBe("d1");
      expect(deps.stopDrawing).not.toHaveBeenCalled();
      expect(deps.reload).not.toHaveBeenCalled();
    });
  });
});
