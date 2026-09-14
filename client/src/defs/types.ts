// The client's own plain shapes for `defs/`'s generated JSON asset
// (NFR31). Field names are `snake_case`, matching the Rust side field for
// field -- "Data keys: snake_case, matches Rust, so no translation layer"
// (docs/architecture.md's naming table) -- deliberately not the
// `camelCase` this file's own variables use.

/** A half-open integer rect in sub-cells, relative to the footprint's
 * top-left anchor cell (FR128) -- `defs/`'s own unit,
 * `COLLIDER_SUBCELLS_PER_CELL` sub-cells per cell, never tied to
 * `render.tile_size_px`. */
export interface ColliderRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ObjectDef {
  readonly id: number;
  readonly key: string;
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
}

export interface ItemDef {
  readonly id: number;
  readonly key: string;
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

/** Story 1.10 (FR61): which family of parts an appearance part belongs to
 * -- a layout is only ever shared *within* one family. */
export type Family = "adult" | "kid";

/** Story 1.10 (Artie's direction): which pool a part is drawn from.
 * `civilian` is eligible for random generation; `role_only` is reserved
 * for a `UniformDef` override; `costume` is dead content until a future
 * system gives it a reason to exist. */
export type Pool = "civilian" | "role_only" | "costume";

export interface BodyDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
}

export interface EyesDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
}

export interface HairstyleDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly style: number;
  readonly color: number;
  readonly rare: boolean;
}

export interface OutfitDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly pool: Pool;
  /** Story 1.10 (Tim's direction): the frog/tiger kid pyjamas hide the
   * hairstyle layer while worn. */
  readonly hidesHairstyle: boolean;
}

export interface AccessoryDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly sheet: string;
  readonly pool: Pool;
}

export interface AppearanceLayoutRow {
  readonly animation: string;
  readonly row: number;
  readonly framesPerDirection: number;
}

export interface AppearanceLayoutDef {
  readonly id: number;
  readonly key: string;
  readonly family: Family;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly directions: readonly string[];
  readonly rows: readonly AppearanceLayoutRow[];
}

/** Story 1.10 (FR62, Artie's direction): a profession's fixed uniform
 * override for the outfit and/or accessory layer -- never a stored part of
 * a citizen's own appearance tuple, applied only at render time. */
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
}
