# `defs/` -- for an agent extending the rule set

This is not a def (`fsio::is_defs_doc` excludes it from `defs-build`'s own
parse, though it still folds into `defs_version` like every other tracked
file here). It exists so an agent adding a rule never has to read source
to find the corpus.

## Rule kinds

A rule kind is one of five closed shapes under `defs/rules/*.toml`:
`[[placement]]`, `[[distribution]]`, `[[coherence]]`, `[[adjacency]]`,
`[[requirement]]`. Each row names real tags (`defs/tags/*.toml`) and
carries a permanent `id`/`key`. `sim::rules::evaluate` is the one
evaluator; see `docs/architecture.md`'s "Rules" section for the full
grammar of each kind.

## The example corpus

Every committed rule row must carry at least one passing example and one
deliberately failing example under `server/sim/tests/rule-examples/
<rule_key>/` -- `pass*.grid` and `fail*.grid`. A row with neither turns
`scripts/dev/verify-defs.sh` red by construction
(`server/sim/tests/rule_examples.rs`'s own completeness test).

A `.grid` file:

```
rule: no_counter_in_a_stairwell
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

- `rule:` the rule key this file lives under (must match its own
  directory name).
- `expect:` `pass` or `fail`.
- `floor:` optional, defaults to `0` -- one floor per file.
- `legend:` maps a character to one or more tags (`+`-joined); `.` is
  always an empty cell and can never be redefined.
- `area:` optional, repeatable -- an opaque area id over a half-open rect
  `<x0>,<y0> <x1>,<y1>` (like `Rect`); several `area:` lines may share one
  id to cover a non-rectangular area.
- `grid:` the rows that follow: one character per cell, top row is `y=0`,
  left column is `x=0`.
- `violations:` only for `expect: fail` -- one line per expected
  violation, in the exact text `sim::validation::Defect`'s own `Display`
  renders (`<rule key> at (x, y, floor)`, or `<rule key> at (x, y, floor)
  <-> (ox, oy, ofloor)` for an adjacency `Forbid` violation naming the
  matched neighbour).

Every case is evaluated against the *whole* committed rule set, never
only its own rule -- an honest `fail.grid` names every row it trips,
including incidental ones (an unwalled floor cell fails
`room_has_a_door` too, for instance). The assertion is exact set
equality: every declared line must appear, and nothing else may.

## The one command

```
bash scripts/dev/verify-defs.sh
```

No arguments, no server toolchain, no `spacetime`, no network. Three
exit codes, a contract:

- `0` -- everything passed.
- `1` -- at least one named content failure (a rule fired, or failed to
  fire, differently than a `.grid` file declares).
- `2` -- the harness itself could not run (the `defs/` tree does not
  build, or the corpus's own test binary does not compile). Never read
  this as "your rule is wrong" -- it means the tool is broken.

A content failure (exit 1) prints the fixture's own path, the rule's key
and its `defs/rules/<file>.toml:<line>`, the expected and found violation
sets, the grid re-printed with every found violation's subject cell
marked `!` (and its matched neighbour, for an adjacency `Forbid`
violation, marked `?`), and the exact path a new case belongs at.
