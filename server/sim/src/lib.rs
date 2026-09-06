//! Pure simulation logic (NFR28). This crate never depends on `spacetimedb`
//! and never will -- `check-sim-purity.sh` fails CI if it does. It reads no
//! table and touches no clock, filesystem, or network; every input it needs
//! is passed in by its caller in `../src` (the reducer crate).

pub mod rng;
