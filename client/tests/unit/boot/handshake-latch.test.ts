// Story 2.8: `net/connection.ts`'s own event callbacks start firing the
// instant `connect()` is called, in `main()` -- before `boot-gate.ts` has
// even started `fetchDefs`'s own await, let alone registered a listener.
// This latch is what makes that race safe: whichever of
// `resolveHandshake`/`resolveUnreachable` happens first wins, replayed to
// `settled()` immediately if it already happened by the time that is
// called.
import { describe, expect, it } from "vitest";
import { createHandshakeLatch } from "../../../src/boot/handshake-latch";

const VERSION = { defsVersion: "d1", protocolVersion: "p1" };

describe("createHandshakeLatch", () => {
  it("settled() resolves with the handshake version once resolveHandshake is called", async () => {
    const latch = createHandshakeLatch();
    const promise = latch.settled();
    latch.resolveHandshake(VERSION);
    await expect(promise).resolves.toEqual({ kind: "handshake", version: VERSION });
  });

  it("settled() resolves as unreachable once resolveUnreachable is called", async () => {
    const latch = createHandshakeLatch();
    const promise = latch.settled();
    latch.resolveUnreachable();
    await expect(promise).resolves.toEqual({ kind: "unreachable" });
  });

  it("a call to resolveHandshake/resolveUnreachable before settled() is ever called is replayed immediately", async () => {
    const latch = createHandshakeLatch();
    latch.resolveHandshake(VERSION);
    await expect(latch.settled()).resolves.toEqual({ kind: "handshake", version: VERSION });
  });

  it("settles at most once -- whichever happens first wins, a later call is a no-op", async () => {
    const latch = createHandshakeLatch();
    latch.resolveHandshake(VERSION);
    latch.resolveUnreachable();
    await expect(latch.settled()).resolves.toEqual({ kind: "handshake", version: VERSION });
  });

  it("the reverse order also settles at most once", async () => {
    const latch = createHandshakeLatch();
    latch.resolveUnreachable();
    latch.resolveHandshake(VERSION);
    await expect(latch.settled()).resolves.toEqual({ kind: "unreachable" });
  });

  it("calling settled() twice resolves both callers with the same settlement", async () => {
    const latch = createHandshakeLatch();
    const a = latch.settled();
    const b = latch.settled();
    latch.resolveHandshake(VERSION);
    await expect(a).resolves.toEqual({ kind: "handshake", version: VERSION });
    await expect(b).resolves.toEqual({ kind: "handshake", version: VERSION });
  });

  describe("latest() (cycle 2 review, Quentin's finding 1)", () => {
    const LATER = { defsVersion: "d2", protocolVersion: "p1" };

    it("is undefined before any handshake has ever arrived", () => {
      const latch = createHandshakeLatch();
      expect(latch.latest()).toBeUndefined();
    });

    it("reflects the first handshake once settled", () => {
      const latch = createHandshakeLatch();
      latch.resolveHandshake(VERSION);
      expect(latch.latest()).toEqual(VERSION);
    });

    it("keeps updating on every later handshake, even after the latch has already settled", async () => {
      const latch = createHandshakeLatch();
      latch.resolveHandshake(VERSION);
      latch.resolveHandshake(LATER);
      expect(latch.latest()).toEqual(LATER);
      // settled() itself is unaffected -- it still resolves with the
      // first settlement, exactly as before.
      await expect(latch.settled()).resolves.toEqual({ kind: "handshake", version: VERSION });
    });

    it("stays undefined across resolveUnreachable -- unreachable is not a version", () => {
      const latch = createHandshakeLatch();
      latch.resolveUnreachable();
      expect(latch.latest()).toBeUndefined();
    });

    it("still updates on a handshake that arrives after resolveUnreachable already settled the latch", () => {
      const latch = createHandshakeLatch();
      latch.resolveUnreachable();
      latch.resolveHandshake(VERSION);
      expect(latch.latest()).toEqual(VERSION);
    });
  });
});
