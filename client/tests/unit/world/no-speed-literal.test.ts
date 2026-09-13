// Quentin's direction: the walking speed is a named constant, never a
// literal scattered through movement code. The one legal declaration is
// `defs/balance/movement.toml`'s own `value = 2200` -- everything under
// `client/src/world/**` must read it through `loadMovementConfig`,
// never repeat the number itself.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORLD_DIR = fileURLToPath(new URL("../../../src/world/", import.meta.url));

const SPEED_LITERALS = ["2200", "2.2"];

describe("the walking speed literal appears nowhere under client/src/world/**", () => {
  for (const file of readdirSync(WORLD_DIR)) {
    if (!file.endsWith(".ts")) continue;
    it(`${file} does not repeat the speed literal`, () => {
      const text = readFileSync(`${WORLD_DIR}${file}`, "utf-8");
      for (const literal of SPEED_LITERALS) {
        expect(text.includes(literal), `found '${literal}' in ${file}`).toBe(false);
      }
    });
  }
});
