//! Story 2.3, Quentin's direction: a curated table of real tileset props,
//! read as real PNGs (never a synthetic buffer). Includes the 16x32
//! street-lamp-class prop (`foot_stairs`'s own sheet) and a real 112x64
//! vehicle from `ModernTileset/`, whose depth is asserted as an exact
//! number, never `>= 2`, by actually calling [`propose`] on the decoded
//! PNG (never a constant copied into the table).
//!
//! Each row's `reason` explains, from the real art itself, why that
//! outcome is right for the prop -- not what the algorithm happened to
//! do. Where the outcome does not match this object's own authored/
//! classified footprint, the row says so explicitly and names why
//! (`Miss` -- an intentional design difference between raw alpha
//! coverage and the real gameplay footprint, exactly what AC3's
//! classification step exists to correct) rather than silently pass. No
//! Derek/Artie sign-off channel exists in this run: this table's own
//! judgement calls are Crew's, noted as such in this story's PR, pending
//! a lead's review.

use std::path::{Path, PathBuf};

use defs_build::atlas::image::decode_rgba8;
use defs_build::fsio;
use defs_build::model::ColliderRect;
use defs_build::propose::{Proposal, ProposeError, propose};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[derive(Debug, PartialEq)]
enum Expected {
    /// The proposal's own footprint size (`width`/`height`) matches this
    /// object's own real, authored (or archetype-classified) footprint
    /// -- the collider may still be a documented, intentional miss.
    Match(Proposal),
    /// The proposal differs from this object's real footprint in a way
    /// classification exists to correct -- documented, never silent.
    Miss(Proposal),
    /// The real art has a gap of a whole tile or more between its own
    /// visible content and its own sprite's bottom edge -- `propose`
    /// correctly declines rather than guessing (AC1). None of this
    /// table's own curated real props hit this today (a gap smaller
    /// than one tile, common in this tileset, is tolerated -- see
    /// `propose.rs`'s own doc comment); kept for the next real prop
    /// that does.
    #[allow(dead_code)]
    Refused(ProposeError),
}

struct Case {
    name: &'static str,
    sheet: &'static str,
    expected: Expected,
    reason: &'static str,
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            name: "trash_bin",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/ME_Singles_Camping_16x16_Pier_Bin_1.png",
            expected: Expected::Miss(Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 2,
                    y0: 0,
                    x1: 13,
                    y1: 16,
                }),
            }),
            reason: "footprint size (1x1) matches the real trash_bin's own authored width/height. Miss: the proposed collider (2,0)-(13,16) spans the tile's full height because the bin's lid/handle silhouette reaches near both the top and bottom of the cell; the real authored collider (4,4)-(12,12), a smaller centred box, deliberately leaves a walkable margin around the thin lid/handle art for gameplay feel -- exactly the kind of correction AC3's classification step is for.",
        },
        Case {
            name: "park_bench",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/13_School_Singles_16x16/ME_Singles_School_16x16_Bench_1.png",
            expected: Expected::Miss(Proposal {
                width: 2,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 0,
                    y0: 5,
                    x1: 32,
                    y1: 16,
                }),
            }),
            reason: "footprint size (2x1) matches the real park_bench's own authored width/height -- a bench is exactly two tiles wide. Miss: the proposed collider starts at y0=5 because the backrest's own alpha silhouette does not reach the top ~5 sub-cells of the tile; the real authored collider (0,0)-(32,12) blocks that whole region anyway, so a player cannot reach over the back of the bench -- a deliberate gameplay choice raw alpha coverage cannot know.",
        },
        Case {
            name: "shop_counter",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/21_Beach_Singles_16x16/21_Beach_16x16_Bamboo_Bar_Counter_1.png",
            expected: Expected::Miss(Proposal {
                width: 3,
                height: 3,
                collider: Some(ColliderRect {
                    x0: 1,
                    y0: 0,
                    x1: 47,
                    y1: 48,
                }),
            }),
            reason: "Miss, by design: the counter's own art draws a tall shelf/backdrop rising three cells above its real one-cell floor footprint, so alpha coverage over-proposes depth 3 where the real object is 1 (classified via the full_cell_blocker archetype). This is exactly AC1's own worked case for why the proposal is a starting point, never authority -- a wide-canopy or tall-backdrop prop is expected to over-propose depth, and a reviewer corrects it by archetype, not by tuning the algorithm.",
        },
        Case {
            name: "lamppost",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/ME_Singles_City_Props_16x16_Street_Lamp_5.png",
            expected: Expected::Miss(Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 2,
                    y0: 0,
                    x1: 15,
                    y1: 16,
                }),
            }),
            reason: "footprint size (1x1) matches the real lamppost's own authored width/height, and AC2 holds: the sprite's own 64px screen height (4 cells) never inflates the footprint depth past 1. Miss: the proposed collider spans nearly the whole cell because it is the bounding box of the *entire visible pole and lamp head*, while the real, classified `pole` archetype collider (6,10)-(10,14) is only the physical post's own base, so a player can walk under the overhanging lamp arm -- exactly the correction archetype classification exists for.",
        },
        Case {
            name: "shop_window",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/16_Office_Singles_16x16/ME_Singles_Office_16x16_Balcony_Window_Left_1.png",
            expected: Expected::Miss(Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 14,
                    y0: 2,
                    x1: 16,
                    y1: 15,
                }),
            }),
            reason: "footprint size (1x1) matches the real shop_window's own authored width/height. The window frame's own opaque art finishes one pixel short of the sprite's own bottom edge -- tolerated (a gap smaller than one tile), depth still measured from the frame's own right-hand mullion, which runs rows 2-14. Miss: the proposed collider is only that thin vertical strip, while the real object is classified full_cell_blocker (the whole tile blocks, glass included) -- alpha coverage alone cannot know the glass should block too, exactly AC3's own correction case.",
        },
        Case {
            name: "wall_segment",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/17_Garden_Singles_16x16/ME_Singles_Garden_16x16_Grass_Wall_1_1.png",
            expected: Expected::Match(Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 0,
                    y0: 0,
                    x1: 16,
                    y1: 16,
                }),
            }),
            reason: "an exact match: a plain, fully-opaque wall tile proposes exactly the full 1x1 cell, identical to the real wall_segment's own full_cell_blocker classification -- no correction needed for a prop this simple.",
        },
        Case {
            name: "bridge_deck's own placeholder sheet",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Car_Left_1.png",
            expected: Expected::Miss(Proposal {
                width: 4,
                height: 3,
                collider: Some(ColliderRect {
                    x0: 1,
                    y0: 10,
                    x1: 62,
                    y1: 47,
                }),
            }),
            reason: "this sheet is an explicitly-noted placeholder (defs/objects/city-props.toml's own comment: \"Artie's own curation is a later story\"), so any comparison to the deck's own real footprint is inherently a miss by construction: bridge_deck is classified underfoot_flat (no collider at all, width=4 stays explicit on the object), discarding any proposed collider regardless of what this placeholder car sprite measures. Footprint width (4) does match, coincidentally, since this placeholder happens to already be 4 tiles wide.",
        },
        Case {
            name: "foot_stairs -- the 16x32 street-lamp-class prop AC2 names",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/17_Garden_Singles_16x16/ME_Singles_Garden_16x16_Small_Stairs.png",
            expected: Expected::Match(Proposal {
                width: 1,
                height: 1,
                collider: Some(ColliderRect {
                    x0: 2,
                    y0: 0,
                    x1: 13,
                    y1: 16,
                }),
            }),
            reason: "an exact match on footprint size: AC2's own dominant class (one cell of floor under two cells of screen height, 16x32) proposes depth 1, never inflated by the sprite's own extra screen height -- matching the real foot_stairs' own authored width. The proposed collider is discarded regardless once classified underfoot_flat (explicitly walkable, no collider at all), so it is neither a match nor a miss, just unused.",
        },
        Case {
            name: "a real 112x64 vehicle (Bus_Left_1, not a committed object)",
            sheet: "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Bus_Left_1.png",
            expected: Expected::Match(Proposal {
                width: 7,
                height: 4,
                collider: Some(ColliderRect {
                    x0: 1,
                    y0: 2,
                    x1: 112,
                    y1: 64,
                }),
            }),
            reason: "AC2's own mandated case: depth greater than one is common, not exceptional, for a real vehicle -- the bus is fully opaque bottom-up over its own 4-cell height, so depth 4 is exactly right, not an over-proposal.",
        },
    ]
}

