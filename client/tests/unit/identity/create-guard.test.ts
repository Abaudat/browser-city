import { describe, expect, it, vi } from "vitest";
import { guardedCreateCharacter } from "../../../src/identity/create-guard";

describe("guardedCreateCharacter (story 4.5)", () => {
  it("refuses, and never calls create, for an identity that is not persisted", async () => {
    const create = vi.fn(async () => {});
    const guarded = guardedCreateCharacter(() => false, create);
    await expect(guarded()).rejects.toThrow(/not persisted/);
    expect(create).not.toHaveBeenCalled();
  });

  it("calls create for a persisted identity", async () => {
    const create = vi.fn(async () => {});
    await guardedCreateCharacter(() => true, create)();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("reads persistence at call time, not at wiring time", async () => {
    let persisted = false;
    const create = vi.fn(async () => {});
    const guarded = guardedCreateCharacter(() => persisted, create);
    await expect(guarded()).rejects.toThrow();
    persisted = true;
    await guarded();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
