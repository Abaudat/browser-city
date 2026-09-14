//! The "a week later" guarantee (FR61): a fixed set of citizen ids must
//! always derive the same five-integer tuple from a fixed catalogue,
//! checked against a committed golden rather than merely against another
//! derivation in the same process (which would prove nothing about next
//! week). Keyed by `sim::appearance::APPEARANCE_VERSION`;
//! `check-golden-version-bump.sh` forces a deliberate bump whenever this
//! golden moves.
//!
//! Pinned against a small, fixed, test-local [`Catalogue`] -- never the
//! live `defs/appearance/` -- because `generate` is not stable across
//! catalogue changes (appending a part to a family shifts every later
//! pick's `% len`). If this golden goes red, look at what changed:
//! either `sim::appearance`'s own algorithm/seeding moved (the expected,
//! deliberate case this golden exists to catch, requiring an
//! `APPEARANCE_VERSION` bump), or the fixed catalogue below was edited by
//! mistake (it never should be, once ids are assigned).

use sim::appearance::{APPEARANCE_VERSION, Appearance, Catalogue, generate};
use sim::generated::defs::{AccessoryDef, BodyDef, EyesDef, Family, HairstyleDef, OutfitDef, Pool};

const BODIES: &[BodyDef] = &[
    BodyDef {
        id: 1,
        key: "adult_body_1",
        family: Family::Adult,
        sheet: "x",
    },
    BodyDef {
        id: 2,
        key: "adult_body_2",
        family: Family::Adult,
        sheet: "x",
    },
    BodyDef {
        id: 3,
        key: "adult_body_3",
        family: Family::Adult,
        sheet: "x",
    },
    BodyDef {
        id: 10,
        key: "kid_body_1",
        family: Family::Kid,
        sheet: "x",
    },
    BodyDef {
        id: 11,
        key: "kid_body_2",
        family: Family::Kid,
        sheet: "x",
    },
];

const EYES: &[EyesDef] = &[
    EyesDef {
        id: 1,
        key: "adult_eyes_1",
        family: Family::Adult,
        sheet: "x",
    },
    EyesDef {
        id: 2,
        key: "adult_eyes_2",
        family: Family::Adult,
        sheet: "x",
    },
    EyesDef {
        id: 10,
        key: "kid_eyes_1",
        family: Family::Kid,
        sheet: "x",
    },
    EyesDef {
        id: 11,
        key: "kid_eyes_2",
        family: Family::Kid,
        sheet: "x",
    },
];

const HAIRSTYLES: &[HairstyleDef] = &[
    HairstyleDef {
        id: 1,
        key: "adult_hair_1",
        family: Family::Adult,
        sheet: "x",
        style: 1,
        color: 1,
        rare: false,
    },
    HairstyleDef {
        id: 2,
        key: "adult_hair_2",
        family: Family::Adult,
        sheet: "x",
        style: 1,
        color: 2,
        rare: false,
    },
    HairstyleDef {
        id: 3,
        key: "adult_hair_3",
        family: Family::Adult,
        sheet: "x",
        style: 2,
        color: 1,
        rare: false,
    },
    HairstyleDef {
        id: 4,
        key: "adult_hair_rare",
        family: Family::Adult,
        sheet: "x",
        style: 2,
        color: 7,
        rare: true,
    },
    HairstyleDef {
        id: 10,
        key: "kid_hair_1",
        family: Family::Kid,
        sheet: "x",
        style: 1,
        color: 1,
        rare: false,
    },
    HairstyleDef {
        id: 11,
        key: "kid_hair_2",
        family: Family::Kid,
        sheet: "x",
        style: 1,
        color: 2,
        rare: false,
    },
];

const OUTFITS: &[OutfitDef] = &[
    OutfitDef {
        id: 1,
        key: "adult_outfit_1",
        family: Family::Adult,
        sheet: "x",
        pool: Pool::Civilian,
        hides_hairstyle: false,
    },
    OutfitDef {
        id: 2,
        key: "adult_outfit_2",
        family: Family::Adult,
        sheet: "x",
        pool: Pool::Civilian,
        hides_hairstyle: false,
    },
    OutfitDef {
        id: 3,
        key: "adult_outfit_role",
        family: Family::Adult,
        sheet: "x",
        pool: Pool::RoleOnly,
        hides_hairstyle: false,
    },
    OutfitDef {
        id: 10,
        key: "kid_outfit_1",
        family: Family::Kid,
        sheet: "x",
        pool: Pool::Civilian,
        hides_hairstyle: false,
    },
    OutfitDef {
        id: 11,
        key: "kid_outfit_2",
        family: Family::Kid,
        sheet: "x",
        pool: Pool::Civilian,
        hides_hairstyle: false,
    },
];

