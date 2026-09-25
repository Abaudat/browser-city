// A shared table of malformed-payload cases both the server (`tools/
// defs-build`) and the client are asserted to reject -- Quentin's
// direction: the client must never be quietly lenient about input the
// module rejects. `fixtures/defs-malformed-cases.v1.json` is the shared
// list of case names; each has its own JSON payload here for the client
// (the module's own equivalent-category TOML fixtures live under
// `tools/defs-build/tests/fixtures/invalid/`, checked against this same
// list by `tools/defs-build/tests/shared_malformed_cases.rs`).
//
// `item-unknown-unit` is absent too: it needs the codes golden's unit names,
// which this client never reads (an item carries a `u32` code only).
// `sprite-sheet-missing` and `sprite-outside-sheet-bounds` are
// deliberately absent from the shared list: both need a real sheet's own
// `IHDR` dimensions, which this client never reads -- the artefact it
// parses only ever carries an already-validated `sprite` rect. They
// exist as server-only `tools/defs-build` fixtures instead.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const cases: string[] = JSON.parse(
  readFileSync(`${REPO_ROOT}fixtures/defs-malformed-cases.v1.json`, "utf-8"),
);

describe("shared malformed-payload cases", () => {
  it("the shared case list is non-empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    it(`rejects '${name}'`, () => {
      const payload = JSON.parse(
        readFileSync(`${REPO_ROOT}fixtures/defs-malformed-payloads/${name}.json`, "utf-8"),
      );
      expect(() => parseDefs(payload)).toThrow();
    });
  }
});
