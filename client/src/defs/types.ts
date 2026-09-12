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

export interface Defs {
  readonly defsVersion: string;
  /** Sub-cells per cell, the fixed unit every `ObjectDef.collider` is
   * declared in (story 1.8) -- generated once by `tools/defs-build` into
   * both artefacts, never a client-side literal. */
  readonly colliderSubcellsPerCell: number;
  readonly objects: readonly ObjectDef[];
  readonly items: readonly ItemDef[];
  readonly recipes: readonly RecipeDef[];
  readonly professions: readonly ProfessionDef[];
  readonly chains: readonly ChainDef[];
  readonly balance: readonly BalanceDef[];
}
