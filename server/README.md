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

## Running locally

```bash
spacetime start --data-dir .spacetime/data --listen-addr 127.0.0.1:3000   # the local instance
spacetime publish --yes                                                   # build + publish to it
spacetime dev --server-only --yes                                         # hot-reload on file change
```

`spacetime dev` rebuilds, automigrates and republishes on every save; existing rows survive the
migration. Add `--client-lang typescript --module-bindings-path client/src/module_bindings` once the
client exists.

Inspecting:

```bash
spacetime logs browser-city
spacetime sql browser-city "SELECT * FROM person"
spacetime call browser-city say_hello
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

`Person`, `add` and `say_hello` are the template's smoke test, kept because they prove the local loop
end to end. They are not schema. Delete them when the first real tables land.
