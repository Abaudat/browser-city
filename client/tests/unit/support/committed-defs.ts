// The committed `client/public/defs/defs.json`, parsed the way the browser
// parses it. Reading the file the browser fetches is deliberate: collision,
// movement and rendering are tested against the real defs, never a
// synthetic def.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDefs } from "../../../src/defs/parse";
import type { Defs } from "../../../src/defs/types";
import type { MovementConfig } from "../../../src/world/movement";
import { loadMovementConfig } from "../../../src/world/movement-config";
import type { ObjectSource } from "../../../src/world/object-defs";
import { objectDefsById, thresholdDefIds, windowDefIds } from "../../../src/world/object-defs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

let cached: Defs | undefined;

export function committedDefs(): Defs {
  cached ??= parseDefs(
    JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")) as unknown,
  );
  return cached;
}

export function committedMovementConfig(): MovementConfig {
  return loadMovementConfig(committedDefs());
}

export function committedObjectSources(): ReadonlyMap<number, ObjectSource> {
  return objectDefsById(committedDefs());
}

export function committedWindowDefIds(): ReadonlySet<number> {
  return windowDefIds(committedDefs());
}

export function committedThresholdDefIds(): ReadonlySet<number> {
  return thresholdDefIds(committedDefs());
}
