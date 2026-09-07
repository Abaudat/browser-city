use spacetimedb::{ReducerContext, Table, Timestamp};

/// The scaffold's smoke slice (story 1.1): proves a reducer write reaches a
/// subscribed browser client end to end. Not schema -- delete this table and
/// `send_ping` in the first story that lands a real one (see
/// `server/README.md`). `written_at` is `ctx.timestamp`, not the wall clock
/// of whatever called the reducer: it is what the e2e spec measures the
/// one-second budget against, so a CLI process's own startup time is never
/// counted against it.
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
pub fn init(_ctx: &ReducerContext) {
    // Called when the module is initially published
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(_ctx: &ReducerContext) {
    // Called everytime a new client connects
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(_ctx: &ReducerContext) {
    // Called everytime a client disconnects
}
