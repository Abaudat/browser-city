import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseFastCheckSeed, reproduceLine } from "./property-seed-env";

describe("parseFastCheckSeed (NFR50)", () => {
  it("returns no seed when unset outside CI", () => {
    expect(parseFastCheckSeed({})).toBeUndefined();
  });
  it("throws when unset under CI", () => {
    expect(() => parseFastCheckSeed({ CI: "true" })).toThrow(/FAST_CHECK_SEED/);
  });
  it("parses a non-negative safe integer, in CI or not", () => {
    expect(parseFastCheckSeed({ FAST_CHECK_SEED: "20260929" })).toBe(20260929);
    expect(parseFastCheckSeed({ FAST_CHECK_SEED: "0", CI: "true" })).toBe(0);
    expect(parseFastCheckSeed({ FAST_CHECK_SEED: String(Number.MAX_SAFE_INTEGER) })).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
  for (const bad of ["", "abc", "1.5", "-1", "1e3", " 7", String(Number.MAX_SAFE_INTEGER + 2)]) {
    it(`throws on ${JSON.stringify(bad)}, never falling back to a random seed`, () => {
      expect(() => parseFastCheckSeed({ FAST_CHECK_SEED: bad })).toThrow(/FAST_CHECK_SEED/);
      expect(() => parseFastCheckSeed({ FAST_CHECK_SEED: bad, CI: "true" })).toThrow(
        /FAST_CHECK_SEED/,
      );
    });
  }
});

describe("the setup file is wired", () => {
  it("configures the global seed from FAST_CHECK_SEED and installs the reporter", () => {
    const cfg = fc.readConfigureGlobal();
    expect(cfg.seed).toBe(parseFastCheckSeed(process.env));
    expect(cfg.reporter).toBeTypeOf("function");
  });
});

describe("the reporter", () => {
  it("names the folded seed and the file in a reproduce line", () => {
    let message = "";
    try {
      fc.assert(
        fc.property(fc.integer(), () => false),
        { numRuns: 3 },
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Property failed after/);
    const m = /reproduce: FAST_CHECK_SEED=(\d+) npx vitest run (\S+)$/m.exec(message);
    expect(m).not.toBeNull();
    const seed = process.env.FAST_CHECK_SEED;
    if (seed !== undefined) expect(Number(m?.[1])).toBe(Number(seed) >>> 0);
    expect(m?.[2]).toBe("tests/unit/setup/property-seed.test.ts");
  });

  it("goes through the same path for an async property", async () => {
    let message = "";
    try {
      await fc.assert(
        fc.asyncProperty(fc.integer(), async () => false),
        { numRuns: 3 },
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/reproduce: FAST_CHECK_SEED=\d+ npx vitest run /);
  });

  it("formats an unsigned 32-bit seed, so a negative fresh seed still parses back", () => {
    expect(reproduceLine(-5, "a.test.ts")).toBe(
      "reproduce: FAST_CHECK_SEED=4294967291 npx vitest run a.test.ts",
    );
  });
});

describe("a github.run_id-sized seed", () => {
  const draw = (seed: number): number[] => {
    const seen: number[] = [];
    fc.assert(
      fc.property(fc.integer(), (n) => {
        seen.push(n);
        return true;
      }),
      { seed, numRuns: 10 },
    );
    return seen;
  };
  it("folds to 32 bits, so the reported seed reproduces the same values", () => {
    const runId = 20260929 + 2 ** 32;
    expect(draw(runId)).toEqual(draw(runId >>> 0));
    expect(draw(runId)).toEqual(draw(20260929));
  });
  it("draws the same values twice under one seed", () => {
    expect(draw(7)).toEqual(draw(7));
  });
});
