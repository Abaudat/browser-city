// The client's own independent parser over `defs/`'s generated JSON asset
// (NFR30, NFR31): deliberately not shared with `tools/defs-build`'s Rust
// parser, but pinned against drifting apart from it by
// `tests/unit/defs/dump-golden.test.ts` (a shared golden both sides
// produce a canonical dump against) and `tests/unit/defs/malformed.test.ts`
// (a shared table of malformed-payload cases both sides must reject) --
// the client must never be quietly lenient about input the module
// rejects at build time.

import { LAYER_TABLE } from "../render/layer-table";
import type {
  AccessoryDef,
  AppearanceLayoutDef,
  AppearanceLayoutRow,
  AtlasPageDef,
  AtlasRect,
  BalanceDef,
  BodyDef,
  ChainDef,
  ColliderRect,
  Defs,
  EyesDef,
  Family,
  HairstyleDef,
  ItemDef,
  ObjectDef,
  OutfitDef,
  Pool,
  ProfessionDef,
  RecipeDef,
  SheetSize,
  Slot,
  SpriteRect,
  TagDef,
  UniformDef,
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

/** Story 2.4 (FR128): the walkability invariant's own vocabulary, not a
 * hard-coded allow-list of object keys -- an object with no `collider`
 * must carry this tag, and an object that carries this tag must not
 * declare a `collider`. A single named constant here and in `tools/
 * defs-build/src/model.rs`'s own copy, never a repeated string literal
 * past either. */
const UNDERFOOT_TAG_KEY = "underfoot";

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

function expectU32Array(value: unknown, path: string): number[] {
  return expectArray(value, path).map((item, i) => expectU32(item, `${path}[${i}]`));
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

function parseSpriteRect(value: unknown, path: string): SpriteRect {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["sheet", "x", "y", "w", "h"], path);
  return {
    sheet: expectString(obj.sheet, `${path}.sheet`),
    x: expectU32(obj.x, `${path}.x`),
    y: expectU32(obj.y, `${path}.y`),
    w: expectU32(obj.w, `${path}.w`),
    h: expectU32(obj.h, `${path}.h`),
  };
}

/** Story 2.6: an object's packed atlas placement -- required, never
 * optional (Tim's direction: an object without one is a build failure,
 * never a runtime fallback to `sprite.sheet`). */
function parseAtlasRect(value: unknown, path: string): AtlasRect {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["page", "x", "y", "w", "h"], path);
  return {
    page: expectU32(obj.page, `${path}.page`),
    x: expectU32(obj.x, `${path}.x`),
    y: expectU32(obj.y, `${path}.y`),
    w: expectU32(obj.w, `${path}.w`),
    h: expectU32(obj.h, `${path}.h`),
  };
}

function parseAtlasPage(value: unknown, path: string): AtlasPageDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["file", "group", "width", "height"], path);
  return {
    file: expectString(obj.file, `${path}.file`),
    group: expectString(obj.group, `${path}.group`),
    width: expectU32(obj.width, `${path}.width`),
    height: expectU32(obj.height, `${path}.height`),
  };
}

function parseObject(value: unknown, path: string): ObjectDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(
    obj,
    [
      "id",
      "key",
      "name",
      "layer",
      "sprite",
      "atlas",
      "width",
      "height",
      "collider",
      "interact_at",
      "window",
      "tags",
    ],
    path,
  );
  const collider = parseNullableCollider(obj.collider, `${path}.collider`);
  const interactAt = parseNullableCollider(obj.interact_at, `${path}.interact_at`);
  const tags = expectU32Array(obj.tags, `${path}.tags`);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    name: expectString(obj.name, `${path}.name`),
    layer: expectU32(obj.layer, `${path}.layer`),
    sprite: parseSpriteRect(obj.sprite, `${path}.sprite`),
    atlas: parseAtlasRect(obj.atlas, `${path}.atlas`),
    width: expectU32(obj.width, `${path}.width`),
    height: expectU32(obj.height, `${path}.height`),
    window: expectBoolean(obj.window, `${path}.window`),
    tags,
    ...(collider ? { collider } : {}),
    ...(interactAt ? { interactAt } : {}),
  };
}

