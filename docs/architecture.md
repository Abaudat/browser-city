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
| Schema-snapshot serialization | `serde`/`serde_json`, dependency of `bounds` only — native-only, never reaches the published wasm         |
| Hosting                       | SpacetimeDB Maincloud                                                                                    |
| CI / deploy                   | GitHub Actions is the only path to Maincloud; never a local `spacetime publish` |
| Client                        | TypeScript + PixiJS v8, bundled by Vite                                                                  |
| Client SDK                    | the `spacetimedb` npm package                                                                            |
| Client bindings               | `spacetime generate --lang typescript --out-dir client/src/net/bindings` — generated, never hand-written |
| Client lint/format            | Biome                                                                                                    |
| Client hosting                | GitHub Pages, deployed by CI on push to master                                                          |
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

## Schema

Fix the permanent decisions first. In SpacetimeDB a primary key and a
unique constraint are permanent, and a normal table can never become a
scheduled one (NFR33, NFR34) — everything else in the schema is additive
and just-in-time. So:

- Every entity table has a surrogate `u64` primary key, `#[primary_key]
  #[auto_inc]` — never composite, never a `String`, never an `Identity`,
  never a natural key. The one exception is a table sharing another
  table's id on purpose (NFR35's narrowness split, e.g. hot state keyed to
  its static row's id).
- A unique constraint is declared only where a real invariant demands it,
  documented in the column's own doc comment. FR142/D5's
  `character`/`character_identity` mapping is the canonical example:
  `identity` is `#[unique]` (an identity reaches at most one character);
  `character_id` is a plain index, not unique (one character, N
  identities).
- Tables are private by default; `public` is added only once the client
  demonstrably reads a table, and the generated bindings are regenerated
  in the same PR (`check-bindings-current.sh`).
- An extensible set (NFR36) is a `u32` code plus a companion data table,
  never a Rust enum, so a new variant is a row insert rather than a
  migration. Seeding is idempotent and lives in an explicit `reseed_codes`
  reducer (called from `init`, and re-callable by hand) rather than on a
  hot lifecycle path — publishing a module that adds a code is followed by
  calling `reseed_codes`, which is the deploy work's job to automate.
- An operator-facing reducer (`reseed_codes` is the first) is never left
  open to any caller: `init` records the publishing identity in the
  one-row `module_owner` table, and the reducer rejects any other caller
  via `tables::ops::require_owner`. The next operator reducer (a balance
  reload, a world fixup) copies this, not a fresh ad hoc check.
- One scheduled table per system that owns a cadence (NFR34), declared
  even before it is used, each with a scheduler-only reducer stub (rejects
  any `ctx.sender() != ctx.database_identity()`) — never one shared tick
  table.
- Static description and hot state never share a table (NFR35): what
  rewrites at a different frequency, or would need wholesale replacement
  independently, lives in its own table from the first commit.
- `server/schema.snapshot.json` (generated by `bounds`'s
  `regen-schema-snapshot` binary, kept current by
  `bounds/tests/schema_snapshot_current.rs`) pins every table's shape,
  column order included. `scripts/ci/check-schema-additive.sh` diffs it
  against the PR's merge base and fails on a moved primary key, a moved
  unique constraint, a changed scheduled status, a removed/retyped/reordered
  column, or a column appended without `#[default(...)]` or `#[auto_inc]`.
  `scripts/ci/check-live-migration.sh` proves the positive and negative
  halves of that last rule against a real local SpacetimeDB instance.
  A code's number in `sim::codes` is as permanent as a primary key;
  `scripts/ci/check-codes-append-only.sh` diffs
  `sim/tests/goldens/codes_*.golden` the same way.

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
| SpacetimeDB CLI default server | `spacetime server set-default local`, so a flagless `spacetime mcp` also resolves to `local` |
| Node.js         | 22.x, pinned in `client/.nvmrc`; client build                  |

Agent tooling — declared in `.mcp.json` and `.claude/settings.json`, first-party only:

<!-- bc:agent-tooling:start -->
| Tool | Provided as | Pinned version | Notes |
| --- | --- | --- | --- |
| `spacetimedb` | `spacetime mcp` CLI subcommand, `.mcp.json` | 2.9.* | `--server local` explicit; database name from the local spacetime config, never hard-coded; approved via `enabledMcpjsonServers`, not an interactive prompt |
| `context7` | hosted HTTP MCP, `.mcp.json` | hosted, unpinnable | needs `${CONTEXT7_API_KEY}`, degrades to unauthenticated if unset; a lookup tool, never a source of truth over this file or `docs/requirements.md`; approved via `enabledMcpjsonServers` |
| `spacetimedb@spacetimedb-plugins` | Claude plugin marketplace `clockworklabs/SpacetimeDB`, `.claude/settings.json` | v2.9.0 | its bundled `spacetime mcp` (no `--server` flag) is blocked by `deniedMcpServers`' `serverCommand: ["spacetime", "mcp"]`, an exact match read from that tag's `.claude-plugin/marketplace.json` on 2026-09-07; only its skills load; re-read that file and update this row and the deny entry together whenever `ref` bumps |
| `pixijs-skills@pixijs-skills` | Claude plugin marketplace `pixijs/pixijs-skills`, `.claude/settings.json` | floating on `main` | official PixiJS v8 rendering skills |
<!-- bc:agent-tooling:end -->
