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

## Maincloud and GitHub Pages provisioning (one-time)

`.github/workflows/deploy.yml` publishes to Maincloud and deploys the client to GitHub Pages, on
every push to `master` that passed CI. None of this can be automated; someone with the right
access does it once, by hand, before `vars.DEPLOY_ENABLED` is set to `true` (until then, the
workflow's `resolve` job does nothing on a push -- see that file's own header comment).

**The `maincloud` environment.** Settings -> Environments -> New environment, named `maincloud`.
Restrict its deployment branches to `master` (so nothing dispatched from any other branch can ever
read what it holds) before adding the two secrets below to it -- an environment secret is only
readable by a job that declares `environment: maincloud`, unlike a repository secret, which any
workflow anyone with push access can dispatch from their own branch could read. `deploy.yml`'s
`backup`/`publish-module` jobs and `backup.yml`'s `export`/`rehearsal` jobs all declare it; nothing
else needs to.

**The Maincloud deploy identity.** From a machine with the CLI installed (Windows or otherwise):

```bash
spacetime login                       # opens a browser, authenticates against spacetimedb.com
spacetime login show --token          # prints the bearer token
spacetime login show                  # prints "You are logged in as <identity>"
```

Add the token to the `maincloud` environment as the `SPACETIME_MAINCLOUD_TOKEN` secret, and the
identity as the `MAINCLOUD_OWNER_IDENTITY` *repository* variable (a variable is not a secret, and
every job that logs in needs to read it to verify itself, including ones that do not otherwise
need the `maincloud` environment). This is the *same* identity `.github/workflows/backup.yml`
already logs in as: a backup restorable only by an identity nobody holds is not a backup, so the
identity that ever publishes the live database must be the one that owns it. Every job that logs
in re-checks this itself (compares `spacetime login show` against `vars.MAINCLOUD_OWNER_IDENTITY`)
rather than trusting `--token`/`--no-config` silently did the right thing.

Also add the live database's name as the `BACKUP_DATABASE` repository variable -- the single name
`deploy.yml` and `backup.yml` both publish to, back up and restore, never two copies of it.
`BACKUP_PASSPHRASE` (the export encryption passphrase) goes into the `maincloud` environment
alongside `SPACETIME_MAINCLOUD_TOKEN`; see `backup.yml`'s own header comment.

**GitHub Pages.** Settings -> Pages -> Source: "GitHub Actions" (not a branch). This provisions the
`github-pages` deployment environment `deploy-client` targets; restrict it to `master` (Settings ->
Environments -> github-pages -> Deployment branches) so nothing but that job can ever publish to it.

**Turning it on.** Only once every secret and variable above exists and both environments are
branch-restricted: set the `DEPLOY_ENABLED` repository variable to `true`. Before that, `push`es to
master still trigger `deploy.yml`, but its `resolve` job only emits a `::notice::` and does nothing
else (no failed presence check, no tracking issue) -- so this workflow can be merged and live on
master well before provisioning is finished, with zero effect until it is.

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

### Recovery -- there is no automatic rollback

A published schema cannot be rolled back; NFR33 (enforced at PR time by
`scripts/ci/check-schema-additive.sh`) only ever lets an *additive* schema reach `deploy.yml`, so
the module half of a bad deploy is a forward-only problem: fix the bug, merge the fix, and let
`deploy.yml` publish that. `workflow_dispatch` (with an explicit `sha` input) retries a deploy or
re-runs it against an older commit, but redeploying an older SHA only ever re-ships the *client*
half safely -- publishing an older module is itself a schema change (removing whatever the bad
commit added), which is exactly what `check-deploy-workflow.sh` and NFR33 exist to refuse, so it
is never a way to undo a published migration.

A world restore is a separate, deliberate operation, never part of a deploy: `scripts/ops/
restore-world.sh`, into a *fresh* database, from an export `backup.yml` produced -- see
`docs/architecture.md`'s own Backup section.

A `deploy.yml` failure on `master` opens or updates a tracking issue (`scripts/ci/
report-scheduled-failure.sh`) rather than sitting unnoticed in the Actions tab; that issue links
back to this section.

## Spikes

`spikes/` holds throwaway measurement modules, published under their own disposable database names,
depended on by nothing and never touched by the deploy path -- see each spike's own crate doc
comment. `scripts/dev/run-sched-timing-spike.sh` re-runs story 1.3's scheduled-reducer timing
measurement; `docs/spikes/1.3-scheduled-reducer-timing.md` has the pre-registered budget and the
findings.

## The demo table

`demo_ping` and `send_ping` are the scaffold's smoke test (story 1.1), kept because they prove the
round trip -- reducer write to subscribed browser client -- end to end. They are not schema, and
story 1.2's real tables landing does not retire them: they stay until a story lands a reducer the
client actually reads, since removing them before that would leave the round trip with no subject.
Delete them, and `client/tests/e2e/round-trip.spec.ts`, in that story.
