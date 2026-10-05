import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDefs } from "../../../src/defs/parse";
import { loadL3Config } from "../../../src/l3/config";

/** The committed defs' L3 dials, plus the city's real ms per city minute. */
export function l3Config() {
  const text = readFileSync(resolve(__dirname, "../../../public/defs/defs.json"), "utf8");
  return loadL3Config(parseDefs(JSON.parse(text)));
}
