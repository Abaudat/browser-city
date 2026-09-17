// Story 2.8 (FR147), cycle 1 review (Tim's blocker finding): the one
// place both the boot gate and the post-mount guard attempt a guarded
// reload -- a storage write that did not land, or a throwing `reload()`
// itself, must always fall back to `onDegrade()`, never an unguarded
// reload.
import { describe, expect, it, vi } from "vitest";
import { attemptGuardedReload } from "../../../src/boot/guarded-reload";

const SERVER = { defsVersion: "d2", protocolVersion: "p1" };

describe("attemptGuardedReload", () => {
  it("writes the guard, then reloads, when the write lands", () => {
    const writeReloadedFor = vi.fn(() => true);
    const reload = vi.fn();
    const onDegrade = vi.fn();

    attemptGuardedReload({ writeReloadedFor, reload, onDegrade }, SERVER);

    expect(writeReloadedFor).toHaveBeenCalledWith(SERVER);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onDegrade).not.toHaveBeenCalled();
  });

  it("degrades instead of reloading when the storage write fails (null storage, a throwing setItem, ...)", () => {
    const writeReloadedFor = vi.fn(() => false);
    const reload = vi.fn();
    const onDegrade = vi.fn();

    attemptGuardedReload({ writeReloadedFor, reload, onDegrade }, SERVER);

    expect(reload).not.toHaveBeenCalled();
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it("degrades instead of throwing when reload() itself throws", () => {
    const writeReloadedFor = vi.fn(() => true);
    const reload = vi.fn(() => {
      throw new Error("reload refused (sandboxed iframe)");
    });
    const onDegrade = vi.fn();

    expect(() =>
      attemptGuardedReload({ writeReloadedFor, reload, onDegrade }, SERVER),
    ).not.toThrow();
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });
});