function parseTag(value: unknown, path: string): TagDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key"], path);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
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

function expectFamily(value: unknown, path: string): Family {
  const s = expectString(value, path);
  if (s !== "adult" && s !== "kid") fail(`${path}: expected 'adult' or 'kid', got '${s}'`);
  return s;
}

function expectPool(value: unknown, path: string): Pool {
  const s = expectString(value, path);
  if (s !== "civilian" && s !== "role_only" && s !== "costume") {
    fail(`${path}: expected 'civilian', 'role_only' or 'costume', got '${s}'`);
  }
  return s;
}

function expectSlot(value: unknown, path: string): Slot {
  const s = expectString(value, path);
  if (s !== "face" && s !== "head" && s !== "back" && s !== "torso" && s !== "hands") {
    fail(`${path}: expected 'face', 'head', 'back', 'torso' or 'hands', got '${s}'`);
  }
  return s;
}

function expectNullableString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return expectString(value, path);
}

/** Every appearance part id is stored as a `u16` (`sim::appearance::
 * Appearance` and the `citizen` schema columns): an id above 65535 would
 * silently truncate into a different part at runtime, so the client
 * rejects it at parse time exactly like `tools/defs-build` does. */
const U16_EXCLUSIVE_MAX = 2 ** 16;

function expectAppearanceId(value: unknown, path: string): number {
  const n = expectU32(value, path);
  if (n >= U16_EXCLUSIVE_MAX) {
    fail(`${path}: expected an integer in [0, 2^16) (does not fit in a u16)`);
  }
  return n;
}

/** Id 0 is never a valid declared appearance part id -- it is the
 * runtime "no layer" sentinel, legal only as a generated hairstyle/
 * accessory *value*, never as a declared id. */
function checkAppearanceIdNotZero(id: number, key: string, kind: string): void {
  if (id === 0) {
    fail(`${kind} '${key}' declares id 0 -- 0 is reserved as the runtime "no layer" sentinel`);
  }
}

function parseBody(value: unknown, path: string): BodyDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "family", "sheet", "pool"], path);
  return {
    id: expectAppearanceId(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    family: expectFamily(obj.family, `${path}.family`),
    sheet: expectString(obj.sheet, `${path}.sheet`),
    pool: expectPool(obj.pool, `${path}.pool`),
  };
}

function parseEyes(value: unknown, path: string): EyesDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "family", "sheet", "pool"], path);
  return {
    id: expectAppearanceId(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    family: expectFamily(obj.family, `${path}.family`),
    sheet: expectString(obj.sheet, `${path}.sheet`),
    pool: expectPool(obj.pool, `${path}.pool`),
  };
}

function parseHairstyle(value: unknown, path: string): HairstyleDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "family", "sheet", "style", "color", "rare"], path);
  return {
    id: expectAppearanceId(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    family: expectFamily(obj.family, `${path}.family`),
    sheet: expectString(obj.sheet, `${path}.sheet`),
    style: expectU32(obj.style, `${path}.style`),
    color: expectU32(obj.color, `${path}.color`),
    rare: expectBoolean(obj.rare, `${path}.rare`),
  };
}

function parseOutfit(value: unknown, path: string): OutfitDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "family", "sheet", "pool", "hides_hairstyle"], path);
  return {
    id: expectAppearanceId(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    family: expectFamily(obj.family, `${path}.family`),
    sheet: expectString(obj.sheet, `${path}.sheet`),
    pool: expectPool(obj.pool, `${path}.pool`),
    hidesHairstyle: expectBoolean(obj.hides_hairstyle, `${path}.hides_hairstyle`),
  };
}

