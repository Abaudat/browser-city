// The one place the client configures fast-check (NFR50): every property draws
// from FAST_CHECK_SEED, and a failure prints the line that reproduces it.
import fc from "fast-check";
import { expect } from "vitest";
import { parseFastCheckSeed, reportFailure } from "./property-seed-env";

const seed = parseFastCheckSeed(process.env);

fc.configureGlobal({
  ...(seed === undefined ? {} : { seed }),
  reporter: (out) => reportFailure(out, expect.getState(), process.cwd()),
});
