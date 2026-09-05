# Architecture

The technologies and the rules for using them. Requirements live in `docs/requirements.md` and are
cited here by identifier.

## Stack


| Part                          | Technology                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server module                 | Rust, edition 2024, `crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`                           |
| Server, database, replication | SpacetimeDB 2.9.x — the `spacetimedb` crate                                                              |
| Hosting                       | SpacetimeDB Maincloud                                                                                    |
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