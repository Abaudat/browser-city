//! Every def kind, twice over: a `Raw*` shape `serde`/`toml` deserialises
//! one file into (`#[serde(deny_unknown_fields)]` so an unknown field is
//! a parse error, a missing field a parse error, and a wrong type a parse
//! error -- all three with a `toml::Spanned` span), and a plain `*Def`
//! shape [`crate::validate::validate`] produces once a whole tree checks
//! out. Only the plain shapes reach [`crate::emit`].
//!
//! Numeric ids are declared here, in their own file, never derived from
//! file order or position (Tim's direction) -- `id` is always the first
//! field of a kind that carries one; `balance` carries none; a future
//! balance table's own row id is a later story's problem.

use std::path::PathBuf;

use serde::Deserialize;
use toml::Spanned;

/// A parsed value together with the 1-based `(line, column)` its own TOML
/// span started at, resolved once (in `parse.rs`, while the file's source
/// text is still in scope) rather than carried forward as a raw byte
/// offset with no text to resolve it against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located<T> {
    pub value: T,
    pub line: usize,
    pub col: usize,
}

impl<T> Located<T> {
    pub fn at(value: T, line: usize, col: usize) -> Self {
        Self { value, line, col }
    }
}

// --- one-file-per-kind raw shapes, each an array of tables ------------------

/// Sub-cells per cell, the fixed unit a `collider` rect is declared in
/// (Tim's direction, story 1.8): never tied to `render.tile_size_px`,
/// because collision cannot change when art scale changes. Declared once,
/// here, and emitted into both generated artefacts by `emit.rs` -- a
/// literal 16 anywhere else in this crate or a caller is a defect.
pub const COLLIDER_SUBCELLS_PER_CELL: i64 = 16;

/// How far beyond its own footprint an `interact_at` rect may reach, on
/// every side, in whole cells (Tim's direction, story 1.9): unlike a
/// `collider`, a reach rect is meant to extend outside the footprint (you
/// stand *in front of* a counter), but never arbitrarily far -- an
/// interaction you can start from across the street is not an
/// interaction with an object. Declared once, here, and emitted into both
/// generated artefacts by `emit.rs` -- a literal 2 anywhere else in this
/// crate or a caller is a defect.
pub const INTERACT_AT_MAX_REACH_CELLS: i64 = 2;

/// FR127's cap: a footprint's `width` and `height` are each held to this,
/// independently, so a footprint is never wider or taller than
/// approximately 8 cells -- larger structures compose from multiple
/// objects. Declared once, here, next to [`COLLIDER_SUBCELLS_PER_CELL`],
/// and emitted into both generated artefacts by `emit.rs` -- a literal 8
/// anywhere else in this crate or a caller is a defect. The region-
/// subscription margin a future story adds depends on this being a real
/// constant (never re-derived): `server/sim/src/world/chunk.rs` asserts
/// at compile time that it never exceeds `CHUNK_SIZE`, once this constant
/// reaches `sim::generated::defs` (see `emit.rs`).
pub const MAX_FOOTPRINT_CELLS: i64 = 8;

/// The one root a `sprite.sheet` or an appearance part's `sheet` may ever
/// name (Quentin's direction, cycle 2): enforced in `validate.rs`
/// (`check_object_sprite_sheet_root`/`check_appearance_sheet_root`) after
/// normalising any `..` segments, so `ModernTileset/../client/x.png`
/// cannot present as rooted here just because the literal string starts
/// with it. `.github/workflows/ci.yml`'s `defs:` filter watches this
/// whole root (`scripts/ci/check-defs-sprite-root-filter.sh` pins the two
/// together), so a PR that only swaps a vendor PNG anywhere under it
/// still re-runs this crate's own `IHDR`-reading checks -- a guarantee
/// that only holds because every real sheet path is enforced to live
/// here, not by convention alone.
pub const SPRITE_SHEET_ALLOWED_ROOT: &str = "ModernTileset/";

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RawColliderRect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

