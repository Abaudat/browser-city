// Quentin's direction: "no row query in the movement path" and "no
// PixiJS/DOM/net in world/**" must be structurally impossible to regress,
// not merely a convention -- `client/biome.json`'s `noRestrictedImports`
// override enforces this in CI; this test enforces the same rule directly
// against source text, so it fails even if the Biome config is ever
// loosened or misconfigured.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORLD_DIR = fileURLToPath(new URL("../../../src/world/", import.meta.url));

const WORLD_FILES = [
  "chunk.ts",
  "subcells.ts",
  "collision-grid.ts",
  "movement.ts",
  "movement-config.ts",
  "keyboard.ts",
];

const IMPORT_LINE = /^import\s.*from\s+["']([^"']+)["'];?\s*$/gm;

describe("world/** import boundaries", () => {
  for (const file of WORLD_FILES) {
    it(`${file} never imports pixi.js, ../demo/*, or a value from ../net/* other than bindings types`, () => {
      const text = readFileSync(`${WORLD_DIR}${file}`, "utf-8");
      for (const match of text.matchAll(IMPORT_LINE)) {
        const [fullLine, specifier] = match;
        expect(specifier, fullLine).not.toBe("pixi.js");
        expect(specifier.startsWith("../demo/"), fullLine).toBe(false);
        if (specifier.startsWith("../net/")) {
          expect(specifier, fullLine).toBe("../net/bindings/types");
          expect(fullLine.startsWith("import type"), fullLine).toBe(true);
        }
      }
    });
  }
});
