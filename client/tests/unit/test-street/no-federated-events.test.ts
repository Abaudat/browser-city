// Tim's direction, story 1.9: picking goes through the derived footprint
// index, never through PixiJS hit-testing. Per-sprite federated events do
// not scale to a dense pool and they bypass the index entirely, so the
// constructs that would turn them on are banned outright across the whole
// client -- not merely absent from the file that happens to do picking
// today.
//
// A source scan in the style of `world/no-speed-literal.test.ts`: the
// rule is about code that must never be written anywhere, which no
// behavioural test over one module could ever prove.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../../src/", import.meta.url));

/** `src/net/bindings/**` is generated and never touches rendering, but is
 * excluded for the same reason every other check excludes it. */
function everySourceFile(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = `${dir}${name}`;
    if (statSync(path).isDirectory()) {
      if (name === "bindings") continue;
      everySourceFile(`${path}/`, out);
    } else if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

/** Each pattern is the actual construct that enables or handles a Pixi
 * federated pointer event. `eventMode`/`interactive`/`interactiveChildren`
 * are the switches; `.on("pointer…")`/`addEventListener("pointer…")` on a
 * display object is the handler. The listeners `input/pointer.ts` adds are
 * on a real DOM element, via `element.addEventListener("pointermove", …)`
 * -- so the handler patterns below deliberately match only the Pixi
 * idioms (`on`/`once`), never DOM `addEventListener`. */
const BANNED: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  // Property writes and object-literal options only -- deliberately not
  // the bare word, which would also flag the comments in `scene.ts` and
  // `input/pointer.ts` that state this very ban (the same distinction
  // `check-no-masks.sh` draws for `.mask`).
  { name: "eventMode", pattern: /\beventMode\s*[:=][^=]/ },
  { name: "interactive", pattern: /\binteractive(Children)?\s*[:=][^=]/ },
  { name: 'on("pointer…")', pattern: /\.(on|once)\s*\(\s*["'`]pointer/i },
  { name: 'on("click"/"tap")', pattern: /\.(on|once)\s*\(\s*["'`](click|tap|mouse)/i },
  { name: "hitArea", pattern: /\bhitArea\b/ },
  { name: "EventSystem", pattern: /\bEventSystem\b/ },
];

describe("no PixiJS federated pointer events anywhere under client/src/", () => {
  const files = everySourceFile(SRC_DIR);

  it("finds source files to scan at all", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const { name, pattern } of BANNED) {
    it(`no file turns on or handles ${name}`, () => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf-8")));
      expect(offenders, `found ${name} in ${offenders.join(", ")}`).toEqual([]);
    });
  }

  it("the one real pointer listener is on a DOM element, in input/pointer.ts", () => {
    const pointer = readFileSync(`${SRC_DIR}input/pointer.ts`, "utf-8");
    expect(pointer).toContain('element.addEventListener("pointerdown"');
    expect(pointer).toContain('element.addEventListener("pointermove"');
  });

  it("NFR6: no touch, gesture or controller handling is written anywhere", () => {
    const touchPatterns = [/["'`]touch(start|move|end)/i, /\bGamepad\b/, /["'`]gesture/i];
    for (const pattern of touchPatterns) {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf-8")));
      expect(offenders, `found ${pattern} in ${offenders.join(", ")}`).toEqual([]);
    }
  });
});
