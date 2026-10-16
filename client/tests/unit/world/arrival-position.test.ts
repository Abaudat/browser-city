import { describe, expect, it } from "vitest";
import { createArrivalPosition } from "../../../src/world/arrival-position";

const UNITS = 256;
const FALLBACK = { x: 3.5, y: 4.5, floor: 0 };
const ROW = { x: 436, y: 416, floor: 0, fracX: 128, fracY: 128 };

describe("arrival position (story 7.1, FR145)", () => {
  it("starts the scene at the stored row, never at the fallback", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    a.stored(ROW);
    const start = a.mount();
    expect(start).toEqual({ x: 436.5, y: 416.5, floor: 0 });
    expect(a.senderMayRun()).toBe(true);
  });

  it("falls back only when no row exists", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    expect(a.mount()).toEqual(FALLBACK);
    expect(a.senderMayRun()).toBe(true);
  });

  it("a return visit spawns from the stored row, never re-homed", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    a.stored({ ...ROW, x: 12, y: 40 });
    expect(a.mount()).toEqual({ x: 12.5, y: 40.5, floor: 0 });
  });

  it("sends nothing before adoption: no sender until the scene is mounted", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    a.stored(ROW);
    expect(a.senderMayRun()).toBe(false);
    a.mount();
    expect(a.senderMayRun()).toBe(true);
  });

  it("a row that arrives after the scene mounted on the fallback is never overwritten", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    a.mount();
    a.stored(ROW);
    expect(a.senderMayRun()).toBe(false);
  });

  it("a row that arrives after the scene mounted from the same row changes nothing", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    a.stored(ROW);
    a.mount();
    a.stored({ ...ROW, x: 437 });
    expect(a.senderMayRun()).toBe(true);
  });

  it("once the sender has run, rows are its own echo and never stop it", () => {
    const a = createArrivalPosition(UNITS, FALLBACK);
    a.mount();
    expect(a.senderMayRun()).toBe(true);
    a.stored(ROW);
    expect(a.senderMayRun()).toBe(true);
  });
});
