# Proposal: shard architecture.md

`architecture.md` is ~33k tokens and every role that opens it pays for the
whole thing. This proposes splitting it into per-topic files under
`docs/architecture/`, one per section, with an index that links them:

- `docs/architecture/tables.md` — table definitions and their bounds
- `docs/architecture/reducers.md` — reducer boundaries and authorship
- `docs/architecture/sim.md` — the `sim/` purity boundary
- `docs/architecture/client.md` — client-derived values and seeding

Each role then reads only the shard it needs, which should cut the read cost
of a typical task by roughly two thirds.
