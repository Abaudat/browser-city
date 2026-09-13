// The client's own independent parser over `defs/`'s generated JSON asset
// (NFR30, NFR31): deliberately not shared with `tools/defs-build`'s Rust
// parser, but pinned against drifting apart from it by
// `tests/unit/defs/dump-golden.test.ts` (a shared golden both sides
// produce a canonical dump against) and `tests/unit/defs/malformed.test.ts`
// (a shared table of malformed-payload cases both sides must reject) --
// the client must never be quietly lenient about input the module
// rejects at build time.

import type {
  BalanceDef,
  ChainDef,
  ColliderRect,
  Defs,
  ItemDef,
  ObjectDef,
  ProfessionDef,
  RecipeDef,
} from "./types";

export class DefsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefsParseError";
  }
}

function fail(message: string): never {
  throw new DefsParseError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path}: expected an object`);
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path}: expected an array`);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path}: expected a string`);
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path}: expected a number`);
  }
  return value;
}

/** Rust ids/widths/heights are `u32` -- the module hard-rejects a
 * non-integer, a negative value or one at or above 2^32 at build time,
 * and this client must reject the exact same input, never accept it just
 * because it arrived as JSON over `fetch` instead of TOML at build time
 * (Quentin's direction). */
const U32_EXCLUSIVE_MAX = 2 ** 32;

function expectU32(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n) || n < 0 || n >= U32_EXCLUSIVE_MAX) {
    fail(`${path}: expected an integer in [0, 2^32)`);
  }
  return n;
}

/** Balance `value`/`min`/`max` are Rust `i64` -- not a non-integer. Full
 * `i64` range is not representable exactly as a JS `number` (limited to
 * `Number.isSafeInteger`'s +-2^53), which is an inherent JS boundary this
 * client accepts rather than works around; every balance value this
 * project defines is a small, human-authored constant, nowhere near that
 * edge. */
function expectI64(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n)) {
    fail(`${path}: expected an integer`);
  }
  return n;
}

/** A collider bound is a Rust `i32` -- signed, unlike a `u32` id/width. */
const I32_MIN = -(2 ** 31);
const I32_MAX_EXCLUSIVE = 2 ** 31;

function expectI32(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n) || n < I32_MIN || n >= I32_MAX_EXCLUSIVE) {
    fail(`${path}: expected an integer in [-2^31, 2^31)`);
  }
  return n;
}

function parseColliderRect(value: unknown, path: string): ColliderRect {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["x0", "y0", "x1", "y1"], path);
  return {
    x0: expectI32(obj.x0, `${path}.x0`),
    y0: expectI32(obj.y0, `${path}.y0`),
    x1: expectI32(obj.x1, `${path}.x1`),
    y1: expectI32(obj.y1, `${path}.y1`),
  };
}

function parseNullableCollider(value: unknown, path: string): ColliderRect | undefined {
  if (value === undefined || value === null) return undefined;
  return parseColliderRect(value, path);
}

function expectStringArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, i) => expectString(item, `${path}[${i}]`));
}

/** An unknown field is a parse error here exactly as it is in `tools/
 * defs-build`'s `#[serde(deny_unknown_fields)]` (Quentin's direction). */
function checkKnownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${path}: unknown field '${key}'`);
  }
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path}: expected a boolean`);
  return value;
}

function parseObject(value: unknown, path: string): ObjectDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "width", "height", "collider", "window"], path);
  const collider = parseNullableCollider(obj.collider, `${path}.collider`);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    width: expectU32(obj.width, `${path}.width`),
    height: expectU32(obj.height, `${path}.height`),
    window: expectBoolean(obj.window, `${path}.window`),
    ...(collider ? { collider } : {}),
  };
}

function parseItem(value: unknown, path: string): ItemDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key"], path);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
  };
}

function parseRecipe(value: unknown, path: string): RecipeDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "inputs", "outputs"], path);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    inputs: expectStringArray(obj.inputs, `${path}.inputs`),
    outputs: expectStringArray(obj.outputs, `${path}.outputs`),
  };
}

function parseProfession(value: unknown, path: string): ProfessionDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key"], path);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
  };
}

function parseChain(value: unknown, path: string): ChainDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "links"], path);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    links: expectStringArray(obj.links, `${path}.links`),
  };
}

function parseBalance(value: unknown, path: string): BalanceDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["key", "value", "min", "max"], path);
  return {
    key: expectString(obj.key, `${path}.key`),
    value: expectI64(obj.value, `${path}.value`),
    min: expectI64(obj.min, `${path}.min`),
    max: expectI64(obj.max, `${path}.max`),
  };
}

function checkNoDuplicateIdsOrKeys(
  entries: readonly { readonly id: number; readonly key: string }[],
  kind: string,
): void {
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) fail(`duplicate ${kind} id ${entry.id}`);
    seenIds.add(entry.id);
    if (seenKeys.has(entry.key)) fail(`duplicate ${kind} key '${entry.key}'`);
    seenKeys.add(entry.key);
  }
}

/**
 * Parses and fully validates one `defs/defs.json` document -- the same
 * classes of error `tools/defs-build` rejects at build time (unknown
 * field, missing field, wrong type, duplicate id/key, a dangling
 * cross-reference, an out-of-range balance value), never accepted here
 * just because the transport was a runtime `fetch` instead of a build
 * step.
 */
