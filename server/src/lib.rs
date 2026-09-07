use spacetimedb::{ReducerContext, Table, Timestamp};

mod tables;

/// The scaffold's smoke slice (story 1.1): proves a reducer write reaches a
/// subscribed browser client end to end. Not schema -- kept deliberately
/// past story 1.2, which lands the first real tables, because none of them
/// is yet read by a client reducer the e2e round trip can exercise. Delete
/// this table and `send_ping` in the first story that lands a reducer the
/// client reads (see `server/README.md`). `written_at` is `ctx.timestamp`,
/// not the wall clock of whatever called the reducer: it is what the e2e
/// spec measures the one-second budget against, so a CLI process's own
/// startup time is never counted against it.
#[spacetimedb::table(accessor = demo_ping, public)]
pub struct DemoPing {
    #[primary_key]
    #[auto_inc]
    id: u64,
    message: String,
    written_at: Timestamp,
}

/// Inserts one `demo_ping` row. Never panics (NFR41): the only failure mode
/// today is an empty message, reported as `Err` rather than written. The
/// validation itself lives in `sim::demo_ping` (NFR28), unit-tested there --
/// this reducer only reads the clock and writes the table.
#[spacetimedb::reducer]
pub fn send_ping(ctx: &ReducerContext, message: String) -> Result<(), String> {
    sim::demo_ping::validate_ping_message(&message)?;
    ctx.db.demo_ping().insert(DemoPing {
        id: 0,
        message,
        written_at: ctx.timestamp,
    });
    Ok(())
}

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    // Called when the module is initially published. Nothing is scheduled
    // from here (story 1.2): an empty scheduled table costs nothing, and
    // the first row is a later story's problem.
    tables::codes::seed_all_codes(ctx);
}

/// Re-runs the extensible-set seed (NFR38): `init` only ever runs on the
/// module's first publish, so a code added in month six needs an explicit,
/// re-callable path to land, not a write on the hottest lifecycle reducer
/// we have (`client_connected` fires on the city with zero clients
/// connected too, per NFR3 -- there is no "someone happens to log in" to
/// lean on). Idempotent: safe to call after every publish that adds a
/// code, and a no-op otherwise. `server/README.md` names the deploy step
/// that calls it.
#[spacetimedb::reducer]
pub fn reseed_codes(ctx: &ReducerContext) {
    tables::codes::seed_all_codes(ctx);
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(_ctx: &ReducerContext) {
    // Called everytime a new client connects
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(_ctx: &ReducerContext) {
    // Called everytime a client disconnects
}
