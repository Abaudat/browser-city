// Story 4.8 (FR140, FR179, NFR4): the reconnect policy is a pure state
// machine; every delay stays inside its stated band and at most one attempt
// is ever in flight.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BACKOFF,
  backoffCeilingMs,
  initialPolicy,
  type PolicyInput,
  type PolicyState,
  stepPolicy,
} from "../../../src/net/reconnect-policy";

const inputs: PolicyInput[] = ["succeeded", "failed", "dropped", "wake"];

describe("backoffCeilingMs", () => {
  it("doubles from the base and never exceeds the cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (n) => {
        const c = backoffCeilingMs(n);
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(BACKOFF.baseMs);
        expect(c).toBeLessThanOrEqual(BACKOFF.capMs);
        expect(backoffCeilingMs(n + 1)).toBeGreaterThanOrEqual(c);
      }),
    );
    expect(backoffCeilingMs(0)).toBe(BACKOFF.baseMs);
    expect(backoffCeilingMs(1)).toBe(BACKOFF.baseMs * 2);
  });
});

describe("stepPolicy", () => {
  it("never asks for an attempt while one is in flight, and every wait is jittered inside [0, ceiling]", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...inputs), { maxLength: 60 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), {
          minLength: 60,
          maxLength: 60,
        }),
        (seq, rolls) => {
          let state: PolicyState = initialPolicy();
          let inFlight = true; // the boot attempt
          seq.forEach((input, i) => {
            const roll = rolls[i] ?? 0;
            const { state: next, action } = stepPolicy(state, input, () => roll);
            if (input === "succeeded" || input === "failed") inFlight = false;
            if (action.kind === "attempt") {
              expect(inFlight).toBe(false);
              inFlight = true;
            }
            if (action.kind === "wait") {
              expect(action.delayMs).toBeGreaterThanOrEqual(0);
              expect(action.delayMs).toBeLessThanOrEqual(BACKOFF.capMs);
              expect(action.delayMs).toBeLessThan(backoffCeilingMs(next.failures) + 1);
            }
            state = next;
          });
        },
      ),
    );
  });

  it("resets the schedule on success", () => {
    let s = initialPolicy();
    for (let i = 0; i < 5; i++) {
      s = stepPolicy(s, "failed", () => 0.5).state;
      s = stepPolicy(s, "wake", () => 0.5).state;
    }
    expect(s.failures).toBe(5);
    s = stepPolicy(s, "succeeded", () => 0.5).state;
    expect(s).toEqual({ kind: "connected", failures: 0 });
    const dropped = stepPolicy(s, "dropped", () => 1 - Number.EPSILON);
    expect(dropped.action).toEqual({ kind: "wait", delayMs: BACKOFF.baseMs - 1 });
  });

  it("a wake while waiting attempts now; while connecting does nothing; while connected probes", () => {
    const waiting = stepPolicy(initialPolicy(), "failed", () => 0.5).state;
    expect(waiting.kind).toBe("waiting");
    expect(stepPolicy(waiting, "wake", () => 0.5).action).toEqual({ kind: "attempt" });
    expect(stepPolicy(initialPolicy(), "wake", () => 0.5).action).toEqual({ kind: "none" });
    expect(stepPolicy({ kind: "connected", failures: 0 }, "wake", () => 0.5).action).toEqual({
      kind: "probe",
    });
  });

  it("ignores inputs that cannot happen in a state", () => {
    const connected = { kind: "connected", failures: 0 } as const;
    expect(stepPolicy(connected, "failed", () => 0).action).toEqual({ kind: "none" });
    expect(stepPolicy(connected, "succeeded", () => 0).action).toEqual({ kind: "none" });
    const waiting = stepPolicy(initialPolicy(), "failed", () => 0).state;
    expect(stepPolicy(waiting, "dropped", () => 0).action).toEqual({ kind: "none" });
    expect(stepPolicy(waiting, "succeeded", () => 0).state).toEqual(waiting);
    expect(stepPolicy(initialPolicy(), "dropped", () => 0).action).toEqual({ kind: "none" });
  });
});
