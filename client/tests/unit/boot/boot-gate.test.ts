// Story 2.8 (FR147): the boot gate (connect, get the version, maybe
// refresh, then start rendering) with the network, fetch and renderer
// all faked (Quentin's direction) -- asserting the *order* of calls, not
// merely the final outcome, is the whole point: the ticker/first render
// must never start before the verdict, and on `refetch-defs` it only
// starts after the fresh defs have loaded.
import { describe, expect, it, vi } from "vitest";
import { type BootGateDeps, runBootGate } from "../../../src/boot/boot-gate";
import type { HandshakeVersion } from "../../../src/boot/handshake";
import { createHandshakeLatch, type HandshakeLatch } from "../../../src/boot/handshake-latch";
import { DefsVersionMismatchError } from "../../../src/defs/load";
import type { Defs } from "../../../src/defs/types";

function defs(defsVersion: string): Defs {
  return { defsVersion } as unknown as Defs;
}

function baseDeps(overrides: Partial<BootGateDeps> & { handshake: HandshakeLatch }): BootGateDeps {
  return {
    fetchDefs: vi.fn(async () => defs("d1")),
    defsPath: "/defs/defs.json",
    clientProtocolVersion: "p1",
    readReloadedFor: () => undefined,
    writeReloadedFor: vi.fn(),
    reload: vi.fn(),
    onDegrade: vi.fn(),
    ...overrides,
  };
}

describe("runBootGate", () => {
  it("proceed: fetches defs, waits for the handshake, and returns the fetched defs -- no second fetch", async () => {
    const log: string[] = [];
    const latch = createHandshakeLatch();
    const fetchDefs = vi.fn(async (path: string, expected?: string) => {
      log.push(`fetch(${path},${expected ?? ""})`);
      return defs("d1");
    });
    const deps = baseDeps({ fetchDefs, handshake: latch });

    const promise = runBootGate(deps);
    // fetchDefs's own await must resolve before the gate even looks at
    // the handshake -- give it a tick, then settle.
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });

    const result = await promise;
    expect(log).toEqual(["fetch(/defs/defs.json,)"]);
    expect(result?.defs.defsVersion).toBe("d1");
    expect(fetchDefs).toHaveBeenCalledTimes(1);
  });

  it("order: never resolves before the handshake settles, even though fetchDefs already resolved", async () => {
    const latch = createHandshakeLatch();
    const deps = baseDeps({ handshake: latch });

    let resolved = false;
    const promise = runBootGate(deps).then((r) => {
      resolved = true;
      return r;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    latch.resolveHandshake({ defsVersion: "d1", protocolVersion: "p1" });
    await promise;
    expect(resolved).toBe(true);
  });

  it("unreachable: the connection never resolved an answer -- mounts with the already-fetched defs, no second fetch, no reload, no degrade", async () => {
    const latch = createHandshakeLatch();
    const fetchDefs = vi.fn(async () => defs("d1"));
    const reload = vi.fn();
    const onDegrade = vi.fn();
    const deps = baseDeps({ fetchDefs, reload, onDegrade, handshake: latch });

    const promise = runBootGate(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveUnreachable();

    const result = await promise;
    expect(result?.defs.defsVersion).toBe("d1");
    expect(fetchDefs).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(onDegrade).not.toHaveBeenCalled();
  });

  it("refetch-defs: only defs_version differs -- refetches cache-busted with the server's version, and mounts with the fresh defs", async () => {
    const latch = createHandshakeLatch();
    const fetchDefs = vi.fn().mockResolvedValueOnce(defs("d1")).mockResolvedValueOnce(defs("d2"));
    const deps = baseDeps({ fetchDefs, handshake: latch });

    const promise = runBootGate(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake({ defsVersion: "d2", protocolVersion: "p1" });

    const result = await promise;
    expect(result?.defs.defsVersion).toBe("d2");
    expect(fetchDefs).toHaveBeenNthCalledWith(1, "/defs/defs.json");
    expect(fetchDefs).toHaveBeenNthCalledWith(2, "/defs/defs.json", "d2");
  });

  it("refetch-defs loop guard: still stale after a bounded number of attempts degrades rather than looping forever (NFR42)", async () => {
    const latch = createHandshakeLatch();
    const fetchDefs = vi
      .fn()
      .mockResolvedValueOnce(defs("d1"))
      .mockRejectedValue(new DefsVersionMismatchError("d2", "d1"));
    const onDegrade = vi.fn();
    const reload = vi.fn();
    const deps = baseDeps({
      fetchDefs,
      onDegrade,
      reload,
      handshake: latch,
      maxRefetchAttempts: 3,
    });

    const promise = runBootGate(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake({ defsVersion: "d2", protocolVersion: "p1" });

    const result = await promise;
    expect(result).toBeUndefined();
    expect(onDegrade).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    // One initial fetch, then exactly `maxRefetchAttempts` refetches -- not
    // an unbounded retry storm.
    expect(fetchDefs).toHaveBeenCalledTimes(1 + 3);
  });

  it("refetch-defs: a non-version-mismatch failure (network/parse) escalates to a guarded reload", async () => {
    const latch = createHandshakeLatch();
    const fetchDefs = vi
      .fn()
      .mockResolvedValueOnce(defs("d1"))
      .mockRejectedValueOnce(new Error("network error"));
    const reload = vi.fn();
    const writeReloadedFor = vi.fn();
    const deps = baseDeps({ fetchDefs, reload, writeReloadedFor, handshake: latch });

    const promise = runBootGate(deps);
    await Promise.resolve();
    await Promise.resolve();
    const server: HandshakeVersion = { defsVersion: "d2", protocolVersion: "p1" };
    latch.resolveHandshake(server);

    const result = await promise;
    expect(result).toBeUndefined();
    expect(writeReloadedFor).toHaveBeenCalledWith(server);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reload: protocol_version differs and no prior reload was recorded -- writes the guard, then reloads", async () => {
    const latch = createHandshakeLatch();
    const reload = vi.fn();
    const writeReloadedFor = vi.fn();
    const onDegrade = vi.fn();
    const deps = baseDeps({ reload, writeReloadedFor, onDegrade, handshake: latch });

    const promise = runBootGate(deps);
    await Promise.resolve();
    await Promise.resolve();
    const server: HandshakeVersion = { defsVersion: "d1", protocolVersion: "p2" };
    latch.resolveHandshake(server);

    const result = await promise;
    expect(result).toBeUndefined();
    expect(writeReloadedFor).toHaveBeenCalledWith(server);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onDegrade).not.toHaveBeenCalled();
  });

  it("updating: protocol_version differs but this exact server version was already reloaded for -- degrades, never reload-loops", async () => {
    const latch = createHandshakeLatch();
    const reload = vi.fn();
    const onDegrade = vi.fn();
    const server: HandshakeVersion = { defsVersion: "d1", protocolVersion: "p2" };
    const deps = baseDeps({ reload, onDegrade, readReloadedFor: () => server, handshake: latch });

    const promise = runBootGate(deps);
    await Promise.resolve();
    await Promise.resolve();
    latch.resolveHandshake(server);

    const result = await promise;
    expect(result).toBeUndefined();
    expect(onDegrade).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
