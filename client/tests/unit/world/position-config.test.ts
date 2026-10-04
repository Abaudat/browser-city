// Story 4.4 (FR138, NFR13, NFR14): the dial is declared once and read once.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import { loadPositionConfig } from "../../../src/world/position-config";
import { REMOTE_DELAY_PERIODS } from "../../../src/world/remote-motion";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC = `${REPO_ROOT}client/src/`;
const defs = parseDefs(
  JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")),
);
const dial = defs.balance.find((b) => b.key === "net.player_position_hz");
if (!dial) throw new Error("no net.player_position_hz");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}${name}`;
    if (name === "bindings") return [];
    if (statSync(path).isDirectory()) return sources(`${path}/`);
    return name.endsWith(".ts") ? [path] : [];
  });
}

describe("the position dial", () => {
  it("derives the sender period and the interpolation delay from the one key", () => {
    const c = loadPositionConfig(defs);
    expect(c.hz).toBe(dial.value);
    expect(c.periodMs).toBe(1000 / dial.value);
    expect(c.delayMs).toBeGreaterThanOrEqual(REMOTE_DELAY_PERIODS * c.periodMs);
    expect(c.unitsPerCell).toBe(defs.positionUnitsPerCell);
  });

  it("holds the committed delay to at least two send periods across the declared range", () => {
    const delay = defs.balance.find((b) => b.key === "net.player_interpolation_delay_ms");
    expect(delay?.value).toBeGreaterThanOrEqual(2 * (1000 / dial.value));
    expect(delay?.min).toBeGreaterThanOrEqual(2 * (1000 / dial.max));
  });

  it("is declared once with a min and a max, the committed value inside them", () => {
    expect(dial.min).toBeLessThan(dial.max);
    expect(dial.value).toBeGreaterThanOrEqual(dial.min);
    expect(dial.value).toBeLessThanOrEqual(dial.max);
  });

  it("appears in no client source but `world/position-config.ts`", () => {
    const hits = sources(SRC)
      .filter((f) =>
        /player_position_hz|player_interpolation_delay_ms/.test(readFileSync(f, "utf-8")),
      )
      .map((f) => f.slice(SRC.length));
    expect(hits).toEqual(["world/position-config.ts"]);
  });

  it("AC4: ten players at the top of the dial out-write twenty thousand citizens (NFR14)", () => {
    // NFR14: 42 transactions per second at 5,000 citizens, so 168 at 20,000.
    const CITIZEN_TX_PER_S_AT_5000 = 42;
    const citizenTxAt20000 = (CITIZEN_TX_PER_S_AT_5000 * 20_000) / 5_000;
    const PLAYERS = 10;
    expect(citizenTxAt20000).toBe(168);
    expect(PLAYERS * dial.max).toBeGreaterThan(citizenTxAt20000);
  });
});
