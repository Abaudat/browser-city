# Definition of Done

A story is Done when every item below holds. Machine-checked items are
enforced by `.github/workflows/ci.yml` and its `scripts/ci/*.sh` checks and
cannot be waved through; human-checked items are Quentin's and the other
leads' call at review.

| Item | Checked by |
| --- | --- |
| `fmt` and `clippy -D warnings` pass | Machine — `ci` / `check` job |
| `sim/` stays pure (no `spacetimedb`, `tokio`, or similar in its dependency graph) | Machine — `check-sim-purity.sh` |
| The workspace's native tests pass, including the property suite | Machine — `ci` / `test` job |
| No `#[ignore]`d test exists | Machine — `check-trace-matrix.sh` |
| The module still builds for `wasm32-unknown-unknown` | Machine — `ci` / `build` job |
| Every table has a declared bound (NFR37) | Machine — `bounds` crate's `registry_matches_tables.rs` |
| The determinism golden matches, and moves only with an `RNG_VERSION` bump | Machine — `determinism_golden.rs`, `check-golden-version-bump.sh` |
| `docs/trace-matrix.md` names a test for every invariant it claims is covered, and every `inv_*` test has a row | Machine — `check-trace-matrix.sh` |
| Acceptance criteria demonstrated | Human — the leads in scope, at review |
| Tests were written before the implementation they cover | Human — the leads in scope, at review |
| The consistency gate passed | Human/Machine — `agentic-team/scripts/` consistency gate, once it exists (Story 0.9) |

CI failing for any reason routes back to Crew: the orchestrator dispatches
the existing Crew session on the PR rather than leaving a red build waiting
for a human.
