use spacetimedb::{ReducerContext, Table};

/// The scaffold's smoke slice (story 1.1): proves a reducer write reaches a
/// subscribed browser client end to end. Not schema -- delete this table and
/// `send_ping` in the first story that lands a real one (see
/// `server/README.md`).
#[spacetimedb::table(accessor = demo_ping, public)]
pub struct DemoPing {
    #[primary_key]
    #[auto_inc]
    id: u64,
    message: String,
}

/// Inserts one `demo_ping` row. Never panics (NFR41): the only failure mode
/// today is an empty message, reported as `Err` rather than written.
#[spacetimedb::reducer]
pub fn send_ping(ctx: &ReducerContext, message: String) -> Result<(), String> {
    if message.is_empty() {
        return Err("message must not be empty".to_string());
    }
    ctx.db.demo_ping().insert(DemoPing { id: 0, message });
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
