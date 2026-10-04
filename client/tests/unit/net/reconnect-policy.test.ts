// Story 4.8 (FR140, FR179, NFR4): the reconnect policy is a pure state
// machine; every delay stays inside its stated band and at most one attempt
// is ever in flight.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BACKOFF,
  backoffCeilingMs,
  CONNECT_TIMEOUT_MS,
  initialPolicy,
  type PolicyInput,
  type PolicyState,
  stepPolicy,
} from "../../../src/net/reconnect-policy";

const inputs: PolicyInput[] = ["succeeded", "failed", "dropped", "wake"];
const TOP = 1 - Number.EPSILON;

describe("backoffCeilingMs", () => {
  it("starts at the base, doubles, and never exceeds the cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (n) => {
        const c = backoffCeilingMs(n);
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(BACKOFF.baseMs);
        expect(c).toBeLessThanOrEqual(BACKOFF.capMs);
        expect(backoffCeilingMs(n + 1)).toBeGreaterThanOrEqual(c);
      }),
    );
    expect(backoffCeilingMs(1)).toBe(BACKOFF.baseMs);
    expect(backoffCeilingMs(2)).toBe(BACKOFF.baseMs * 2);
    expect(backoffCeilingMs(3)).toBe(BACKOFF.baseMs * 4);
  });
});

describe("stepPolicy", () => {
  it("never asks for an attempt while one is in flight, and every wait is exactly the ceiling of the unsuccessful-attempt count", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...inputs), { maxLength: 80 }), (seq) => {
        let state: PolicyState = initialPolicy();
        let inFlight = true; // the boot attempt
        // The model: consecutive unsuccessful attempts since the last
        // success, a lost connection counting as one.
        let unsuccessful = 0;
        let connected = false;
        let waiting = false;
        for (const input of seq) {
          const { state: next, action } = stepPolicy(state, input, () => TOP);
          if (input === "succeeded" && inFlight && !connected && !waiting) {
            unsuccessful = 0;
            connected = true;
          } else if (input === "failed" && inFlight && !connected && !waiting) {
            unsuccessful += 1;
          } else if (input === "dropped" && connected) {
            unsuccessful = 1;
            connected = false;
          }
          if (input === "succeeded" || input === "failed") inFlight = false;
          if (action.kind === "attempt") {
            expect(inFlight).toBe(false);
            inFlight = true;
            waiting = false;
          }
          if (action.kind === "wait") {
            waiting = true;
            expect(action.delayMs).toBe(backoffCeilingMs(unsuccessful) - 1);
            expect(next.failures).toBe(unsuccessful);
          }
          state = next;
        }
      }),
    );
  });

  it("every jittered delay lies in [0, ceiling)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        fc.integer({ min: 0, max: 40 }),
        (roll, failures) => {
          const { action } = stepPolicy({ kind: "connecting", failures }, "failed", () => roll);
          if (action.kind !== "wait") throw new Error("expected a wait");
          expect(action.delayMs).toBeGreaterThanOrEqual(0);
          expect(action.delayMs).toBeLessThan(backoffCeilingMs(failures + 1));
        },
      ),
    );
  });

  it("a drop's schedule equals the boot schedule", () => {
    const delays = (start: PolicyState, first: PolicyInput): number[] => {
      let s = start;
      const out: number[] = [];
      let input: PolicyInput = first;
      for (let i = 0; i < 7; i++) {
        const step = stepPolicy(s, input, () => TOP);
        if (step.action.kind === "wait") out.push(step.action.delayMs + 1);
        s = step.state;
        input = s.kind === "waiting" ? "wake" : "failed";
        if (input === "wake") {
          s = stepPolicy(s, "wake", () => TOP).state;
          input = "failed";
        }
      }
      return out;
    };
    const boot = delays(initialPolicy(), "failed");
    const drop = delays({ kind: "connected", failures: 0 }, "dropped");
    expect(boot.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(drop).toEqual(boot);
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
    expect(stepPolicy(s, "dropped", () => TOP).action).toEqual({
      kind: "wait",
      delayMs: BACKOFF.baseMs - 1,
    });
  });

  it("an attempt that never settles is failed by the connect deadline and waits on the backoff", () => {
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    const { state, action } = stepPolicy(initialPolicy(), "failed", () => 0);
    expect(state.kind).toBe("waiting");
    expect(action.kind).toBe("wait");
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
