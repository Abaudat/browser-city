// The client's own plain shapes for `defs/`'s generated JSON asset
// (NFR31). Field names are `snake_case`, matching the Rust side field for
// field -- "Data keys: snake_case, matches Rust, so no translation layer"
// (docs/architecture.md's naming table) -- deliberately not the
// `camelCase` this file's own variables use.

/** A half-open integer rect in sub-cells, relative to the footprint's own
 * north-west sub-cell origin (its top-left, matching the sprite's own
 * pixel space) -- not the same thing as the *anchor cell* a placed row's
 * `x`/`y` names, which is the footprint's smallest x, largest y cell (its
 * south-west corner, story 2.2's AC); the two only coincide for a
 * one-cell-tall object, which is every object today. `defs/`'s own unit,
 * `COLLIDER_SUBCELLS_PER_CELL` sub-cells per cell, never tied to
 * `render.tile_size_px`. */
export interface ColliderRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One whole-object sprite rectangle (story 2.2): the tileset ships whole
 * objects as single PNGs, so this is always one rectangle, never a
 * composited set. `sheet` is a path relative to the repo root, under
 * `ModernTileset/`; `x`/`y`/`w`/`h` are whole source pixels. */
export interface SpriteRect {
  readonly sheet: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One packed atlas page placement (story 2.6): `page` indexes
 * `Defs.atlasPages`; `x`/`y`/`w`/`h` are the object's whole sprite, in
 * page pixels, the 1px gutter excluded. JSON-only, exactly like every
 * field on this type -- the server never learns a page exists. */
export interface AtlasRect {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One packed atlas page (story 2.6): `file` is a content-hashed filename
 * under `client/public/atlas/`, `group` is the theme-sorter-derived key
 * every object on this page shares. */
export interface AtlasPageDef {
  readonly file: string;
  readonly group: string;
  readonly width: number;
  readonly height: number;
}

export interface ObjectDef {
  readonly id: number;
  readonly key: string;
  /** A free-text display string (story 2.2) -- never a lookup key; `key`
   * stays the lookup. */
  readonly name: string;
  /** The resolved `sim::codes::layer` numeric code (FR123) -- the runtime
   * artefact only ever carries the resolved code, never the authored
   * name. */
  readonly layer: number;
  readonly sprite: SpriteRect;
  /** Story 2.6: where this object's sprite lives in a packed atlas page --
   * required, never optional (an object without one is a build failure,
   * never a runtime fallback to `sprite.sheet`). */
  readonly atlas: AtlasRect;
  readonly width: number;
  readonly height: number;
  /** Absent means walkable (FR128) -- there is no separate `walkable`
   * flag anywhere. */
  readonly collider?: ColliderRect;
  /** Story 1.9 (FR148): where a player must stand for this object to be
   * interactable -- the same half-open sub-cell rect a `collider` uses,
   * relative to the same anchor cell, but allowed to reach outside the
   * footprint (up to `Defs.interactAtMaxReachCells` on every side).
   * Absent means this object declares no interaction at all -- there is
   * no separate `interactable` flag anywhere. */
  readonly interactAt?: ColliderRect;
  /** Story 1.7 (FR121): a window wall tile draws semi-transparently
   * (`render.window_alpha`) and retracts like any other front wall. */
  readonly window: boolean;
  /** Story 2.10 (FR111): the rule engine's own vocabulary -- resolved tag
   * ids, each naming a row in `Defs.tags`. Absent (or empty) means this
   * object carries no tags. */
  readonly tags: readonly number[];
}

/** A role tag's own payload (story 2.9, FR119): the closed list of
 * resolved `sim::codes::layer` codes an object carrying this role may
 * sit on -- resolved codes, never authored names, exactly like
 * `ObjectDef.layer`. */
export interface RoleDef {
  readonly layers: readonly number[];
}

/** One `defs/tags/*.toml` row (story 2.10, FR111) -- the rule engine's
 * only vocabulary. The client never evaluates a rule (rule rows never
 * reach this artefact, Tim's direction), but it does validate that every
 * `ObjectDef.tags` entry names a real row here, exactly like `layer`
 * resolves against the layer table. `role` (story 2.9) is present when
 * this tag is a role -- every `ObjectDef` must carry exactly one
 * role-bearing tag, and its own `layer` must be among that role's own
 * `layers`. */
export interface TagDef {
  readonly id: number;
  readonly key: string;
  readonly role?: RoleDef;
}

export interface ItemDef {
  readonly id: number;
  readonly key: string;
  /** A `sim::codes::unit` code (never a name). */
  readonly unit: number;
  /** Minutes until an instance spoils; 0 means it never does. */
  readonly shelfLifeMinutes: number;
  /** The item's world footprint, in whole cells (FR94). */
  readonly width: number;
  readonly height: number;
}

export interface RecipeDef {
  readonly id: number;
  readonly key: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

export interface ProfessionDef {
  readonly id: number;
  readonly key: string;
}

export interface ChainDef {
  readonly id: number;
  readonly key: string;
  readonly links: readonly string[];
}

export interface BalanceDef {
  readonly key: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

/** Which family of parts an appearance part belongs to (FR61) -- a layout
 * is only ever shared *within* one family. */
export type Family = "adult" | "kid";

/** Which pool a part is drawn from. `civilian` is eligible for random
 * generation; `role_only` is reserved for a `UniformDef` override;
 * `costume` is dead content until a future system gives it a reason to
 * exist. */
export type Pool = "civilian" | "role_only" | "costume";

/** Where on the body an accessory sits. A uniform accessory override
 * removes the citizen's own civilian accessory only when both share a
 * slot; otherwise it draws as an additional layer. */
export type Slot = "face" | "head" | "back" | "torso" | "hands";

export interface BodyDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly pool: Pool;
  /** Story 2.7: where this part's own packed compact strip lives in a
   * packed `character_body` atlas page -- required, never optional,
   * exactly like `ObjectDef.atlas` (Tim's direction). JSON-only: `sheet`
   * stays the authoring input in both artefacts, `atlas` is JSON-only. */
  readonly atlas: AtlasRect;
}

export interface EyesDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly pool: Pool;
  readonly atlas: AtlasRect;
}

export interface HairstyleDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly style: number;
  readonly color: number;
  readonly rare: boolean;
  readonly atlas: AtlasRect;
}

export interface OutfitDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly pool: Pool;
  /** The frog/tiger kid pyjamas hide the hairstyle layer while worn. */
  readonly hidesHairstyle: boolean;
  readonly atlas: AtlasRect;
}