function parseAccessory(value: unknown, path: string): AccessoryDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "family", "sheet", "pool", "slot"], path);
  return {
    id: expectAppearanceId(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    family: expectFamily(obj.family, `${path}.family`),
    sheet: expectString(obj.sheet, `${path}.sheet`),
    pool: expectPool(obj.pool, `${path}.pool`),
    slot: expectSlot(obj.slot, `${path}.slot`),
  };
}

function parseAppearanceLayoutRow(value: unknown, path: string): AppearanceLayoutRow {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["animation", "row", "frames_per_direction"], path);
  return {
    animation: expectString(obj.animation, `${path}.animation`),
    row: expectU32(obj.row, `${path}.row`),
    framesPerDirection: expectU32(obj.frames_per_direction, `${path}.frames_per_direction`),
  };
}

function parseSheetSize(value: unknown, path: string): SheetSize {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["width", "height"], path);
  return {
    width: expectU32(obj.width, `${path}.width`),
    height: expectU32(obj.height, `${path}.height`),
  };
}

function parseAppearanceLayout(value: unknown, path: string): AppearanceLayoutDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(
    obj,
    ["id", "key", "family", "cell_width", "cell_height", "directions", "rows", "accepted_sizes"],
    path,
  );
  const rows = expectArray(obj.rows, `${path}.rows`).map((v, i) =>
    parseAppearanceLayoutRow(v, `${path}.rows[${i}]`),
  );
  const acceptedSizes = expectArray(obj.accepted_sizes, `${path}.accepted_sizes`).map((v, i) =>
    parseSheetSize(v, `${path}.accepted_sizes[${i}]`),
  );
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    family: expectFamily(obj.family, `${path}.family`),
    cellWidth: expectU32(obj.cell_width, `${path}.cell_width`),
    cellHeight: expectU32(obj.cell_height, `${path}.cell_height`),
    directions: expectStringArray(obj.directions, `${path}.directions`),
    rows,
    acceptedSizes,
  };
}

