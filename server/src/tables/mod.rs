//! One file per concern (Tech Lead direction, story 1.2): `lib.rs` keeps
//! only the lifecycle reducers and this `mod` list. A concern gets a file
//! here the story it first has a table to put in it -- `world` and
//! `institutions`/`matters` are not yet files because nothing needs one
//! yet, not because they were forgotten.

pub mod citizen;
pub mod codes;
pub mod identity;
pub mod ops;
pub mod restore;
pub mod schedules;
pub mod world;
