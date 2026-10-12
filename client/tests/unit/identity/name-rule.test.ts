// The client's mirror of the server's name rule, held to the one shared
// case table (`fixtures/character-names.v1.tsv`) the Rust test reads too.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planName } from "../../../src/identity/name-rule";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DEFS = JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf8")) as {
  name_max_chars: number;
};
const MAX = DEFS.name_max_chars;

/** Decodes the table's `\uXXXX` and `\u{X..}` escapes. */
function decodeEscapes(text: string): string {
  return text.replace(/\\u\{([0-9A-Fa-f]+)\}|\\u([0-9A-Fa-f]{4})/g, (_m, long, short) =>
    String.fromCodePoint(Number.parseInt(long ?? short, 16)),
  );
}

describe("name rule", () => {
  const table = readFileSync(`${REPO_ROOT}fixtures/character-names.v1.tsv`, "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));

  it("reads a non-trivial shared table", () => {
    expect(table.length).toBeGreaterThanOrEqual(15);
  });

  for (const line of table) {
    const [input, expected] = line.replace(/\r$/, "").split("\t") as [string, string];
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      const got = planName(decodeEscapes(input), MAX);
      if (expected === "-") expect(got.ok).toBe(false);
      else expect(got).toEqual({ ok: true, name: decodeEscapes(expected) });
    });
  }

  it("never throws and is idempotent on what it accepts", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const got = planName(s, MAX);
        if (got.ok) expect(planName(got.name, MAX)).toEqual(got);
      }),
    );
  });
});