function parseUniform(value: unknown, path: string): UniformDef {
  const obj = expectRecord(value, path);
  checkKnownKeys(obj, ["id", "key", "profession", "outfit", "accessory"], path);
  const outfit = expectNullableString(obj.outfit, `${path}.outfit`);
  const accessory = expectNullableString(obj.accessory, `${path}.accessory`);
  return {
    id: expectU32(obj.id, `${path}.id`),
    key: expectString(obj.key, `${path}.key`),
    profession: expectString(obj.profession, `${path}.profession`),
    ...(outfit !== undefined ? { outfit } : {}),
    ...(accessory !== undefined ? { accessory } : {}),
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
      "interact_at_max_reach_cells",
      "max_footprint_cells",
      "atlas_max_pages_per_group",
      "atlas_pages",
      "objects",
      "items",
      "recipes",
      "professions",
      "chains",
      "balance",
      "bodies",
      "eyes",
      "hairstyles",
      "outfits",
      "accessories",
      "appearance_layouts",
      "uniforms",
      "tags",
    ],
    "$",
  );

  const defsVersion = expectString(root.defs_version, "$.defs_version");
  const colliderSubcellsPerCell = expectU32(
    root.collider_subcells_per_cell,
    "$.collider_subcells_per_cell",
  );
  const interactAtMaxReachCells = expectU32(
    root.interact_at_max_reach_cells,
    "$.interact_at_max_reach_cells",
  );
  const maxFootprintCells = expectU32(root.max_footprint_cells, "$.max_footprint_cells");
  const atlasMaxPagesPerGroup = expectU32(
    root.atlas_max_pages_per_group,
    "$.atlas_max_pages_per_group",
  );
  const atlasPages = expectArray(root.atlas_pages, "$.atlas_pages").map((v, i) =>
    parseAtlasPage(v, `$.atlas_pages[${i}]`),
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
  const bodies = expectArray(root.bodies, "$.bodies").map((v, i) => parseBody(v, `$.bodies[${i}]`));
  const eyes = expectArray(root.eyes, "$.eyes").map((v, i) => parseEyes(v, `$.eyes[${i}]`));
  const hairstyles = expectArray(root.hairstyles, "$.hairstyles").map((v, i) =>
    parseHairstyle(v, `$.hairstyles[${i}]`),
  );
  const outfits = expectArray(root.outfits, "$.outfits").map((v, i) =>
    parseOutfit(v, `$.outfits[${i}]`),
  );
  const accessories = expectArray(root.accessories, "$.accessories").map((v, i) =>
    parseAccessory(v, `$.accessories[${i}]`),
  );
  const appearanceLayouts = expectArray(root.appearance_layouts, "$.appearance_layouts").map(
    (v, i) => parseAppearanceLayout(v, `$.appearance_layouts[${i}]`),
  );
  const uniforms = expectArray(root.uniforms, "$.uniforms").map((v, i) =>
    parseUniform(v, `$.uniforms[${i}]`),
  );
  const tags = expectArray(root.tags, "$.tags").map((v, i) => parseTag(v, `$.tags[${i}]`));

  checkNoDuplicateIdsOrKeys(objects, "object");
  checkNoDuplicateIdsOrKeys(items, "item");
  checkNoDuplicateIdsOrKeys(recipes, "recipe");
  checkNoDuplicateIdsOrKeys(professions, "profession");
  checkNoDuplicateIdsOrKeys(chains, "chain");
  checkNoDuplicateIdsOrKeys(bodies, "body");
  checkNoDuplicateIdsOrKeys(eyes, "eyes");
  checkNoDuplicateIdsOrKeys(hairstyles, "hairstyle");
  checkNoDuplicateIdsOrKeys(outfits, "outfit");
  checkNoDuplicateIdsOrKeys(accessories, "accessory");
  checkNoDuplicateIdsOrKeys(appearanceLayouts, "appearance_layout");
  checkNoDuplicateIdsOrKeys(uniforms, "uniform");
  checkNoDuplicateIdsOrKeys(tags, "tag");
  const seenBalanceKeys = new Set<string>();
  for (const entry of balance) {
    if (seenBalanceKeys.has(entry.key)) fail(`duplicate balance key '${entry.key}'`);
    seenBalanceKeys.add(entry.key);
  }

  for (const b of bodies) checkAppearanceIdNotZero(b.id, b.key, "body");
  for (const e of eyes) checkAppearanceIdNotZero(e.id, e.key, "eyes");
  for (const h of hairstyles) checkAppearanceIdNotZero(h.id, h.key, "hairstyle");
  for (const o of outfits) checkAppearanceIdNotZero(o.id, o.key, "outfit");
  for (const a of accessories) checkAppearanceIdNotZero(a.id, a.key, "accessory");
  for (const l of appearanceLayouts) checkAppearanceIdNotZero(l.id, l.key, "appearance_layout");
  for (const u of uniforms) checkAppearanceIdNotZero(u.id, u.key, "uniform");

  const layoutFamilies = new Set<string>();
  for (const layout of appearanceLayouts) {
    if (layoutFamilies.has(layout.family)) {
      fail(
        `appearance_layout '${layout.key}' declares family '${layout.family}' but it is already covered -- exactly one layout per family`,
      );
    }
    layoutFamilies.add(layout.family);
  }
  for (const part of [...bodies, ...eyes, ...hairstyles, ...outfits, ...accessories]) {
    if (!layoutFamilies.has(part.family)) {
      fail(
        `'${part.key}' declares family '${part.family}' but no appearance_layout entry declares that family`,
      );
    }
  }

  const professionKeysForUniforms = new Set(professions.map((p) => p.key));
  const outfitByKey = new Map(outfits.map((o) => [o.key, o]));
  const accessoryByKey = new Map(accessories.map((a) => [a.key, a]));
  const seenUniformProfessions = new Set<string>();
  for (const uniform of uniforms) {
    if (!professionKeysForUniforms.has(uniform.profession)) {
      fail(`uniform '${uniform.key}' names unknown profession '${uniform.profession}'`);
    }
    if (seenUniformProfessions.has(uniform.profession)) {
      fail(
        `uniform '${uniform.key}' duplicates profession '${uniform.profession}' -- exactly one uniform per profession`,
      );
    }
    seenUniformProfessions.add(uniform.profession);
    if (uniform.outfit === undefined && uniform.accessory === undefined) {
      fail(`uniform '${uniform.key}' overrides neither outfit nor accessory`);
    }
    if (uniform.outfit !== undefined) {
      const def = outfitByKey.get(uniform.outfit);
      if (!def) fail(`uniform '${uniform.key}' names unknown outfit '${uniform.outfit}'`);
      else if (def.family !== "adult" || def.pool !== "role_only") {
        fail(
          `uniform '${uniform.key}' names outfit '${uniform.outfit}' which is not an adult role_only outfit`,
        );
      }
    }
    if (uniform.accessory !== undefined) {
      const def = accessoryByKey.get(uniform.accessory);
      if (!def) fail(`uniform '${uniform.key}' names unknown accessory '${uniform.accessory}'`);
      else if (def.family !== "adult" || def.pool !== "role_only") {
        fail(
          `uniform '${uniform.key}' names accessory '${uniform.accessory}' which is not an adult role_only accessory`,
        );
      }
    }
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

  const tileSizePx = balance.find((b) => b.key === "render.tile_size_px")?.value;
  if (objects.length > 0 && tileSizePx === undefined) {
    // A skipped check is a check that passes on bad data (Quentin's
    // direction): a tree with objects but no `render.tile_size_px`
    // balance key cannot check FR126's sprite/footprint agreement at
    // all, exactly like `tools/defs-build`'s own `validate.rs` refuses
    // this case rather than silently skipping it.
    fail(
      "defs/ declares an object but no 'render.tile_size_px' balance key -- FR126's sprite/footprint agreement cannot be checked without it",
    );
  }
  const tagIds = new Set(tags.map((t) => t.id));
  const underfootTagId = tags.find((t) => t.key === UNDERFOOT_TAG_KEY)?.id;
  for (const object of objects) {
    checkObjectName(object);
    checkObjectLayer(object);
    checkObjectFootprintCap(object, maxFootprintCells);
    checkSpriteNonZeroArea(object);
    if (tileSizePx !== undefined) {
      checkSpriteMatchesFootprint(object, tileSizePx);
    }
    checkColliderWithinFootprint(object, colliderSubcellsPerCell);
    checkInteractAtReach(object, colliderSubcellsPerCell, interactAtMaxReachCells);
    checkObjectTags(object, tagIds);
    checkObjectAtlasPage(object, atlasPages.length);
    // Story 2.4: the generic catch-all, checked last -- every other
    // object-level rejection above gets its own chance to fire on a
    // payload built to exercise it before this one does.
    checkObjectWalkabilityTag(object, underfootTagId);
  }

  return {
    defsVersion,
    colliderSubcellsPerCell,
    interactAtMaxReachCells,
    maxFootprintCells,
    atlasMaxPagesPerGroup,
    atlasPages,
    objects,
    items,
    recipes,
    professions,
    chains,
    balance,
    bodies,
    eyes,
    hairstyles,
    outfits,
    accessories,
    appearanceLayouts,
    uniforms,
    tags,
  };
}

/** Story 2.6: `atlas.page` must index a real entry in `atlasPages` -- a
 * skipped check here is a check that passes on bad data, same as every
 * other cross-reference below. */
function checkObjectAtlasPage(object: ObjectDef, atlasPageCount: number): void {
  if (object.atlas.page >= atlasPageCount) {
    fail(
      `object '${object.key}' names atlas page ${object.atlas.page} but only ${atlasPageCount} page(s) exist`,
    );
  }
}

/** A free-text display string (story 2.2) -- never empty. */
function checkObjectName(object: ObjectDef): void {
  if (object.name.trim().length === 0) {
    fail(`object '${object.key}' has an empty name`);
  }
}

/** `layer` resolves against `render/layer-table.ts` -- the client's own
 * golden-guarded mirror of `sim::codes::layer`
 * (`check-layer-table-current.sh`) -- exactly like `tools/defs-build`'s
 * own `validate.rs` resolves the authored name against the codes golden.
 * The runtime artefact carries only the numeric code, never the name, so
 * this is a lookup, not a string comparison -- but an unknown or
 * deprecated code must still be refused here, never accepted just
 * because it parsed as a `u32` (Quentin's direction: a skipped check is a
 * check that passes on bad data). */
function checkObjectLayer(object: ObjectDef): void {
  const row = LAYER_TABLE.find((r) => r.code === object.layer);
  if (!row) {
    const known = LAYER_TABLE.filter((r) => !r.deprecated)
      .map((r) => r.code)
      .join(", ");
    fail(
      `object '${object.key}' names unknown layer code ${object.layer} -- known codes are [${known}]`,
    );
  }
  if (row.deprecated) {
    fail(`object '${object.key}' names deprecated layer code ${object.layer} ('${row.name}')`);
  }
}

/** Story 2.10 (FR111): every tag id an object names must be a real row in
 * `Defs.tags`, exactly like `tools/defs-build`'s own `validate.rs`
 * resolves the same reference at build time -- the rule engine's only
 * vocabulary is never a dangling id past this point. */
function checkObjectTags(object: ObjectDef, tagIds: ReadonlySet<number>): void {
  for (const tag of object.tags) {
    if (!tagIds.has(tag)) {
      fail(`object '${object.key}' names unknown tag id ${tag}`);
    }
  }
}

/** FR128's other half (story 2.4): absence of a collider is walkability,
 * but that absence must be *declared* -- every object either blocks (a
 * `collider`) or is explicitly walkable (the `underfoot` tag), never
 * neither and never both. `underfootTagId` is `undefined` when this
 * defs tree declares no `underfoot` tag at all, in which case no object
 * could ever legitimately carry it. */
function checkObjectWalkabilityTag(object: ObjectDef, underfootTagId: number | undefined): void {
  const isUnderfoot = underfootTagId !== undefined && object.tags.includes(underfootTagId);
  if (!object.collider && !isUnderfoot) {
    fail(
      `object '${object.key}' has no collider and is not tagged '${UNDERFOOT_TAG_KEY}' -- every prop either blocks (a collider) or is explicitly walkable (the '${UNDERFOOT_TAG_KEY}' tag); add one`,
    );
  }
  if (object.collider && isUnderfoot) {
    fail(
      `object '${object.key}' declares both a collider and the '${UNDERFOOT_TAG_KEY}' tag -- an object cannot both block and be explicitly walkable`,
    );
  }
}

/** FR127's cap, checked on `width` and `height` independently, exactly
 * like `tools/defs-build`'s own `validate.rs` -- the error names the
 * object and its size, and directs the author to compose the structure
 * from multiple objects (the acceptance criterion's own sentence). Also
 * refuses a footprint width or height of 0 -- every object occupies at
 * least one cell. */
function checkObjectFootprintCap(object: ObjectDef, maxFootprintCells: number): void {
  if (object.width === 0 || object.height === 0) {
    fail(
      `object '${object.key}' has a footprint width or height of 0 -- every object occupies at least one cell`,
    );
  }
  if (object.width > maxFootprintCells) {
    fail(
      `object '${object.key}' footprint width ${object.width} exceeds MAX_FOOTPRINT_CELLS (${maxFootprintCells}) -- compose the structure from multiple objects`,
    );
  }
  if (object.height > maxFootprintCells) {
    fail(
      `object '${object.key}' footprint height ${object.height} exceeds MAX_FOOTPRINT_CELLS (${maxFootprintCells}) -- compose the structure from multiple objects`,
    );
  }
}

/** A sprite rect must have positive area -- checked independently of
 * whether its sheet's real dimensions are known, exactly like `tools/
 * defs-build`'s own `validate.rs`. */
function checkSpriteNonZeroArea(object: ObjectDef): void {
  if (object.sprite.w === 0 || object.sprite.h === 0) {
    fail(`object '${object.key}' sprite rect has zero width or height`);
  }
}

/** FR126's decomposition reads per-cell sub-rects from the sprite, so the
 * sprite must agree with the footprint exactly, the same three checks
 * `tools/defs-build`'s own `validate.rs` enforces at build time: `w`
 * equals `width * tileSizePx` exactly, `h` is a whole multiple of
 * `tileSizePx`, and `h >= height * tileSizePx` (a tall prop may overhang
 * upward, never downward -- bottom-anchored). */
function checkSpriteMatchesFootprint(object: ObjectDef, tileSizePx: number): void {
  const sprite = object.sprite;
  const expectedW = object.width * tileSizePx;
  if (sprite.w !== expectedW) {
    fail(
      `object '${object.key}' sprite width ${sprite.w} does not equal its footprint width ${object.width} * tile_size_px ${tileSizePx} (${expectedW}px)`,
    );
  }
  if (sprite.h % tileSizePx !== 0) {
    fail(
      `object '${object.key}' sprite height ${sprite.h} is not a whole multiple of tile_size_px ${tileSizePx}`,
    );
  }
  const minH = object.height * tileSizePx;
  if (sprite.h < minH) {
    fail(
      `object '${object.key}' sprite height ${sprite.h} is shorter than its footprint height ${object.height} * tile_size_px ${tileSizePx} (${minH}px)`,
    );
  }
}

/** FR128's containment rule (`inv_collider_within_footprint`): a declared
 * `collider` must have positive area and fit entirely inside its own
 * object's footprint, sized `width*colliderSubcellsPerCell x
 * height*colliderSubcellsPerCell` sub-cells -- the exact rule `tools/
 * defs-build`'s own `validate.rs` enforces at build time, checked again
 * here so the client is never quietly lenient about data it did not
 * build itself.
 *
 * Story 2.4 AC3's "collider within sprite bounds" needs no separate
 * check: `checkSpriteMatchesFootprint` already fixes the sprite to
 * exactly the footprint's own extent, so a collider contained in the
 * footprint is always contained in the sprite -- a collider outside the
 * sprite is therefore always outside the footprint, and is refused right
 * here, never a duplicate check. */
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
    // Tim's direction: both rectangles, collider and footprint, in the
    // same unit (sub-cells), in a fixed order -- comparable by eye.
    fail(
      `object '${object.key}' collider (${c.x0}, ${c.y0})-(${c.x1}, ${c.y1}) does not fit inside its footprint (0, 0)-(${maxX}, ${maxY}) sub-cells`,
    );
  }
}

