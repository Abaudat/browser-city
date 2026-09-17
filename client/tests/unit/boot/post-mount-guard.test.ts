// Story 2.8 (FR147), cycle 1 review (Quentin finding 1 / Tim finding 3):
// the handshake stays live after the scene mounts -- a tab left open
// across a deploy must not keep silently drawing a definition set (or a
// protocol) it now knows is stale. No live defs swap and no scene
// remount post-mount (Tim's direction): any mismatch goes straight
// through the same guarded-reload decision a protocol mismatch takes at
// boot, after the world has stopped drawing.
import { describe, expect, it, vi } from "vitest";
import { createPostMountGuard, type PostMountGuardDeps } from "../../../src/boot/post-mount-guard";

const REFERENCE = { defsVersion: "d1", protocolVersion: "p1" };

function baseDeps(overrides: Partial<PostMountGuardDeps> = {}): PostMountGuardDeps {
  return {
    referenceVersion: REFERENCE,
    readReloadedFor: () => undefined,
    writeReloadedFor: vi.fn(() => true),
    stopDrawing: vi.fn(),
    reload: vi.fn(),
    onDegrade: vi.fn(),
    ...overrides,
  };
}

describe("createPostMountGuard", () => {
  it("a matching re-insert is a no-op: no stop, no reload, no degrade", () => {
    const deps = baseDeps();
    const guard = createPostMountGuard(deps);

    expect(guard.onHandshake(REFERENCE)).toBe(false);

    expect(deps.stopDrawing).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.onDegrade).not.toHaveBeenCalled();
  });

  it("a differing defs_version stops drawing before reloading -- no live defs swap, no scene remount", () => {
    const calls: string[] = [];
    const deps = baseDeps({
      stopDrawing: () => calls.push("stopDrawing"),
      writeReloadedFor: () => {
        calls.push("writeReloadedFor");
        return true;
      },
      reload: () => calls.push("reload"),
    });
    const guard = createPostMountGuard(deps);

    expect(guard.onHandshake({ defsVersion: "d2", protocolVersion: "p1" })).toBe(true);

    expect(calls).toEqual(["stopDrawing", "writeReloadedFor", "reload"]);
    expect(deps.onDegrade).not.toHaveBeenCalled();
  });

  it("a differing protocol_version also stops drawing, then reloads", () => {
    const calls: string[] = [];
    const deps = baseDeps({
      stopDrawing: () => calls.push("stopDrawing"),
      reload: () => calls.push("reload"),
    });
    const guard = createPostMountGuard(deps);

    guard.onHandshake({ defsVersion: "d1", protocolVersion: "p2" });

    expect(calls).toEqual(["stopDrawing", "reload"]);
  });

  it("a late handshake -- the first one ever, e.g. after an unreachable mount -- is compared too", () => {
    // The reference version is whatever actually rendered (the already-
    // fetched local defs), regardless of which boot-gate path produced
    // it -- this guard does not know or care that the connection was
    // ever unreachable.
    const deps = baseDeps({ referenceVersion: { defsVersion: "d1", protocolVersion: "p1" } });
    const guard = createPostMountGuard(deps);

    guard.onHandshake({ defsVersion: "d9", protocolVersion: "p1" });

    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("a repeat for the same server version this session settles on updating, never a reload loop", () => {
    const server = { defsVersion: "d1", protocolVersion: "p2" };
    const deps = baseDeps({ readReloadedFor: () => server });
    const guard = createPostMountGuard(deps);

    guard.onHandshake(server);

    expect(deps.onDegrade).toHaveBeenCalledTimes(1);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
  });

  it("a storage write failure degrades rather than reloading unguarded", () => {
    const deps = baseDeps({ writeReloadedFor: () => false });
    const guard = createPostMountGuard(deps);

    guard.onHandshake({ defsVersion: "d2", protocolVersion: "p1" });

    expect(deps.onDegrade).toHaveBeenCalledTimes(1);
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("a throwing stopDrawing (cycle 3 review, Tim's finding: app.ticker before Application.init() has run) still reaches reload/onDegrade, and never throws itself", () => {
    const stopDrawing = vi.fn(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'stop')");
    });
    const reload = vi.fn();
    const deps = baseDeps({ stopDrawing, reload });
    const guard = createPostMountGuard(deps);

    expect(() => guard.onHandshake({ defsVersion: "d2", protocolVersion: "p1" })).not.toThrow();

    expect(stopDrawing).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a throwing stopDrawing still degrades correctly on the updating path too", () => {
    const stopDrawing = vi.fn(() => {
      throw new Error("boom");
    });
    const onDegrade = vi.fn();
    const server = { defsVersion: "d1", protocolVersion: "p2" };
    const deps = baseDeps({ stopDrawing, onDegrade, readReloadedFor: () => server });
    const guard = createPostMountGuard(deps);

    expect(() => guard.onHandshake(server)).not.toThrow();

    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it("acts at most once: a second mismatch after the first is a no-op", () => {
    const deps = baseDeps();
    const guard = createPostMountGuard(deps);

    expect(guard.onHandshake({ defsVersion: "d2", protocolVersion: "p1" })).toBe(true);
    expect(guard.onHandshake({ defsVersion: "d3", protocolVersion: "p1" })).toBe(false);

    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.stopDrawing).toHaveBeenCalledTimes(1);
  });
});
