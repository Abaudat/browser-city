// The committed dump's path and its text: one compact row per line, so a
// review diff reads by row.

import { fileURLToPath } from "node:url";
import { type BlockDump, buildBlock } from "./block";

export const BLOCK_FIXTURE_PATH = fileURLToPath(
  new URL("../../../fixtures/fixture-block.v1.json", import.meta.url),
);

function rows(name: string, list: readonly (readonly unknown[])[]): string {
  return `"${name}": [\n${list.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
}

export function blockDocument(dump: BlockDump = buildBlock()): string {
  return `${[
    "{",
    `"version": ${dump.version},`,
    `"chunks": ${JSON.stringify(dump.chunks)},`,
    `"maxId": ${dump.maxId},`,
    `"cupboard": ${JSON.stringify(dump.cupboard)},`,
    `${rows("placed", dump.placed)},`,
    `${rows("transitions", dump.transitions)},`,
    rows("ground", dump.ground),
    "}",
  ].join("\n")}\n`;
}
