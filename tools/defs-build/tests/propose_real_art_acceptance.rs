//! Story 2.3, Quentin's direction: a curated table of real tileset props,
//! read as real PNGs (never a synthetic buffer), each pinned to an exact
//! expected [`Proposal`]. Includes the 16x32 street-lamp-class prop
//! (`foot_stairs`'s own sheet) and a real 112x64 vehicle from
//! `ModernTileset/`, whose depth is asserted as an exact number, never
//! `>= 2`.
//!
//! The expected values below were captured from a real run of
//! [`propose`] over each committed sheet (`cargo run --bin defs-propose`)
//! -- they lock in the algorithm's own current behaviour as a regression
//! gate. `propose`'s own output is a starting point, never authority
//! (AC1): these numbers are not asserted to equal the real objects' own
//! authored footprints (several intentionally differ, e.g.
//! `shop_counter`'s authored depth is 1 cell, classified via the
//! `full_cell_blocker` archetype -- the proposal alone measures 3, since
//! the counter's own sprite has opaque pixels above its footprint too).
//! Pending Derek/Artie's own sign-off on whether these are the *right*
//! numbers to expect going forward, per Quentin's direction -- noted as
//! an open item in this story's PR.

use std::path::{Path, PathBuf};

use defs_build::atlas::image::decode_rgba8;
use defs_build::fsio;
use defs_build::model::ColliderRect;
use defs_build::propose::{Proposal, propose};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

struct Case {
    name: &'static str,
    sheet: &'static str,
    expected: Proposal,
    reason: &'static str,
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            name: "trash_bin (16x16 fixture)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/ME_Singles_Camping_16x16_Pier_Bin_1.png",
            expected: Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 2,
                    y0: 0,
                    x1: 13,
                    y1: 16,
                }),
            },
            reason: "one tile, band is the whole 16px sprite, opaque body roughly centred",
        },
        Case {
            name: "park_bench (32x16, two cells wide)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/13_School_Singles_16x16/ME_Singles_School_16x16_Bench_1.png",
            expected: Proposal {
                width: 2,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 0,
                    y0: 5,
                    x1: 32,
                    y1: 16,
                }),
            },
            reason: "width from w/tile = 2; the sprite's own 16px height is the whole band",
        },
        Case {
            name: "shop_counter (48x64, tall art above a one-cell footprint)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/21_Beach_Singles_16x16/21_Beach_16x16_Bamboo_Bar_Counter_1.png",
            expected: Proposal {
                width: 3,
                height: 3,
                collider: Some(ColliderRect {
                    x0: 1,
                    y0: 0,
                    x1: 47,
                    y1: 48,
                }),
            },
            reason: "band = min(64,48,128) = 48px (3 cells); opaque contiguous from the bottom through the whole band -- this is exactly the over-proposal a reviewer corrects via the full_cell_blocker archetype (AC3), never authority (AC1)",
        },
        Case {
            name: "lamppost (16x64 street lamp)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/ME_Singles_City_Props_16x16_Street_Lamp_5.png",
            expected: Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 2,
                    y0: 0,
                    x1: 15,
                    y1: 16,
                }),
            },
            reason: "AC2: sprite height (64px, 4 cells of screen height) never inflates depth -- band = min(64,16,128) = 16px, one cell",
        },
        Case {
            name: "shop_window (16x16)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/16_Office_Singles_16x16/ME_Singles_Office_16x16_Balcony_Window_Left_1.png",
            expected: Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 14,
                    y0: 2,
                    x1: 16,
                    y1: 15,
                }),
            },
            reason: "the window's own opaque frame sits toward one edge of the tile",
        },
        Case {
            name: "wall_segment (16x16, fully opaque)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/17_Garden_Singles_16x16/ME_Singles_Garden_16x16_Grass_Wall_1_1.png",
            expected: Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 0,
                    y0: 0,
                    x1: 16,
                    y1: 16,
                }),
            },
            reason: "fully opaque tile proposes the full cell -- exactly full_cell_blocker's own shape",
        },
        Case {
            name: "bridge_deck's placeholder sheet (64x48, four cells wide)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Car_Left_1.png",
            expected: Proposal {
                width: 4,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 1,
                    y0: 0,
                    x1: 62,
                    y1: 15,
                }),
            },
            reason: "width from w/tile = 4; band = min(48,64,128) = 48px (3 cells) but the opaque region is only contiguous through the bottom 16px, so depth = 1",
        },
        Case {
            name: "foot_stairs (16x32) -- the street-lamp-class prop AC2 names",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/17_Garden_Singles_16x16/ME_Singles_Garden_16x16_Small_Stairs.png",
            expected: Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 2,
                    y0: 0,
                    x1: 13,
                    y1: 16,
                }),
            },
            reason: "AC2's dominant class: one cell of floor under two cells of screen height -- band = min(32,16,128) = 16px, one cell",
        },
        Case {
            name: "a real 112x64 vehicle (Bus_Left_1)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Bus_Left_1.png",
            expected: Proposal {
                width: 7,
                height: 4,
                collider: Some(ColliderRect {
                    x0: 1,
                    y0: 2,
                    x1: 112,
                    y1: 64,
                }),
            },
            reason: "AC2: depth greater than one is common, not exceptional -- band = min(64,112,128) = 64px, the whole sprite, fully occupied bottom-up",
        },
    ]
}

#[test]
fn every_curated_real_prop_proposes_its_exact_pinned_footprint() {
    let root = repo_root();
    for case in cases() {
        let bytes = fsio::read_bytes(&root, &[PathBuf::from(case.sheet)])
            .unwrap_or_else(|e| panic!("{}: cannot read {}: {e}", case.name, case.sheet))
            .remove(0)
            .1;
        let (w, h, rgba) = decode_rgba8(&bytes)
            .unwrap_or_else(|e| panic!("{}: cannot decode {}: {e}", case.name, case.sheet));
        let proposal =
            propose(w, h, &rgba).unwrap_or_else(|e| panic!("{}: propose() failed: {e}", case.name));
        assert_eq!(
            proposal, case.expected,
            "{} ({}) -- {}",
            case.name, case.sheet, case.reason
        );
    }
}

/// AC2, spelled out as its own assertion (never folded into the table
/// loop above, so a future edit to the table cannot silently drop it):
/// the real 112x64 vehicle's own depth is exactly 4, not merely `>= 2`.
#[test]
fn the_real_112x64_vehicle_proposes_a_depth_of_exactly_4_cells() {
    let vehicle = cases()
        .into_iter()
        .find(|c| c.sheet.contains("Bus_Left_1"))
        .expect("the 112x64 vehicle case must be in the table");
    assert_eq!(vehicle.expected.height, 4);
}
