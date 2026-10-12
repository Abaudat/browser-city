// Story 4.6: the shell (`index.html`) carries copies of three values the
// bundle owns -- the arrival flag key, the name field's `maxlength` and the
// tab's title. This pins each copy to its source so they cannot drift.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARRIVED_FLAG_KEY } from "../../../src/identity/arrival-flag";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INDEX = readFileSync(`${ROOT}index.html`, "utf8");
const DEFS = JSON.parse(readFileSync(`${ROOT}public/defs/defs.json`, "utf8")) as {
  name_max_chars: number;
};

describe("index.html shell contract", () => {
  it("the inline script reads the same flag key the bundle writes", () => {
    expect(INDEX).toContain(`localStorage.getItem("${ARRIVED_FLAG_KEY}")`);
  });

  it("the name field's maxlength is the generated name_max_chars", () => {
    const m = /<input[^>]*\bmaxlength="(\d+)"/.exec(INDEX);
    expect(Number(m?.[1])).toBe(DEFS.name_max_chars);
  });

  it("the tab is named for the product and nothing else", () => {
    expect(/<title>([^<]*)<\/title>/.exec(INDEX)?.[1]).toBe("BrowserCity");
  });
});
