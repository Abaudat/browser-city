//! Serialises `sim::world::fixture`'s canonical world and conformance
//! cases to `fixtures/world-conformance.v1.json`, at the repo root -- not
//! under `server/`, so a future client-side vitest suite can read the
//! identical file without reaching into either side's tree (NFR30). Lives
//! here, not in `sim`, because `sim` never depends on `serde` (NFR28);
//! `bounds` already does, for exactly this reason (`server/schema.snapshot.json`).
//!
//! These mirror structs, not `sim::world`'s own types, are what carry
//! `#[derive(Serialize)]` -- keeping that derive out of `sim` entirely.

use std::path::{Path, PathBuf};

use serde::Serialize;

use sim::world::fixture::{canonical_world_spec, conformance_cases};
use sim::world::{AreaSpec, FloorSpec, Rect, TransitionSpec};

#[derive(Debug, Serialize)]
pub struct RectDoc {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

impl From<Rect> for RectDoc {
    fn from(r: Rect) -> Self {
        RectDoc {
            x0: r.x0,
            y0: r.y0,
            x1: r.x1,
            y1: r.y1,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct FloorDoc {
    pub floor: i8,
    pub bounds: RectDoc,
    pub colliders: Vec<RectDoc>,
}

impl From<&FloorSpec> for FloorDoc {
    fn from(f: &FloorSpec) -> Self {
        FloorDoc {
            floor: f.floor,
            bounds: f.bounds.into(),
            colliders: f.colliders.iter().copied().map(RectDoc::from).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TransitionDoc {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub target_x: i32,
    pub target_y: i32,
    pub target_floor: i8,
}

impl From<&TransitionSpec> for TransitionDoc {
    fn from(t: &TransitionSpec) -> Self {
        TransitionDoc {
            x: t.x,
            y: t.y,
            floor: t.floor,
            target_x: t.target_x,
            target_y: t.target_y,
            target_floor: t.target_floor,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AreaDoc {
    pub owner_id: u64,
    pub floor: i8,
    pub rect: RectDoc,
}

impl From<&AreaSpec> for AreaDoc {
    fn from(a: &AreaSpec) -> Self {
        AreaDoc {
            owner_id: a.owner_id,
            floor: a.floor,
            rect: a.rect.into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CaseDoc {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub expect_blocked: bool,
    pub expect_transition: Option<(i32, i32, i8)>,
    pub expect_building_id: u64,
    pub expect_room_id: u64,
}

#[derive(Debug, Serialize)]
pub struct FixtureDocument {
    pub floors: Vec<FloorDoc>,
    pub transitions: Vec<TransitionDoc>,
    pub building_areas: Vec<AreaDoc>,
    pub room_areas: Vec<AreaDoc>,
    pub cases: Vec<CaseDoc>,
}

impl FixtureDocument {
    pub fn to_pretty_json(&self) -> String {
        let mut json =
            serde_json::to_string_pretty(self).expect("FixtureDocument always serializes");
        json.push('\n');
        json
    }
}

/// Builds the document from `sim::world::fixture`'s own, hand-authored
/// spec and cases -- never from calling the query functions under test
/// (see `sim/src/world/fixture.rs`'s doc comment for why).
pub fn build_fixture_document() -> FixtureDocument {
    let spec = canonical_world_spec();
    let cases = conformance_cases()
        .into_iter()
        .map(|c| CaseDoc {
            x: c.x,
            y: c.y,
            floor: c.floor,
            expect_blocked: c.expect_blocked,
            expect_transition: c.expect_transition,
            expect_building_id: c.expect_building_id,
            expect_room_id: c.expect_room_id,
        })
        .collect();

    FixtureDocument {
        floors: spec.floors.iter().map(FloorDoc::from).collect(),
        transitions: spec.transitions.iter().map(TransitionDoc::from).collect(),
        building_areas: spec.building_areas.iter().map(AreaDoc::from).collect(),
        room_areas: spec.room_areas.iter().map(AreaDoc::from).collect(),
        cases,
    }
}

/// `server/../` relative to this crate, i.e. the repo root.
pub fn repo_root_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("bounds crate has a parent directory (server/)")
        .parent()
        .expect("server/ has a parent directory (the repo root)")
        .to_path_buf()
}

/// Where the committed conformance fixture lives.
pub fn fixture_path() -> PathBuf {
    repo_root_dir()
        .join("fixtures")
        .join("world-conformance.v1.json")
}
