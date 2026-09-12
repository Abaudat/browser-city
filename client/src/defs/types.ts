// The client's own plain shapes for `defs/`'s generated JSON asset
// (NFR31). Field names are `snake_case`, matching the Rust side field for
// field -- "Data keys: snake_case, matches Rust, so no translation layer"
// (docs/architecture.md's naming table) -- deliberately not the
// `camelCase` this file's own variables use.

export interface ObjectDef {
  readonly id: number;
  readonly key: string;
  readonly width: number;
  readonly height: number;
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
  readonly objects: readonly ObjectDef[];
  readonly items: readonly ItemDef[];
  readonly recipes: readonly RecipeDef[];
  readonly professions: readonly ProfessionDef[];
  readonly chains: readonly ChainDef[];
  readonly balance: readonly BalanceDef[];
}
