// Pure-function coverage for the one seam SDK row shape becomes client
// state (Quentin, story 1.1). No socket, no SDK import -- a fabricated row
// only.
import { describe, expect, it } from "vitest";
import { observePingInsert, type PingRow } from "../../src/net/observe-ping";

describe("observePingInsert", () => {
  it("carries the row's id and message through unchanged", () => {
    const row: PingRow = { id: 7n, message: "hello" };

    const observation = observePingInsert(row, () => 1_000);

    expect(observation.id).toBe(7n);
    expect(observation.message).toBe("hello");
  });

  it("stamps the observation with the injected clock, not the wall clock", () => {
    const row: PingRow = { id: 1n, message: "x" };

    const observation = observePingInsert(row, () => 42);

    expect(observation.observedAtMs).toBe(42);
  });

  it("defaults to Date.now when no clock is injected", () => {
    const before = Date.now();
    const observation = observePingInsert({ id: 2n, message: "y" });
    const after = Date.now();

    expect(observation.observedAtMs).toBeGreaterThanOrEqual(before);
    expect(observation.observedAtMs).toBeLessThanOrEqual(after);
  });

  it("does not mutate the input row", () => {
    const row: PingRow = { id: 3n, message: "z" };
    const frozen = Object.freeze({ ...row });

    expect(() => observePingInsert(frozen, () => 0)).not.toThrow();
  });
});