/** FR148's reach rules (story 1.9), the exact three `tools/defs-build`'s
 * own `validate.rs` enforces at build time, checked again here so the
 * client is never quietly lenient about data it did not build itself: a
 * declared `interactAt` has positive area, reaches no further than
 * `interactAtMaxReachCells` beyond its own footprint on any side, and --
 * when the object also declares a `collider` -- never lies entirely
 * inside it (a player can never stand inside a collider, so such a rect
 * could never be reached). */
function checkInteractAtReach(
  object: ObjectDef,
  colliderSubcellsPerCell: number,
  interactAtMaxReachCells: number,
): void {
  const r = object.interactAt;
  if (!r) return;
  if (r.x1 <= r.x0 || r.y1 <= r.y0) {
    fail(
      `object '${object.key}' interact_at (${r.x0}, ${r.y0})-(${r.x1}, ${r.y1}) has zero or negative area`,
    );
  }
  const reach = interactAtMaxReachCells * colliderSubcellsPerCell;
  const maxX = object.width * colliderSubcellsPerCell;
  const maxY = object.height * colliderSubcellsPerCell;
  if (r.x0 < -reach || r.y0 < -reach || r.x1 > maxX + reach || r.y1 > maxY + reach) {
    fail(
      `object '${object.key}' interact_at (${r.x0}, ${r.y0})-(${r.x1}, ${r.y1}) reaches further than ${interactAtMaxReachCells} cell(s) beyond its own ${object.width}x${object.height} footprint`,
    );
  }
  const c = object.collider;
  if (c && r.x0 >= c.x0 && r.y0 >= c.y0 && r.x1 <= c.x1 && r.y1 <= c.y1) {
    fail(
      `object '${object.key}' interact_at (${r.x0}, ${r.y0})-(${r.x1}, ${r.y1}) lies entirely inside its own collider (${c.x0}, ${c.y0})-(${c.x1}, ${c.y1}) -- it could never be reached`,
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
  const rect = (r: ColliderRect | undefined): string =>
    r ? `${r.x0},${r.y0},${r.x1},${r.y1}` : "none";
  for (const o of defs.objects) {
    const tags = [...o.tags].sort((a, b) => a - b).join(",");
    lines.push(
      `object ${o.key} id=${o.id} name=${o.name} layer=${o.layer} sprite=${o.sprite.sheet}:${o.sprite.x},${o.sprite.y},${o.sprite.w},${o.sprite.h} height=${o.height} width=${o.width} collider=${rect(o.collider)} interact_at=${rect(o.interactAt)} window=${o.window} tags=[${tags}]`,
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
  for (const b of defs.bodies) {
    lines.push(`body ${b.key} id=${b.id} family=${b.family} pool=${b.pool} sheet=${b.sheet}`);
  }
  for (const e of defs.eyes) {
    lines.push(`eyes ${e.key} id=${e.id} family=${e.family} pool=${e.pool} sheet=${e.sheet}`);
  }
  for (const h of defs.hairstyles) {
    lines.push(
      `hairstyle ${h.key} id=${h.id} family=${h.family} sheet=${h.sheet} style=${h.style} color=${h.color} rare=${h.rare}`,
    );
  }
  for (const o of defs.outfits) {
    lines.push(
      `outfit ${o.key} id=${o.id} family=${o.family} sheet=${o.sheet} pool=${o.pool} hides_hairstyle=${o.hidesHairstyle}`,
    );
  }
  for (const a of defs.accessories) {
    lines.push(
      `accessory ${a.key} id=${a.id} family=${a.family} sheet=${a.sheet} pool=${a.pool} slot=${a.slot}`,
    );
  }
  for (const l of defs.appearanceLayouts) {
    const directions = l.directions.join(",");
    const rows = l.rows.map((r) => `${r.animation}:${r.row}:${r.framesPerDirection}`).join(",");
    const acceptedSizes = l.acceptedSizes.map((s) => `${s.width}x${s.height}`).join(",");
    lines.push(
      `appearance_layout ${l.key} id=${l.id} family=${l.family} cell_width=${l.cellWidth} cell_height=${l.cellHeight} directions=[${directions}] rows=[${rows}] accepted_sizes=[${acceptedSizes}]`,
    );
  }
  for (const u of defs.uniforms) {
    lines.push(
      `uniform ${u.key} id=${u.id} profession=${u.profession} outfit=${u.outfit ?? "none"} accessory=${u.accessory ?? "none"}`,
    );
  }
  for (const t of defs.tags) {
    lines.push(`tag ${t.key} id=${t.id}`);
  }
  lines.sort();
  return `${lines.join("\n")}\n`;
}
