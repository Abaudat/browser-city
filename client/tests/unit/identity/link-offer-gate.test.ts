import { describe, expect, it, vi } from "vitest";
import { decideOffer, type OfferGateDeps } from "../../../src/identity/link-offer-gate";

const base = (over: Partial<OfferGateDeps> = {}): OfferGateDeps => ({
  hasCarrier: true,
  handshakeSettled: true,
  configured: true,
  today: () => 6,
  firstClockSample: Promise.resolve(),
  timeout: () => new Promise<void>(() => {}),
  due: (today) => today === 6,
  ...over,
});

describe("decideOffer (story 4.5, FR143)", () => {
  it("is not due, and asks nothing, without a carrier or a provider", async () => {
    const due = vi.fn(() => true);
    expect(await decideOffer(base({ hasCarrier: false, due }))).toBe(false);
    expect(await decideOffer(base({ configured: false, due }))).toBe(false);
    expect(due).not.toHaveBeenCalled();
  });

  it("an unreachable gate (no handshake ever) is not due at once: no wait, no timer, even though the clock can never sample", async () => {
    const timeout = vi.fn(() => new Promise<void>(() => {}));
    const due = vi.fn(() => true);
    const p = decideOffer(
      base({
        handshakeSettled: false,
        today: () => undefined,
        firstClockSample: new Promise<void>(() => {}),
        timeout,
        due,
      }),
    );
    // Settles without any timer firing or any sample landing.
    expect(await p).toBe(false);
    expect(timeout).not.toHaveBeenCalled();
    expect(due).not.toHaveBeenCalled();
  });

  it("decides at once when the clock already has a sample", async () => {
    const timeout = vi.fn(() => new Promise<void>(() => {}));
    expect(await decideOffer(base({ timeout }))).toBe(true);
    expect(timeout).not.toHaveBeenCalled();
  });

  it("waits for the first clock sample, once, with no polling", async () => {
    let day: number | undefined;
    let sample: () => void = () => {};
    const firstClockSample = new Promise<void>((r) => {
      sample = r;
    });
    const p = decideOffer(base({ today: () => day, firstClockSample }));
    day = 6;
    sample();
    expect(await p).toBe(true);
  });

  it("a clock that never samples is not due once the bound passes (a hung socket never holds the mount)", async () => {
    let bound: () => void = () => {};
    const timeout = vi.fn(
      () =>
        new Promise<void>((r) => {
          bound = r;
        }),
    );
    const p = decideOffer(
      base({ today: () => undefined, firstClockSample: new Promise<void>(() => {}), timeout }),
    );
    bound();
    expect(await p).toBe(false);
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});
