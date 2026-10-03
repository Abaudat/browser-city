use sim::reducer_classes::ReducerClass;
use spacetimedb::{ProcedureContext, ReducerContext, Table, Timestamp};

mod generated;
mod tables;
mod version;

/// The scaffold's smoke slice (story 1.1): proves a reducer write reaches a
/// subscribed browser client end to end. Not schema -- kept deliberately
/// past story 1.2, which lands the first real tables, because none of them
/// is yet read by a client reducer the e2e round trip can exercise. Delete
/// this table and `send_ping` in the first story that lands a reducer the
/// client reads (see `server/README.md`). `written_at` is `ctx.timestamp`,
/// not the wall clock of whatever called the reducer: it is what the e2e
/// spec measures the one-second budget against, so a CLI process's own
/// startup time is never counted against it.
#[derive(Clone)]
#[spacetimedb::table(accessor = demo_ping, public)]
pub struct DemoPing {
    #[primary_key]
    #[auto_inc]
    // `pub`, not private: `tables::restore::restore_demo_ping` constructs
    // this row from a different module (story 1.4).
    pub id: u64,
    pub message: String,
    pub written_at: Timestamp,
}

/// Inserts one `demo_ping` row. Never panics (NFR41): the only failure mode
/// today is an empty message, reported as `Err` rather than written. The
/// validation itself lives in `sim::demo_ping` (NFR28), unit-tested there --
/// this reducer only reads the clock and writes the table.
#[spacetimedb::reducer]
pub fn send_ping(ctx: &ReducerContext, message: String) -> Result<(), String> {
    tables::metrics::count_call(ctx, ReducerClass::Player);
    sim::demo_ping::validate_ping_message(&message)?;
    ctx.db.demo_ping().insert(DemoPing {
        id: 0,
        message,
        written_at: ctx.timestamp,
    });
    Ok(())
}

/// The stamped round trip a client uses to estimate the server's clock: it
/// returns `ctx.timestamp`. Its one write is the class call counter (NFR17).
/// Open to any caller.
#[spacetimedb::procedure]
pub fn sync_clock(ctx: &mut ProcedureContext) -> Timestamp {
    ctx.with_tx(|tx| tables::metrics::count_call(tx, ReducerClass::Player));
    ctx.timestamp
}

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> {
    // Called when the module is initially published. The owner is the one
    // write that cannot be re-established later, so it stays init-only;
    // everything else is `finish_publish`'s body.
    tables::ops::record_owner_from_init(ctx);
    tables::publish::establish_world(ctx)
}

/// The one post-publish path (owner-only, idempotent, one transaction):
/// establishes every one-row table, seeds every extensible set and re-arms
/// every cadence. Its callers are `init` (same body, via
/// `establish_world`) and `deploy.yml`'s `publish-module` job. A table is
/// never populated by `init` alone: a world published before the table
/// existed never ran `init` for it. A restore re-arms through
/// `finish_restore` (`tables::restore`), not through this reducer.
#[spacetimedb::reducer]
pub fn finish_publish(ctx: &ReducerContext) -> Result<(), String> {
    tables::metrics::count_call(ctx, ReducerClass::Operator);
    tables::ops::require_owner(ctx)?;
    tables::publish::establish_world(ctx)
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    // Called everytime a new client connects. Writes no character and no
    // mapping: a character is an explicit act (`create_character`). A token
    // from a registered issuer minted for another application is refused.
    tables::metrics::count_call(ctx, ReducerClass::Lifecycle);
    tables::identity::check_connecting(ctx)
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    // Called everytime a client disconnects
    tables::metrics::count_call(ctx, ReducerClass::Lifecycle);
}
