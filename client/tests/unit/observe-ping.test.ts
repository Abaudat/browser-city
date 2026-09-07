// Pure-function coverage for the one seam SDK row shape becomes client
// state (Quentin, story 1.1). No socket -- `Timestamp` is a plain SDK
// value type, not a connection.
import { Timestamp } from "spacetimedb";
import { describe, expect, it } from "vitest";
import { observePingInsert, type PingRow } from "../../src/net/observe-ping";

function rowAt(message: string, id: bigint, writtenAtMs: number): PingRow {
  return { id, message, writtenAt: Timestamp.fromDate(new Date(writtenAtMs)) };
}

describe("observePingInsert", () => {
  it("carries the row's id and message through unchanged", () => {
    const row = rowAt("hello", 7n, 1_000);

    const observation = observePingInsert(row, () => 1_000);

    expect(observation.id).toBe(7n);
    expect(observation.message).toBe("hello");
  });

  it("converts the server-stamped writtenAt to milliseconds", () => {
    const row = rowAt("x", 1n, 123_456);

    const observation = observePingInsert(row, () => 0);

    expect(observation.writtenAtMs).toBe(123_456);
  });

  it("stamps the observation with the injected clock, not the wall clock", () => {
    const row = rowAt("x", 1n, 0);

    const observation = observePingInsert(row, () => 42);

    expect(observation.observedAtMs).toBe(42);
  });

  it("defaults to Date.now when no clock is injected", () => {
    const before = Date.now();
    const observation = observePingInsert(rowAt("y", 2n, 0));
    const after = Date.now();

    expect(observation.observedAtMs).toBeGreaterThanOrEqual(before);
    expect(observation.observedAtMs).toBeLessThanOrEqual(after);
  });

  it("does not mutate the input row", () => {
    const row = rowAt("z", 3n, 0);
    const frozen = Object.freeze({ ...row });

    expect(() => observePingInsert(frozen, () => 0)).not.toThrow();
  });
});