export interface AccessoryDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly pool: Pool;
  readonly slot: Slot;
  readonly atlas: AtlasRect;
}

export interface AppearanceLayoutRow {
  readonly animation: string;
  readonly row: number;
  readonly framesPerDirection: number;
}

export interface SheetSize {
  readonly width: number;
  readonly height: number;
}

export interface AppearanceLayoutDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly directions: readonly string[];
  readonly rows: readonly AppearanceLayoutRow[];
  readonly acceptedSizes: readonly SheetSize[];
}

/** A profession's fixed uniform override for the outfit and/or accessory
 * layer (FR62) -- never a stored part of a citizen's own appearance
 * tuple, applied only at render time. */
export interface UniformDef {
  readonly id: number;
  readonly key: string;
  readonly profession: string;
  readonly outfit?: string;
  readonly accessory?: string;
}

export interface Defs {
  readonly defsVersion: string;
  /** Sub-cells per cell, the fixed unit every `ObjectDef.collider` is
   * declared in (story 1.8) -- generated once by `tools/defs-build` into
   * both artefacts, never a client-side literal. */
  readonly colliderSubcellsPerCell: number;
  /** How far beyond its own footprint an `interactAt` rect may reach, in
   * whole cells (story 1.9) -- generated once by `tools/defs-build` into
   * both artefacts, never a client-side literal. */
  readonly interactAtMaxReachCells: number;
  /** FR127's cap: a footprint's `width` and `height` are each held to
   * this -- generated once by `tools/defs-build` into both artefacts,
   * never a client-side literal. */
  readonly maxFootprintCells: number;
  /** The longest an item may take to spoil, in minutes -- generated once
   * by `tools/defs-build`, never a client-side literal. */
  readonly maxShelfLifeMinutes: number;
  /** NFR12's build-time cap, emitted alongside `maxFootprintCells` --
   * never a client-side literal. */
  readonly atlasMaxPagesPerGroup: number;
  /** Story 2.7 (Tim's direction): the fixed number of shared, canvas-
   * backed composite pages every character look is drawn into -- never a
   * client-side literal. Part of NFR12's own three-term bound-pages rule. */
  readonly characterCompositePages: number;
  readonly atlasPages: readonly AtlasPageDef[];
  readonly objects: readonly ObjectDef[];
  readonly items: readonly ItemDef[];
  readonly recipes: readonly RecipeDef[];
  readonly professions: readonly ProfessionDef[];
  readonly chains: readonly ChainDef[];
  readonly balance: readonly BalanceDef[];
  readonly bodies: readonly BodyDef[];
  readonly eyes: readonly EyesDef[];
  readonly hairstyles: readonly HairstyleDef[];
  readonly outfits: readonly OutfitDef[];
  readonly accessories: readonly AccessoryDef[];
  readonly appearanceLayouts: readonly AppearanceLayoutDef[];
  readonly uniforms: readonly UniformDef[];
  readonly tags: readonly TagDef[];
}
