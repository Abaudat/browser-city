# Definition of Done

A story is Done when every item below holds. Machine-checked items are
enforced by `.github/workflows/ci.yml` and its `scripts/ci/*.sh` checks and
cannot be waved through; human-checked items are Quentin's and the other
leads' call at review.

| Item | Checked by |
| --- | --- |
| `fmt` and `clippy -D warnings` pass | Machine — `ci` / `check` job |
| `sim/`'s normal+build dependency graph is exactly its allowlist (empty today) | Machine — `check-sim-purity.sh` |
| The workspace's native tests pass, including the property suite | Machine — `ci` / `test` job |
| No `#[ignore]`d test exists | Machine — `check-trace-matrix.sh` |
| The module still builds for `wasm32-unknown-unknown` | Machine — `ci` / `build` job |
| `sim`'s line coverage stays at or above its floor | Machine — `ci` / `coverage` job (`cargo-llvm-cov`) |
| Every table has a declared bound (NFR37) | Machine — `bounds` crate's `registry_matches_tables.rs` |
| The determinism golden matches, and moves only with an `RNG_VERSION` bump | Machine — `determinism_golden.rs`, `check-golden-version-bump.sh` |
| `docs/trace-matrix.md` and `server/sim/tests/invariants.rs`'s `INV_*` constants name each other 1:1, and every `covered`/`deferred` row matches whether its test actually exists | Machine — `check-trace-matrix.sh` |
| `agentic-team/scripts/tests/run-all.sh` passes | Machine — `ci` / `scripts-tests` job |
| Acceptance criteria demonstrated | Human — the leads in scope, at review |
| Tests were written before the implementation they cover | Human — the leads in scope, at review |
| The consistency gate passed | Human/Machine — `agentic-team/scripts/` consistency gate, once it exists (Story 0.9) |

A red required check on a PR is never left for a human to notice: the
orchestrator reads it directly, before ever consulting the leads, and
dispatches Crew with a prompt naming the failing run — never merging while
it is red. Both directions this could hang are bounded, the same way
lead-rework is: a build Crew cannot fix trips a circuit breaker after
`BC_CYCLE_LIMIT` consecutive dispatches, and a check that never reports at
all finishes the wake `broken` after `BC_CYCLE_LIMIT` ticks rather than
sleeping on it forever.
