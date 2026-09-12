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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawObject {
    pub id: Spanned<u32>,
    pub key: Spanned<String>,
    pub width: u32,
    pub height: u32,
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

// --- entries: one Raw* row plus the file it came from, spans resolved ------

#[derive(Debug)]
pub struct ObjectEntry {
    pub path: PathBuf,
    pub id: Located<u32>,
    pub key: Located<String>,
    pub width: u32,
    pub height: u32,
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

#[derive(Debug, Default)]
pub struct RawDefs {
    pub objects: Vec<ObjectEntry>,
    pub items: Vec<ItemEntry>,
    pub recipes: Vec<RecipeEntry>,
    pub professions: Vec<ProfessionEntry>,
    pub chains: Vec<ChainEntry>,
    pub balance: Vec<BalanceEntry>,
}

// --- the plain, validated shapes emit.rs reads ------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectDef {
    pub id: u32,
    pub key: String,
    pub width: u32,
    pub height: u32,
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Defs {
    pub objects: Vec<ObjectDef>,
    pub items: Vec<ItemDef>,
    pub recipes: Vec<RecipeDef>,
    pub professions: Vec<ProfessionDef>,
    pub chains: Vec<ChainDef>,
    pub balance: Vec<BalanceDef>,
}
