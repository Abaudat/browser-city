//! Pure validation for the scaffold's smoke slice (story 1.1). Deleted
//! along with `demo_ping`/`send_ping` in `../../src/lib.rs` when the first
//! real schema lands -- kept here rather than inline in the reducer so it
//! is unit-tested (NFR28: `reducers/` calls `sim`, not the other way
//! around).

/// A `send_ping` message must be non-empty.
pub fn validate_ping_message(message: &str) -> Result<(), &'static str> {
    if message.is_empty() {
        return Err("message must not be empty");
    }
    Ok(())
}
