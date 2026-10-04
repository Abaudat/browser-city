// The one place the client configures fast-check (NFR50, NFR51): every property
// draws from FAST_CHECK_SEED, and a failure prints the line that reproduces it.
// `defaultSizeToMaxWhenMaxSpecified` makes a stated maxLength/maxKeys
// the size explored. Per-arbitrary `size` is 30+ edits every new property must
// remember; `baseSize` is still a cap and inflates arbitraries with no bound.
import fc from "fast-check";
import { expect } from "vitest";
import { parseFastCheckSeed, reportFailure } from "./property-seed-env";

const seed = parseFastCheckSeed(process.env);

fc.configureGlobal({
  ...(seed === undefined ? {} : { seed }),
  defaultSizeToMaxWhenMaxSpecified: true,
  reporter: (out) => reportFailure(out, expect.getState(), process.cwd()),
});
