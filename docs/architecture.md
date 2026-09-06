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

The published module runs with `overflow-checks` and `debug-assertions` on
(`server/Cargo.toml`'s `[profile.release]`, the profile `spacetime build`
uses): a `debug_assert!` is a production abort, not a test-only aid, and a
wrapping-arithmetic bug aborts the reducer rather than writing inconsistent
state (NFR41).

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

Agent tooling — declared in `.mcp.json` and `.claude/settings.json`, first-party only:

| Tool | Provided as | Pinned version | Notes |
| --- | --- | --- | --- |
| `spacetimedb` | `spacetime mcp` CLI subcommand, `.mcp.json` | CLI 2.9.0 | `--server local` only, never Maincloud; database name comes from the local spacetime config, never hard-coded |
| `context7` | hosted HTTP MCP, `.mcp.json` | hosted endpoint, no local version to pin | needs `${CONTEXT7_API_KEY}`; a lookup tool, never a source of truth over this file or `docs/requirements.md` |
| `spacetimedb@spacetimedb-plugins` | Claude plugin marketplace `clockworklabs/SpacetimeDB`, `.claude/settings.json` | tag `v2.9.0`, commit `9e0d92412ff2248f401a8ad12d535f2b5ac30912` | official skills for CLI/module/client development plus its own bundled MCP entry, superseded by this file's `spacetimedb` entry (project scope beats plugin scope) |
| `pixijs-skills@pixijs-skills` | Claude plugin marketplace `pixijs/pixijs-skills`, `.claude/settings.json` | commit `6aae70d76cf410432dd144029c07a1ad4bb12793` (no tagged release exists) | official PixiJS v8 rendering skills |