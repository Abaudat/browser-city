import { describe, expect, it } from "vitest";
import { buildReport } from "./duration-report";

const fake = (name: string, state: string, duration: number, timeout?: number) => ({
  fullName: name,
  options: timeout === undefined ? {} : { timeout },
  result: () => ({ state }),
  diagnostic: () => ({ duration }),
});
const mod = (moduleId: string, tests: ReturnType<typeof fake>[]) =>
  ({ moduleId, children: { allTests: () => tests } }) as never;

const BS = String.fromCharCode(92);
const WIN_ROOT = ["C:", "repo", "client"].join(BS);
const WIN_FILE = [WIN_ROOT, "tests", "unit", "a.test.ts"].join(BS);

describe("duration report", () => {
  it("records a describe-level timeout, a per-test timeout and the default", () => {
    const report = buildReport(
      [
        mod(WIN_FILE, [
          fake("d > described", "passed", 12.345, 60_000),
          fake("d > own", "passed", 3, 9_000),
          fake("plain", "failed", 1.5),
        ]),
      ],
      5_000,
      WIN_ROOT,
    );
    expect(report).toEqual({
      defaultTimeoutMs: 5_000,
      tests: [
        {
          file: "tests/unit/a.test.ts",
          name: "d > described",
          durationMs: 12.35,
          timeoutMs: 60_000,
          state: "passed",
        },
        {
          file: "tests/unit/a.test.ts",
          name: "d > own",
          durationMs: 3,
          timeoutMs: 9_000,
          state: "passed",
        },
        {
          file: "tests/unit/a.test.ts",
          name: "plain",
          durationMs: 1.5,
          timeoutMs: 5_000,
          state: "failed",
        },
      ],
    });
  });

  it("leaves out skipped tests", () => {
    const report = buildReport([mod("/r/c/x.test.ts", [fake("s", "skipped", 0)])], 5_000, "/r/c");
    expect(report.tests).toEqual([]);
  });
});
