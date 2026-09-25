# `defs/` -- for an agent extending the rule set

This file is agent-facing documentation, not a def -- it plays no part in
`defs-build`'s own parse, though it still folds into `defs_version` like
every other tracked file here. It exists so an agent adding a rule never
has to read source to find the corpus.

## Rule kinds

A rule kind is one of five closed shapes under `defs/rules/*.toml`:
`[[placement]]`, `[[distribution]]`, `[[coherence]]`, `[[adjacency]]`,
`[[requirement]]`. Each row names real tags (`defs/tags/*.toml`) and
carries a permanent `id`/`key`. `sim::rules::evaluate` is the one
evaluator; see `docs/architecture.md`'s "Rules" section for the full
grammar of each kind.

## Building types

`defs/building-types/*.toml` (story 3.4, FR116): what a generated
envelope *is* -- `sim::generation::building_types` reads this kind, never
a Rust enum. A row: permanent `id`/`key`; `tags` (real tags, like an
object's own); `land_uses` (one or more of `residential`/`commercial`/
`industrial`/`institutional`); `density_min`/`density_max`; `min_interior_
width_cells`/`min_interior_depth_cells`; `weight` (the ordinary weighted-
fill draw -- `0` means "placed only by a `[[distribution]]` row's own
override, never fill"); `professions` (`{ profession = "<key>", headcount
= <n> }` pairs, keys into `defs/professions/*.toml`). No `count`/
`unique`/`required` field: how many of a type exist is a rule
(`[[distribution]]`), never a field on the type itself. "Institution",
"workplace" and "residential" are all *derived* -- from `tags`
(`municipal_service`, `dwelling`) or from `professions` being non-empty
-- never a stored category.

## Items

`defs/items/*.toml` (story 6.1, FR86): a new item is a row, never code. A
row: permanent `id`/`key`; `unit` (a name from `sim::codes::unit`'s golden
`server/sim/tests/goldens/codes_v1.golden`, e.g. `piece`, `gram`,
`millilitre` -- an unknown name fails the build); `shelf_life_minutes`
(whole minutes until an instance spoils, `0` = never, at most
`MAX_SHELF_LIFE_MINUTES`); `bulk = { width = <n>, height = <n> }` (world
footprint in cells, each 1 to `MAX_FOOTPRINT_CELLS`). All five are
required; there are no defaults.

## The example corpus

Every committed rule key must be named by at least one passing example
and one deliberately failing example under `server/sim/tests/
rule-examples/*.grid` (flat -- no per-rule directory). A key with
neither turns `scripts/dev/verify-defs.sh` red by construction
(`server/sim/tests/rule_examples.rs`'s own completeness test).

A `.grid` file:

```
rules: no_counter_in_a_stairwell
expect: fail
floor: 0
legend: C=counter A=stairs S=shopfront
area: 1 0,0 2,1
grid:
CA
S.
violations:
no_counter_in_a_stairwell at (0, 0, 0)
```

- `rules:` one or more rule keys this file is a worked example for --
  one well-formed composition is routinely evidence for several rules at
  once (a whole room satisfies its wall-closure, doorway and entrance
  rules together, for instance).
- `expect:` `pass` or `fail`.
- `floor:` optional, defaults to `0` -- one floor per file.
- `legend:` maps a character to one or more tags (`+`-joined); `.` is
  always an empty cell and can never be redefined.
- `area:` optional, repeatable -- an opaque area id over a half-open rect
  `<x0>,<y0> <x1>,<y1>` (like `Rect`); several `area:` lines may share one
  id to cover a non-rectangular area.
- `grid:` the rows that follow: one character per cell, top row is `y=0`,
  left column is `x=0`. Every row must be the same length; a blank line
  is never allowed here.
- `violations:` only for `expect: fail` -- one line per expected
  violation, in the exact text `sim::validation::Defect`'s own `Display`
  renders (`<rule key> at (x, y, floor)`, or `<rule key> at (x, y, floor)
  <-> (ox, oy, ofloor)` for an adjacency `Forbid` violation naming the
  matched neighbour).

Every case is evaluated against the *whole* committed rule set, never
only the rule(s) it names -- an honest fail case declares every row it
trips, including incidental ones (an unwalled floor cell fails
`room_has_a_door` too, for instance). The assertion is exact set
equality: every declared line must appear, and nothing else may. A
`fail` case must also be a small change (at most a couple of cells) over
a real `pass` case sharing one of its own rules -- never an unrelated
toy world; `rule_examples.rs`'s own delta test holds that.

A malformed `.grid` file (a missing header, an undeclared character, a
ragged row, an out-of-bounds area) is a build error, named with the
file and line it came from -- reported the same way any other test
failure is, `scripts/dev/verify-defs.sh`'s exit `1`.

## The one command

```
bash scripts/dev/verify-defs.sh
```

No arguments, no server toolchain beyond `cargo`, no `spacetime`, no
network. It regenerates `defs/`'s own committed artefacts as part of
running -- commit them alongside a rule row, the same as any other
`defs/` change. Three exit codes, a contract:

- `0` -- everything passed.
- `1` -- at least one named failure (a rule fired, or failed to fire,
  differently than a `.grid` file declares; a malformed `.grid` file
  included).
- `2` -- the harness itself could not build (the `defs/` tree does not
  build, or the corpus's own test binary does not compile). Never read
  this as "your rule is wrong" -- it means the tool is broken.

A content failure prints the fixture's own path, the rule's key and its
`defs/rules/<file>.toml:<line>`, the expected and found violation sets,
the grid re-printed with every found violation's subject cell marked `!`
(and its matched neighbour, for an adjacency `Forbid` violation, marked
`?`), and the path a new case belongs at.

## Reviewing footprints

`tools/defs-build/contact-sheet.html` (regenerated by every `defs-build`
run, alongside `defs.rs`/`defs.json`) draws every object's footprint,
collider and `interact_at` over its own sprite, grouped by archetype --
open it straight from the filesystem to catch a footprint that is
plausible but wrong (a bench marked walk-through, say). It is generated,
never hand-edited: a correction goes into `defs/objects/*.toml` (or its
named archetype) and comes back on the next build.

Known placeholder art, already reported: `bridge_deck` draws from
`ME_Singles_Vehicles_16x16_Car_Left_1.png` (a car, not a bridge) pending
Artie's own curation -- its footprint/collider are correct, only the
sprite is a stand-in, so there is no need to re-report it on the sheet.