#[test]
fn every_curated_real_prop_matches_its_documented_expectation() {
    let root = repo_root();
    for case in cases() {
        let bytes = fsio::read_bytes(&root, &[PathBuf::from(case.sheet)])
            .unwrap_or_else(|e| panic!("{}: cannot read {}: {e}", case.name, case.sheet))
            .remove(0)
            .1;
        let (w, h, rgba) = decode_rgba8(&bytes)
            .unwrap_or_else(|e| panic!("{}: cannot decode {}: {e}", case.name, case.sheet));
        let actual = propose(w, h, &rgba);

        match &case.expected {
            Expected::Match(p) | Expected::Miss(p) => {
                assert_eq!(
                    actual.as_ref().unwrap_or_else(|e| panic!(
                        "{} ({}): expected {:?}, propose() errored: {e}",
                        case.name, case.sheet, p
                    )),
                    p,
                    "{} ({}) -- {}",
                    case.name,
                    case.sheet,
                    case.reason
                );
            }
            Expected::Refused(want_err) => {
                assert_eq!(
                    actual.unwrap_err(),
                    *want_err,
                    "{} ({}) -- {}",
                    case.name,
                    case.sheet,
                    case.reason
                );
            }
        }
    }
}

/// AC2, spelled out as its own assertion (never folded into the table
/// loop above, so a future edit to the table cannot silently drop it):
/// the real 112x64 vehicle's own depth, measured by actually running
/// `propose` on the decoded PNG (never a constant copied into the
/// table), is exactly 4, not merely `>= 2`.
#[test]
fn the_real_112x64_vehicle_proposes_a_depth_of_exactly_4_cells() {
    let root = repo_root();
    let sheet = "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Bus_Left_1.png";
    let bytes = fsio::read_bytes(&root, &[PathBuf::from(sheet)])
        .unwrap()
        .remove(0)
        .1;
    let (w, h, rgba) = decode_rgba8(&bytes).unwrap();
    let proposal = propose(w, h, &rgba).unwrap();
    assert_eq!(proposal.height, 4);
}
