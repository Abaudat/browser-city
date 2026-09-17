//! Story 2.3, Tim's direction (cycle 1): the proposer never reads
//! `defs/` at run time, so its own `PROPOSE_TILE_SIZE_PX` is a hand copy
//! of `defs/balance/render.toml`'s real `render.tile_size_px` value --
//! pinned here against the real committed file, so changing one without
//! the other is a red build rather than 3,000 silently wrong proposals.

use std::path::{Path, PathBuf};

use defs_build::propose::PROPOSE_TILE_SIZE_PX;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn propose_tile_size_px_matches_the_committed_render_tile_size_px() {
    let root = repo_root();
    let path = root.join("defs/balance/render.toml");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));

    let raw = defs_build::parse::parse_all(&[(PathBuf::from("defs/balance/render.toml"), text)])
        .expect("defs/balance/render.toml must parse on its own");

    let tile_size_px = raw
        .balance
        .iter()
        .find(|b| b.key.value == "render.tile_size_px")
        .unwrap_or_else(|| panic!("defs/balance/render.toml has no 'render.tile_size_px' key"))
        .value
        .value;

    assert_eq!(
        tile_size_px as u32, PROPOSE_TILE_SIZE_PX,
        "PROPOSE_TILE_SIZE_PX ({PROPOSE_TILE_SIZE_PX}) has drifted from the committed \
         render.tile_size_px ({tile_size_px}) -- update propose.rs's own constant"
    );
}
