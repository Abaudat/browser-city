# The SpacetimeDB module

The Rust module that is the BrowserCity server. `spacetime.json` at the repository root points here
and targets the **local** server by default, so nothing a developer or an agent runs touches the
played world by accident.

## Prerequisites

| Tool | Version used | Note |
|---|---|---|
| SpacetimeDB CLI | 2.9.0 | `spacetime version` |
| Rust | stable (1.98) | `wasm32-unknown-unknown` target installed |
| MSVC build tools | VS 18 BuildTools | host linker for proc macros |

`wasm-opt` is deliberately **not** installed. Binaryen 132 emits a module SpacetimeDB 2.9 refuses to
parse (`invalid leading byte (0x7e) for external kind`), so the CLI's "could not find wasm-opt"
warning on every build is expected and correct.

### Installing the CLI on Windows

The documented installer (`curl ... | sh`) is a Unix shell script and does not run in PowerShell.
The block below is the working Windows method, extracted verbatim and run on a clean
`windows-latest` runner by `.github/workflows/windows-install-check.yml`
(`scripts/ci/extract-windows-install.sh`) on every change to this file and weekly, so drift in the
upstream installer or in our version pin shows up on its own rather than at the next new machine.

<!-- bc:windows-install:start -->
```powershell
iwr https://windows.spacetimedb.com -useb | iex
spacetime version install 2.9.0
spacetime version use 2.9.0
```
<!-- bc:windows-install:end -->

## Running locally

```bash
spacetime start --data-dir .spacetime/data --listen-addr 127.0.0.1:3000   # the local instance
spacetime publish --yes                                                   # build + publish to it
spacetime call browser-city reseed_codes                                  # land sim::codes' rows
spacetime dev --client-lang typescript \
  --module-bindings-path ../client/src/net/bindings --yes                 # hot-reload on file change
```

`reseed_codes` inserts any `sim::codes` row not already present (NFR36/NFR38) and is idempotent, so
calling it again is always safe. `init` already calls it on a fresh database's first publish; call
it by hand (as above) after any later publish that adds a code -- the deploy work is what should
eventually automate this call. It is operator-only: `init` records whoever published the module as
its owner, and the reducer rejects any other caller, so run the `spacetime call` above as the same
identity that ran `spacetime publish`.

`spacetime dev` rebuilds, automigrates, republishes and regenerates `client/src/net/bindings` on
every save; existing rows survive the migration. Run `scripts/dev/check-hot-reload.sh` to verify
the hot-reload loop mechanically rather than by eye.

After adding, removing or changing a `#[spacetimedb::table]` field, run
`scripts/dev/regen-schema-snapshot.sh` and commit the resulting `schema.snapshot.json` --
`bounds/tests/schema_snapshot_current.rs` fails CI otherwise, and
`scripts/ci/check-schema-additive.sh` is what actually enforces NFR33 against it on every PR.

Inspecting:

```bash
spacetime logs browser-city
spacetime sql browser-city "SELECT * FROM demo_ping"
spacetime call browser-city send_ping hello
```

## Resetting

Deleting a directory:

```bash
# stop the instance first
rm -rf .spacetime/data
```

The data directory is disposable and gitignored. It stays disposable until the game is live for
someone other than Adrian; the never-reset world begins only at that point.

**Publish while logged out and the database is owned by an anonymous identity** — a later
`spacetime publish` as your own identity then fails with 403, and the fix is the reset above. Run
`spacetime login show` before the first publish on a fresh machine.

## Maincloud

`spacetime.json` names `local`, so Maincloud is only ever reached explicitly:

```bash
spacetime publish browser-city --server maincloud --yes
```

That command belongs to the deploy on merge to master, not to development.

## The demo table

`demo_ping` and `send_ping` are the scaffold's smoke test (story 1.1), kept because they prove the
round trip -- reducer write to subscribed browser client -- end to end. They are not schema, and
story 1.2's real tables landing does not retire them: they stay until a story lands a reducer the
client actually reads, since removing them before that would leave the round trip with no subject.
Delete them, and `client/tests/e2e/round-trip.spec.ts`, in that story.