/// One whole-object sprite rectangle (Tim's direction, story 2.2): the
/// tileset ships whole objects as single PNGs, so this is always one
/// rectangle, never a composited set. `sheet` is a path relative to the
/// repo root, under `ModernTileset/`; `x`/`y`/`w`/`h` are whole source
/// pixels. No `page` field: story 2.6's packer does not exist yet, so the
/// authored sheet path is the atlas page until it does -- this shape
/// never changes once that story lands, only what a build step does with
/// it.
#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RawSpriteRect {
    pub sheet: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawObject {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    /// A free-text display string (Tim's direction) -- never used as a
    /// lookup key; `key` stays the lookup. Never translated in this
    /// story.
    pub name: Spanned<String>,
    /// The layer's own name, as declared in `sim::codes::layer`'s golden
    /// (`server/sim/tests/goldens/codes_v1.golden`) -- resolved to its
    /// numeric code at build time (`validate.rs`); the runtime artefacts
    /// only ever carry the resolved code.
    pub layer: Spanned<String>,
    pub sprite: Spanned<RawSpriteRect>,
    pub width: u32,
    pub height: u32,
    /// A half-open integer rect in sub-cells relative to the footprint's
    /// own north-west sub-cell origin (its top-left, matching the
    /// sprite's own pixel space -- FR128). Not the same corner as the
    /// *anchor cell* a placed row's `x`/`y` names, which is the
    /// footprint's smallest x, largest y cell (its south-west corner, the
    /// AC's own convention): the two coincide only for a one-cell-tall
    /// object, which is every object today. Absent means walkable --
    /// there is no separate `walkable` flag anywhere.
    pub collider: Option<Spanned<RawColliderRect>>,
    /// Story 1.9 (FR148): where a player must stand to interact with this
    /// object -- a half-open integer rect in sub-cells relative to the
    /// same north-west sub-cell origin a `collider` uses. Unlike a
    /// `collider` it may reach outside the footprint (up to
    /// [`INTERACT_AT_MAX_REACH_CELLS`] on every side). Its presence *is*
    /// the declaration that this object has an interaction; there is no
    /// separate `interactable` flag anywhere.
    pub interact_at: Option<Spanned<RawColliderRect>>,
    /// Story 1.7 (FR121): a window wall tile draws semi-transparently
    /// (`render.window_alpha`, a balance key -- never a literal) and lets
    /// near-side retraction hide it exactly like any other front wall.
    /// Optional, defaults to `false` -- most objects are not windows.
    #[serde(default)]
    pub window: bool,
    /// Story 2.10 (FR111): the generic vocabulary a rule engine reasons
    /// over -- never a literal object/def key. Optional, defaults to
    /// empty; every named tag must already exist in `defs/tags/*.toml`
    /// (`validate.rs`'s own dangling-reference check).
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObjectFile {
    pub object: Vec<RawObject>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawItem {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemFile {
    pub item: Vec<RawItem>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawRecipe {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeFile {
    pub recipe: Vec<RawRecipe>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawProfession {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfessionFile {
    pub profession: Vec<RawProfession>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawChain {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub links: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChainFile {
    pub chain: Vec<RawChain>,
}

/// One part sheet's family (FR61/FR62). A layout is only ever shared
/// *within* a family -- adults and kids never mix parts, so the generator
/// and the layout invariant both branch on this before anything else.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Family {
    Adult,
    Kid,
}

impl Family {
    pub fn as_str(self) -> &'static str {
        match self {
            Family::Adult => "adult",
            Family::Kid => "kid",
        }
    }
}

/// Which pool a part is drawn from. `Civilian` is eligible for random
/// generation; `RoleOnly` is reserved for a `[[uniform]]` override and
/// never rolled at random; `Costume` is dead content until a future
/// system (a holiday, a party) gives it a reason to exist.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Pool {
    Civilian,
    RoleOnly,
    Costume,
}

impl Pool {
    pub fn as_str(self) -> &'static str {
        match self {
            Pool::Civilian => "civilian",
            Pool::RoleOnly => "role_only",
            Pool::Costume => "costume",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawBody {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub family: Spanned<Family>,
    pub sheet: Spanned<String>,
    pub pool: Spanned<Pool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawEyes {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub family: Spanned<Family>,
    pub sheet: Spanned<String>,
    pub pool: Spanned<Pool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawHairstyle {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub family: Spanned<Family>,
    pub sheet: Spanned<String>,
    pub style: u32,
    pub color: u32,
    pub rare: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawOutfit {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub family: Spanned<Family>,
    pub sheet: Spanned<String>,
    pub pool: Spanned<Pool>,
    #[serde(default)]
    pub hides_hairstyle: bool,
}

/// Where on the body an accessory sits. A uniform accessory override
/// removes the citizen's own civilian accessory only when both share a
/// slot (a helmet removes a beanie; a hi-vis jacket over a beard keeps
/// the beard) -- otherwise it draws as an additional layer on top.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    Face,
    Head,
    Back,
    Torso,
    Hands,
}

impl Slot {
    pub fn as_str(self) -> &'static str {
        match self {
            Slot::Face => "face",
            Slot::Head => "head",
            Slot::Back => "back",
            Slot::Torso => "torso",
            Slot::Hands => "hands",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawAccessory {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub family: Spanned<Family>,
    pub sheet: Spanned<String>,
    pub pool: Spanned<Pool>,
    pub slot: Spanned<Slot>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct RawAppearanceLayoutRow {
    pub animation: String,
    pub row: u32,
    pub frames_per_direction: u32,
}

/// One exact sheet size a family accepts. A layout matches sheets by
/// exact size, never "big enough": the vendor sheets are not uniform (an
/// adult body sheet is wider than an adult eyes sheet, an addon sheet is
/// shorter than either), so the declared set is every size the family's
/// own real sheets actually use, and nothing else. A new sheet size is
/// always a defs change here, never something the checker infers.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RawSheetSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawAppearanceLayout {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub family: Spanned<Family>,
    pub cell_width: u32,
    pub cell_height: u32,
    pub directions: Vec<String>,
    pub rows: Vec<RawAppearanceLayoutRow>,
    pub accepted_sizes: Spanned<Vec<RawSheetSize>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawUniform {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub profession: Spanned<String>,
    #[serde(default)]
    pub outfit: Option<String>,
    #[serde(default)]
    pub accessory: Option<String>,
}

/// `defs/appearance/*.toml` may declare any mix of the seven array kinds
/// below in one file -- unlike every other `defs/` directory, this one
/// holds several distinct kinds side by side (`[[body]]`, `[[eyes]]`,
/// `[[outfit]]`, `[[hairstyle]]`, `[[accessory]]`, plus
/// `[[appearance_layout]]` and `[[uniform]]`), so a single raw file shape
/// with every array defaulted to empty is simpler than inventing a second
/// `kind_of` dispatch.
#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct AppearanceFile {
    #[serde(default)]
    pub body: Vec<RawBody>,
    #[serde(default)]
    pub eyes: Vec<RawEyes>,
    #[serde(default)]
    pub hairstyle: Vec<RawHairstyle>,
    #[serde(default)]
    pub outfit: Vec<RawOutfit>,
    #[serde(default)]
    pub accessory: Vec<RawAccessory>,
    #[serde(default)]
    pub appearance_layout: Vec<RawAppearanceLayout>,
    #[serde(default)]
    pub uniform: Vec<RawUniform>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawBalance {
    pub key: Spanned<String>,
    pub value: Spanned<i64>,
    pub min: i64,
    pub max: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalanceFile {
    pub balance: Vec<RawBalance>,
}

// --- tags (story 2.10, FR111): the rule engine's only vocabulary -----------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawTag {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TagFile {
    pub tag: Vec<RawTag>,
}

// --- rules (story 2.10, FR111/FR112): five closed constraint kinds ---------
//
// Tim's direction: a rule is a fixed-schema row, never a formula -- every
// enum below is closed, `deny_unknown_fields` per kind, and every tag
// reference is an authored key (resolved to a `sim::rules::TagId` in
// `validate.rs`, never a literal object/def key past this crate).

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RawCoherenceMode {
    Allow,
    Forbid,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RawAdjacencyRelation {
    Forbid,
    Require,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RawDirection {
    North,
    East,
    South,
    West,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawPlacementRule {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub subject: Spanned<String>,
    #[serde(default)]
    pub container: Option<Spanned<String>>,
    #[serde(default)]
    pub floor_min: Option<i8>,
    #[serde(default)]
    pub floor_max: Option<i8>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawDistributionRule {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub subject: Spanned<String>,
    pub per: Spanned<String>,
    pub ratio: Spanned<i32>,
    pub tolerance_percent: Spanned<i32>,
    pub min_spacing: u32,
    pub max_distance: Spanned<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawCoherenceRule {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub subject: Spanned<String>,
    pub within: Spanned<String>,
    pub mode: RawCoherenceMode,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawAdjacencyRule {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub a: Spanned<String>,
    pub b: Spanned<String>,
    pub relation: RawAdjacencyRelation,
    #[serde(default)]
    pub direction: Option<RawDirection>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawRequirementRule {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub container: Spanned<String>,
    pub requires: Spanned<String>,
    pub min: u32,
    #[serde(default)]
    pub max: Option<u32>,
}

/// `defs/rules/*.toml` may declare any mix of the five kinds below in one
/// file (files are named by subject, e.g. `cafes.toml` -- Tim's
/// direction), exactly like `AppearanceFile`'s own several-kinds-per-file
/// shape.
#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct RuleFile {
    #[serde(default)]
    pub placement: Vec<RawPlacementRule>,
    #[serde(default)]
    pub distribution: Vec<RawDistributionRule>,
    #[serde(default)]
    pub coherence: Vec<RawCoherenceRule>,
    #[serde(default)]
    pub adjacency: Vec<RawAdjacencyRule>,
    #[serde(default)]
    pub requirement: Vec<RawRequirementRule>,
}

// --- entries: one Raw* row plus the file it came from, spans resolved ------

#[derive(Debug)]
pub struct ObjectEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub name: Located<String>,
    /// The authored layer *name*, not yet resolved -- `validate.rs`
    /// resolves it against the codes golden and stores the numeric code
    /// on [`ObjectDef`].
    pub layer: Located<String>,
    pub sprite: Located<RawSpriteRect>,
    pub width: u32,
    pub height: u32,
    pub collider: Option<Located<RawColliderRect>>,
    pub interact_at: Option<Located<RawColliderRect>>,
    pub window: bool,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub struct ItemEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
}

#[derive(Debug)]
pub struct RecipeEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

#[derive(Debug)]
pub struct ProfessionEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
}

#[derive(Debug)]
pub struct ChainEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub links: Vec<String>,
}

#[derive(Debug)]
pub struct BalanceEntry {
    pub path: PathBuf,
    pub key: Located<String>,
    pub value: Located<i64>,
    pub min: i64,
    pub max: i64,
}

#[derive(Debug)]
pub struct BodyEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub family: Located<Family>,
    pub sheet: Located<String>,
    pub pool: Located<Pool>,
}

#[derive(Debug)]
pub struct EyesEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub family: Located<Family>,
    pub sheet: Located<String>,
    pub pool: Located<Pool>,
}

#[derive(Debug)]
pub struct HairstyleEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub family: Located<Family>,
    pub sheet: Located<String>,
    pub style: u32,
    pub color: u32,
    pub rare: bool,
}

#[derive(Debug)]
pub struct OutfitEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub family: Located<Family>,
    pub sheet: Located<String>,
    pub pool: Located<Pool>,
    pub hides_hairstyle: bool,
}

#[derive(Debug)]
pub struct AccessoryEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub family: Located<Family>,
    pub sheet: Located<String>,
    pub pool: Located<Pool>,
    pub slot: Located<Slot>,
}

#[derive(Debug, Clone)]
pub struct AppearanceLayoutRowEntry {
    pub animation: String,
    pub row: u32,
    pub frames_per_direction: u32,
}

#[derive(Debug)]
pub struct AppearanceLayoutEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub family: Located<Family>,
    pub cell_width: u32,
    pub cell_height: u32,
    pub directions: Vec<String>,
    pub rows: Vec<AppearanceLayoutRowEntry>,
    pub accepted_sizes: Located<Vec<(u32, u32)>>,
}

#[derive(Debug)]
pub struct UniformEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub profession: Located<String>,
    pub outfit: Option<String>,
    pub accessory: Option<String>,
}

#[derive(Debug)]
pub struct TagEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
}

#[derive(Debug)]
pub struct PlacementEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub subject: Located<String>,
    pub container: Option<Located<String>>,
    pub floor_min: Option<i8>,
    pub floor_max: Option<i8>,
}

#[derive(Debug)]
pub struct DistributionEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub subject: Located<String>,
    pub per: Located<String>,
    pub ratio: Located<i32>,
    pub tolerance_percent: Located<i32>,
    pub min_spacing: u32,
    pub max_distance: Located<u32>,
}

#[derive(Debug)]
pub struct CoherenceEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub subject: Located<String>,
    pub within: Located<String>,
    pub mode: RawCoherenceMode,
}

#[derive(Debug)]
pub struct AdjacencyEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub a: Located<String>,
    pub b: Located<String>,
    pub relation: RawAdjacencyRelation,
    pub direction: Option<RawDirection>,
}

#[derive(Debug)]
pub struct RequirementEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub container: Located<String>,
    pub requires: Located<String>,
    pub min: u32,
    pub max: Option<u32>,
}

/// An entry that carries a permanent, explicit numeric id and a key --
/// every kind except `balance` (Tim's direction: balance seeds a future
/// table by dotted key, never an id, in this story).
pub trait IdKeyEntry {
    fn path(&self) -> &std::path::Path;
    fn id(&self) -> &Located<u32>;
    fn key(&self) -> &Located<String>;
}

macro_rules! impl_id_key_entry {
    ($t:ty) => {
        impl IdKeyEntry for $t {
            fn path(&self) -> &std::path::Path {
                &self.path
            }
            fn id(&self) -> &Located<u32> {
                &self.id
            }
            fn key(&self) -> &Located<String> {
                &self.key
            }
        }
    };
}

impl_id_key_entry!(ObjectEntry);
impl_id_key_entry!(ItemEntry);
impl_id_key_entry!(RecipeEntry);
impl_id_key_entry!(ProfessionEntry);
impl_id_key_entry!(ChainEntry);
impl_id_key_entry!(BodyEntry);
impl_id_key_entry!(EyesEntry);
impl_id_key_entry!(HairstyleEntry);
impl_id_key_entry!(OutfitEntry);
impl_id_key_entry!(AccessoryEntry);
impl_id_key_entry!(AppearanceLayoutEntry);
impl_id_key_entry!(UniformEntry);
impl_id_key_entry!(TagEntry);
impl_id_key_entry!(PlacementEntry);
impl_id_key_entry!(DistributionEntry);
impl_id_key_entry!(CoherenceEntry);
impl_id_key_entry!(AdjacencyEntry);
impl_id_key_entry!(RequirementEntry);

#[derive(Debug, Default)]
pub struct RawDefs {
    pub objects: Vec<ObjectEntry>,
    pub items: Vec<ItemEntry>,
    pub recipes: Vec<RecipeEntry>,
    pub professions: Vec<ProfessionEntry>,
    pub chains: Vec<ChainEntry>,
    pub balance: Vec<BalanceEntry>,
    pub bodies: Vec<BodyEntry>,
    pub eyes: Vec<EyesEntry>,
    pub hairstyles: Vec<HairstyleEntry>,
    pub outfits: Vec<OutfitEntry>,
    pub accessories: Vec<AccessoryEntry>,
    pub appearance_layouts: Vec<AppearanceLayoutEntry>,
    pub uniforms: Vec<UniformEntry>,
    pub tags: Vec<TagEntry>,
    pub placements: Vec<PlacementEntry>,
    pub distributions: Vec<DistributionEntry>,
    pub coherences: Vec<CoherenceEntry>,
    pub adjacencies: Vec<AdjacencyEntry>,
    pub requirements: Vec<RequirementEntry>,
}

// --- the plain, validated shapes emit.rs reads ------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColliderRect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpriteRect {
    pub sheet: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectDef {
    pub id: u32,
    pub key: String,
    pub name: String,
    /// The resolved `sim::codes::layer` numeric code -- never the
    /// authored name past `validate.rs`.
    pub layer: u32,
    pub sprite: SpriteRect,
    pub width: u32,
    pub height: u32,
    pub collider: Option<ColliderRect>,
    /// Present exactly when this object declares an interaction (FR148).
    pub interact_at: Option<ColliderRect>,
    pub window: bool,
    /// Resolved tag ids (story 2.10, FR111), sorted and deduplicated --
    /// the engine's only vocabulary, never a literal key past this point.
    pub tags: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemDef {
    pub id: u32,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipeDef {
    pub id: u32,
    pub key: String,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfessionDef {
    pub id: u32,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainDef {
    pub id: u32,
    pub key: String,
    pub links: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BalanceDef {
    pub key: String,
    pub value: i64,
    pub min: i64,
    pub max: i64,
}

/// Story 1.10's five appearance part kinds store their id as `u16` (the
/// `citizen` schema columns and the generator's tuple are `u16`): a
/// declared id above 65535 would silently truncate, so `validate.rs`
/// rejects it before it ever reaches this struct.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyDef {
    pub id: u16,
    pub key: String,
    pub family: Family,
    pub sheet: String,
    pub pool: Pool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EyesDef {
    pub id: u16,
    pub key: String,
    pub family: Family,
    pub sheet: String,
    pub pool: Pool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HairstyleDef {
    pub id: u16,
    pub key: String,
    pub family: Family,
    pub sheet: String,
    pub style: u32,
    pub color: u32,
    pub rare: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutfitDef {
    pub id: u16,
    pub key: String,
    pub family: Family,
    pub sheet: String,
    pub pool: Pool,
    pub hides_hairstyle: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessoryDef {
    pub id: u16,
    pub key: String,
    pub family: Family,
    pub sheet: String,
    pub pool: Pool,
    pub slot: Slot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppearanceLayoutRowDef {
    pub animation: String,
    pub row: u32,
    pub frames_per_direction: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppearanceLayoutDef {
    pub id: u32,
    pub key: String,
    pub family: Family,
    pub cell_width: u32,
    pub cell_height: u32,
    pub directions: Vec<String>,
    pub rows: Vec<AppearanceLayoutRowDef>,
    pub accepted_sizes: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UniformDef {
    pub id: u32,
    pub key: String,
    pub profession: String,
    pub outfit: Option<String>,
    pub accessory: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagDef {
    pub id: u32,
    pub key: String,
}

/// The validated, resolved (tag key -> id) shape of each rule kind --
/// mirrors `sim::rules::RuleKind` variant for variant, field for field
/// (Crew's decision: the two are hand-kept in sync, exactly like
/// `Family`/`Pool`/`Slot` already are between this crate and `emit.rs`'s
/// own generated text; `emit.rs`'s rule tests pin the exact printed Rust
/// literal against this shape).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleKindDef {
    Placement {
        subject: u32,
        container: Option<u32>,
        floor_min: Option<i8>,
        floor_max: Option<i8>,
    },
    Distribution {
        subject: u32,
        per: u32,
        ratio: u32,
        tolerance_percent: u32,
        min_spacing: u32,
        max_distance: u32,
    },
    Coherence {
        subject: u32,
        within: u32,
        mode: RawCoherenceMode,
    },
    Adjacency {
        a: u32,
        b: u32,
        relation: RawAdjacencyRelation,
        direction: Option<RawDirection>,
    },
    Requirement {
        container: u32,
        requires: u32,
        min: u32,
        max: Option<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleDef {
    pub id: u32,
    pub key: String,
    pub kind: RuleKindDef,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Defs {
    pub objects: Vec<ObjectDef>,
    pub items: Vec<ItemDef>,
    pub recipes: Vec<RecipeDef>,
    pub professions: Vec<ProfessionDef>,
    pub chains: Vec<ChainDef>,
    pub balance: Vec<BalanceDef>,
    pub bodies: Vec<BodyDef>,
    pub eyes: Vec<EyesDef>,
    pub hairstyles: Vec<HairstyleDef>,
    pub outfits: Vec<OutfitDef>,
    pub accessories: Vec<AccessoryDef>,
    pub appearance_layouts: Vec<AppearanceLayoutDef>,
    pub uniforms: Vec<UniformDef>,
    pub tags: Vec<TagDef>,
    pub rules: Vec<RuleDef>,
}
