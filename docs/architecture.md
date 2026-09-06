# Architecture

The technologies and the rules for using them. Requirements live in `docs/requirements.md` and are
cited here by identifier.

## Stack


| Part                          | Technology                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server module                 | Rust, edition 2024, `crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`                           |
| Server, database, replication | SpacetimeDB 2.9.x — the `spacetimedb` crate                                                              |
| Server workspace              | `server/` is a Cargo workspace: `sim` (pure logic), `bounds` (the table-bounds registry), and the `browser_city` module crate, which depends on both |
| Property testing              | `proptest`, dev-dependency of `sim` only; case count from `PROPTEST_CASES`                              |
| Hosting                       | SpacetimeDB Maincloud                                                                                    |
| CI / deploy                   | GitHub Actions is the only path to Maincloud; never a local `spacetime publish` |
| Client                        | TypeScript + PixiJS v8, bundled by Vite                                                                  |
| Client SDK                    | the `spacetimedb` npm package                                                                            |
| Client bindings               | `spacetime generate --lang typescript --out-dir client/src/net/bindings` — generated, never hand-written |
| Rendering                     | PixiJS WebGPU with WebGL fallback; `@pixi/tilemap` for tile layers                                       |
| Audio                         | Web Audio directly, or a thin wrapper                                                                    |
| Art source                    | `ModernTileset/` — whole-object PNGs, nothing pre-split                                                  |


## Authority

Authority follows consequence: what cannot change the ledger runs client-side.


| Concern                                        | Side                               |
| ---------------------------------------------- | ---------------------------------- |
| The ledger, all records                        | Server                             |
| L1 boundary, L2 citizen brain, citizen routing | Server                             |
| Player movement and player collision           | Client, authoritative, unvalidated |
| L3 micro brain, rendering, animation, audio    | Client                             |

## Purity and determinism

`sim` never depends on `spacetimedb` (or anything that touches a network,
the filesystem, or the wall clock) and never will (NFR28) — `reducers/`
reads tables, calls `sim`, writes tables. `sim` is integer/fixed-point only,
uses ordered collections (`BTreeMap`/`BTreeSet`, never `HashMap`/`HashSet`),
and seeds its own PRNG (`sim::rng`, xoshiro256++ via splitmix64 — never
`rand`) from stable ids, never from a local source (NFR25, NFR26). Its
determinism is pinned by a committed golden vector, keyed by
`sim::rng::RNG_VERSION`; the golden and the version move together.

`browser_city` cannot be linked natively, so anything requiring a native
test lives in `sim` or `bounds`.

Every table declares a bound in the `bounds` crate's `TABLE_BOUNDS`
registry, mechanical or engineering (NFR37).

## Naming


| Element                            | Convention             | Example                               |
| ---------------------------------- | ---------------------- | ------------------------------------- |
| Rust modules, functions, fields    | `snake_case`           | `score_matter`                        |
| Rust types                         | `PascalCase`           | `MatterKind`                          |
| TypeScript files                   | `kebab-case.ts`        | `sort-key.ts`                         |
| TypeScript types and classes       | `PascalCase`           | `CollisionGrid`                       |
| TypeScript functions and variables | `camelCase`            | `deriveCitizenPosition`               |
| Files in `defs/`                   | `kebab-case`           | `city-props.toml`                     |
| Data keys                          | `snake_case`           | matches Rust, so no translation layer |
| Balance keys                       | dotted `snake_case`    | `citizen.bar_decay.rest`              |
| Table names                        | `snake_case`, singular | `citizen_state`                       |

## Toolchain


| Prerequisite    | Notes                                                          |
| --------------- | -------------------------------------------------------------- |
| Rust via rustup | with `rustup target add wasm32-unknown-unknown`                |
| SpacetimeDB CLI | `spacetime dev` for hot reload, `spacetime publish` to release |
| Node.js         | client build                                                   |