import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDefs } from "../../../src/defs/parse";
import { loadL3Config } from "../../../src/l3/config";

/** The committed defs' L3 dials, plus the city's real ms per city minute. */
export function l3Config() {
  const text = readFileSync(resolve(__dirname, "../../../public/defs/defs.json"), "utf8");
  return loadL3Config(parseDefs(JSON.parse(text)));
}

/** The life dials a body with the committed flavour catalogue gets: the idle
 * and walk rows of the appearance layout. */
export function lifeDials(frames: Record<string, number> = { idle: 6, walk: 6 }) {
  const cfg = l3Config();
  return {
    bucketMilliminutes: cfg.flavourBucketMilliminutes,
    idleFrameMilliminutes: cfg.idleFrameMilliminutes,
    rows: cfg.flavourRows,
    frames,
    rampCells: cfg.avoidRampCells,
  };
}

/** A body with no flavour at all: it stands on frame 0 of its idle row. */
export function quietLife() {
  return { ...lifeDials({ idle: 1, walk: 6 }), rows: [] };
}