export function parseDefs(data: unknown): Defs {
  const root = expectRecord(data, "$");
  checkKnownKeys(
    root,
    [
      "generated_by",
      "defs_version",
      "collider_subcells_per_cell",
      "objects",
      "items",
      "recipes",
      "professions",
      "chains",
      "balance",
    ],
    "$",
  );

  const defsVersion = expectString(root.defs_version, "$.defs_version");
  const colliderSubcellsPerCell = expectU32(
    root.collider_subcells_per_cell,
    "$.collider_subcells_per_cell",
  );
  const objects = expectArray(root.objects, "$.objects").map((v, i) =>
    parseObject(v, `$.objects[${i}]`),
  );
  const items = expectArray(root.items, "$.items").map((v, i) => parseItem(v, `$.items[${i}]`));
  const recipes = expectArray(root.recipes, "$.recipes").map((v, i) =>
    parseRecipe(v, `$.recipes[${i}]`),
  );
  const professions = expectArray(root.professions, "$.professions").map((v, i) =>
    parseProfession(v, `$.professions[${i}]`),
  );
  const chains = expectArray(root.chains, "$.chains").map((v, i) =>
    parseChain(v, `$.chains[${i}]`),
  );
  const balance = expectArray(root.balance, "$.balance").map((v, i) =>
    parseBalance(v, `$.balance[${i}]`),
  );

  checkNoDuplicateIdsOrKeys(objects, "object");
  checkNoDuplicateIdsOrKeys(items, "item");
  checkNoDuplicateIdsOrKeys(recipes, "recipe");
  checkNoDuplicateIdsOrKeys(professions, "profession");
  checkNoDuplicateIdsOrKeys(chains, "chain");
  const seenBalanceKeys = new Set<string>();
  for (const entry of balance) {
    if (seenBalanceKeys.has(entry.key)) fail(`duplicate balance key '${entry.key}'`);
    seenBalanceKeys.add(entry.key);
  }

  const itemKeys = new Set(items.map((i) => i.key));
  for (const recipe of recipes) {
    for (const input of recipe.inputs) {
      if (!itemKeys.has(input))
        fail(`recipe '${recipe.key}' names unknown item '${input}' in inputs`);
    }
    for (const output of recipe.outputs) {
      if (!itemKeys.has(output))
        fail(`recipe '${recipe.key}' names unknown item '${output}' in outputs`);
    }
  }

  const professionKeys = new Set(professions.map((p) => p.key));
  for (const chain of chains) {
    for (const link of chain.links) {
      if (!professionKeys.has(link)) {
        fail(`chain '${chain.key}' names unknown profession '${link}' in links`);
      }
    }
  }

  for (const entry of balance) {
    if (entry.value < entry.min || entry.value > entry.max) {
      fail(
        `balance '${entry.key}' value ${entry.value} is out of its own declared range [${entry.min}, ${entry.max}]`,
      );
    }
  }

  for (const object of objects) {
    checkColliderWithinFootprint(object, colliderSubcellsPerCell);
  }

  return {
    defsVersion,
    colliderSubcellsPerCell,
    objects,
    items,
    recipes,
    professions,
    chains,
    balance,
  };
}

/** FR128's containment rule (`inv_collider_within_footprint`): a declared
 * `collider` must have positive area and fit entirely inside its own
 * object's footprint, sized `width*colliderSubcellsPerCell x
 * height*colliderSubcellsPerCell` sub-cells -- the exact rule `tools/
 * defs-build`'s own `validate.rs` enforces at build time, checked again
 * here so the client is never quietly lenient about data it did not
 * build itself. */
function checkColliderWithinFootprint(object: ObjectDef, colliderSubcellsPerCell: number): void {
  const c = object.collider;
  if (!c) return;
  if (c.x1 <= c.x0 || c.y1 <= c.y0) {
    fail(
      `object '${object.key}' collider (${c.x0}, ${c.y0})-(${c.x1}, ${c.y1}) has zero or negative area`,
    );
  }
  const maxX = object.width * colliderSubcellsPerCell;
  const maxY = object.height * colliderSubcellsPerCell;
  if (c.x0 < 0 || c.y0 < 0 || c.x1 > maxX || c.y1 > maxY) {
    fail(
      `object '${object.key}' collider (${c.x0}, ${c.y0})-(${c.x1}, ${c.y1}) does not fit inside its footprint ${object.width}x${object.height} cells (${maxX}x${maxY} sub-cells)`,
    );
  }
}

/**
 * A canonical, sorted, field-fixed text dump of `defs` -- the exact
 * format `server/sim/tests/defs_dump.rs` independently produces from the
 * Rust side's own compiled tables, both checked against the single
 * committed `fixtures/defs-dump.v1.golden` (Quentin's direction: pins
 * that the two parsers agree on every field, mechanically).
 */
export function canonicalDump(defs: Defs): string {
  const lines: string[] = [];
  for (const o of defs.objects) {
    const collider = o.collider
      ? `${o.collider.x0},${o.collider.y0},${o.collider.x1},${o.collider.y1}`
      : "none";
    lines.push(
      `object ${o.key} id=${o.id} height=${o.height} width=${o.width} collider=${collider} window=${o.window}`,
    );
  }
  for (const i of defs.items) {
    lines.push(`item ${i.key} id=${i.id}`);
  }
  for (const r of defs.recipes) {
    const inputs = [...r.inputs].sort().join(",");
    const outputs = [...r.outputs].sort().join(",");
    lines.push(`recipe ${r.key} id=${r.id} inputs=[${inputs}] outputs=[${outputs}]`);
  }
  for (const p of defs.professions) {
    lines.push(`profession ${p.key} id=${p.id}`);
  }
  for (const c of defs.chains) {
    const links = [...c.links].sort().join(",");
    lines.push(`chain ${c.key} id=${c.id} links=[${links}]`);
  }
  for (const b of defs.balance) {
    lines.push(`balance ${b.key} value=${b.value} min=${b.min} max=${b.max}`);
  }
  lines.sort();
  return `${lines.join("\n")}\n`;
}