const ACCESSORIES: &[AccessoryDef] = &[
    AccessoryDef {
        id: 1,
        key: "adult_accessory_1",
        family: Family::Adult,
        sheet: "x",
        pool: Pool::Civilian,
        slot: sim::generated::defs::Slot::Head,
    },
    AccessoryDef {
        id: 2,
        key: "adult_accessory_2",
        family: Family::Adult,
        sheet: "x",
        pool: Pool::Civilian,
        slot: sim::generated::defs::Slot::Face,
    },
    AccessoryDef {
        id: 3,
        key: "adult_accessory_role",
        family: Family::Adult,
        sheet: "x",
        pool: Pool::RoleOnly,
        slot: sim::generated::defs::Slot::Torso,
    },
];

fn test_catalogue() -> Catalogue<'static> {
    Catalogue {
        bodies: BODIES,
        eyes: EYES,
        hairstyles: HAIRSTYLES,
        outfits: OUTFITS,
        accessories: ACCESSORIES,
        hair_rare_chance: 15,
        accessory_none_chance: 70,
    }
}

// 32 ids spread across the full u64 range, keeping the two edges: every
// power-of-two-ish boundary a narrower type could silently truncate at
// (u16, u32, and their neighbours), plus a spread through the middle so a
// bias affecting only some ids does not hide behind five rows.
const IDS: [u64; 32] = [
    0,
    1,
    2,
    3,
    7,
    13,
    42,
    255,
    256,
    65_535,
    65_536,
    1_000_000,
    16_777_216,
    u32::MAX as u64 - 1,
    u32::MAX as u64,
    u32::MAX as u64 + 1,
    1 << 40,
    1 << 48,
    1 << 56,
    1 << 60,
    u64::MAX / 4,
    u64::MAX / 3,
    u64::MAX / 2,
    (u64::MAX / 2) + 1,
    u64::MAX - 100_000_000,
    u64::MAX - 1_000_000,
    u64::MAX - 65_536,
    u64::MAX - 65_535,
    u64::MAX - 256,
    u64::MAX - 255,
    u64::MAX - 1,
    u64::MAX,
];

const GOLDEN: &str = include_str!("goldens/appearance_v1.golden");

struct GoldenRow {
    id: u64,
    family: Family,
    tuple: Appearance,
}

fn parse_family(s: &str) -> Family {
    match s {
        "adult" => Family::Adult,
        "kid" => Family::Kid,
        other => panic!("unknown family '{other}' in golden"),
    }
}

fn parse_golden(text: &str) -> (u32, Vec<GoldenRow>) {
    let mut lines = text.lines();
    let version_line = lines.next().expect("golden file is empty");
    let version: u32 = version_line
        .strip_prefix("version=")
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            panic!("golden's first line must be 'version=<n>', got {version_line:?}")
        });

    let rows = lines
        .map(|line| {
            let mut parts = line.split(' ');
            let id: u64 = parts
                .next()
                .and_then(|p| p.strip_prefix("id="))
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let family = parts
                .next()
                .and_then(|p| p.strip_prefix("family="))
                .map(parse_family)
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let tuple_str = parts
                .next()
                .and_then(|p| p.strip_prefix("tuple="))
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let nums: Vec<u16> = tuple_str
                .split(',')
                .map(|v| {
                    v.parse()
                        .unwrap_or_else(|_| panic!("bad tuple value in: {line:?}"))
                })
                .collect();
            assert_eq!(nums.len(), 5, "malformed golden row: {line:?}");
            GoldenRow {
                id,
                family,
                tuple: Appearance {
                    body: nums[0],
                    eyes: nums[1],
                    outfit: nums[2],
                    hairstyle: nums[3],
                    accessory: nums[4],
                },
            }
        })
        .collect();

    (version, rows)
}

#[test]
fn appearance_output_matches_committed_golden() {
    let (golden_version, golden_rows) = parse_golden(GOLDEN);

    assert_eq!(
        golden_version, APPEARANCE_VERSION,
        "tests/goldens/appearance_v1.golden is keyed to version {golden_version} but \
         sim::appearance::APPEARANCE_VERSION is {APPEARANCE_VERSION} -- regenerate the golden \
         (and rename it) whenever APPEARANCE_VERSION changes"
    );

    assert_eq!(
        golden_rows.len(),
        IDS.len() * 2,
        "golden has {} rows but this test derives {} (one per id, per family) -- regenerate the golden",
        golden_rows.len(),
        IDS.len() * 2
    );

    let catalogue = test_catalogue();
    let mut row_iter = golden_rows.iter();
    for id in IDS {
        for family in [Family::Adult, Family::Kid] {
            let row = row_iter
                .next()
                .expect("golden has fewer rows than expected");
            assert_eq!(row.id, id, "golden row order does not match IDS x families");
            assert_eq!(
                row.family, family,
                "golden row order does not match IDS x families"
            );

            let actual = generate(id, family, &catalogue);
            assert_eq!(
                actual, row.tuple,
                "appearance output moved for id {id}, family {family:?}: golden has {:?}, \
                 regeneration produced {actual:?} -- if this is a deliberate change to \
                 sim::appearance's own algorithm or seeding, bump APPEARANCE_VERSION and \
                 regenerate the golden; the fixed test catalogue in this file must never be \
                 edited to make a real defs/ addition pass, since that is exactly the case \
                 this golden is pinned to be immune to",
                row.tuple
            );
        }
    }
}
