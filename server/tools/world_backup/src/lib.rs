//! Pure logic for story 1.4's backup/restore pipeline: parsing and
//! canonicalising `spacetime sql --format json` output, and rendering
//! `spacetime call` arguments for a `restore_<table>` reducer. Kept below
//! the integration test (`scripts/ci/check-backup-restore.sh`) the same
//! way `sim` is kept below `browser_city` (NFR28's split, read as a test
//! pyramid rather than a purity rule here): every function in this file
//! is `cargo test`-able with no `spacetime` instance.
//!
//! Every number passes through `serde_json::Value` with the
//! `arbitrary_precision` feature enabled, never through an `f64`.
//! `arbitrary_precision` keeps a number's own decimal text as its
//! internal representation end to end, so it is exact by construction,
//! not by care at each call site.
//!
//! Not `jq`, but not because `jq` cannot do this: cycle 1 of this story
//! shipped a `jq`-based canonicaliser on the assumption that `jq`
//! re-serialises every JSON number through an IEEE double, silently
//! corrupting a `u64` (`chunk_key`, an auto_inc id) above 2^53. Review
//! found that premise wrong for a current `jq` -- confirmed here:
//! `jq 1.8.2` passes `18446744073709551615` through `.`/`sort` exactly,
//! unchanged (`jq` 1.7+ added exact big-integer handling). This crate
//! exists regardless, because the real reason to own this logic natively
//! is that parsing/canonicalisation belongs in the stack this repo
//! already tests (`cargo test`, the `bounds` crate's own `ModuleSchema`/
//! `TableDef` types), not a `jq`-version compatibility question.

use std::collections::BTreeMap;

use bounds::schema::{ModuleSchema, TableDef};
use serde::Deserialize;
use serde_json::Value;

/// One `spacetime sql --format json "SELECT * FROM t"` response -- always
/// a one-element array of this shape in SpacetimeDB 2.9. A shape it no
/// longer matches is a hard, loud error everywhere this is parsed, never
/// a quiet empty result (an UNSTABLE CLI's output format is exactly the
/// kind of thing that drifts on a version bump).
#[derive(Debug, Deserialize)]
pub struct SqlResponse {
    pub schema: SqlSchema,
    pub rows: Vec<Value>,
}

#[derive(Debug, Deserialize)]
pub struct SqlSchema {
    pub elements: Vec<SqlColumn>,
}

#[derive(Debug, Deserialize)]
pub struct SqlColumn {
    pub name: SqlName,
    pub algebraic_type: Value,
}

#[derive(Debug, Deserialize)]
pub struct SqlName {
    pub some: String,
}

#[derive(Debug)]
pub struct WorldBackupError(pub String);

impl std::fmt::Display for WorldBackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for WorldBackupError {}

pub type Result<T> = std::result::Result<T, WorldBackupError>;

fn err(msg: impl Into<String>) -> WorldBackupError {
    WorldBackupError(msg.into())
}

/// Parses one `spacetime sql --format json` response's outer `[{...}]`
/// wrapper and returns the one object inside it.
pub fn parse_response(text: &str) -> Result<SqlResponse> {
    let mut docs: Vec<SqlResponse> = serde_json::from_str(text).map_err(|e| {
        err(format!(
            "not a valid 'spacetime sql --format json' response: {e}"
        ))
    })?;
    if docs.len() != 1 {
        return Err(err(format!(
            "expected a one-element JSON array, got {} elements -- 'spacetime sql --format json' shape drifted",
            docs.len()
        )));
    }
    Ok(docs.remove(0))
}

/// SpacetimeDB echoes a column name back with an underscore inserted at a
/// letter/digit boundary (`x0` -> `x_0`, confirmed empirically) -- names
/// are compared with underscores stripped and lowercased so a snapshot
/// name and a live column name agree regardless.
pub fn normalize_name(name: &str) -> String {
    name.chars()
        .filter(|c| *c != '_')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// A short tag for the column types this crate knows how to render as a
/// `spacetime call` argument or an edge-case seed value. `Other` is a
/// hard failure everywhere it is produced from, by design (Tim's
/// direction): a column type this crate cannot fill or render must never
/// be silently skipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ColKind {
    Bool,
    U8,
    U16,
    U32,
    U64,
    U128,
    U256,
    I8,
    I16,
    I32,
    I64,
    I128,
    I256,
    String,
    Identity,
    ConnectionId,
    Timestamp,
    Schedule,
    Other,
}

pub fn column_kind(algebraic_type: &Value) -> ColKind {
    let Some(obj) = algebraic_type.as_object() else {
        return ColKind::Other;
    };
    if obj.len() != 1 {
        return ColKind::Other;
    }
    let (key, val) = obj.iter().next().unwrap();
    match key.as_str() {
        "Bool" => ColKind::Bool,
        "U8" => ColKind::U8,
        "U16" => ColKind::U16,
        "U32" => ColKind::U32,
        "U64" => ColKind::U64,
        "U128" => ColKind::U128,
        "U256" => ColKind::U256,
        "I8" => ColKind::I8,
        "I16" => ColKind::I16,
        "I32" => ColKind::I32,
        "I64" => ColKind::I64,
        "I128" => ColKind::I128,
        "I256" => ColKind::I256,
        "String" => ColKind::String,
        "Product" => {
            let elements = val.get("elements").and_then(|e| e.as_array());
            let Some(elements) = elements else {
                return ColKind::Other;
            };
            if elements.len() != 1 {
                return ColKind::Other;
            }
            let name = elements[0]
                .get("name")
                .and_then(|n| n.get("some"))
                .and_then(|s| s.as_str());
            match name {
                Some("__identity__") => ColKind::Identity,
                Some("__connection_id__") => ColKind::ConnectionId,
                Some("__timestamp_micros_since_unix_epoch__") => ColKind::Timestamp,
                _ => ColKind::Other,
            }
        }
        "Sum" => {
            let variants = val.get("variants").and_then(|v| v.as_array());
            let Some(variants) = variants else {
                return ColKind::Other;
            };
            let names: std::collections::BTreeSet<_> = variants
                .iter()
                .filter_map(|v| {
                    v.get("name")
                        .and_then(|n| n.get("some"))
                        .and_then(|s| s.as_str())
                })
                .collect();
            if names.contains("Interval") && names.contains("Time") && names.len() == 2 {
                ColKind::Schedule
            } else {
                ColKind::Other
            }
        }
        _ => ColKind::Other,
    }
}

pub fn column_kinds(resp: &SqlResponse) -> Vec<ColKind> {
    resp.schema
        .elements
        .iter()
        .map(|c| column_kind(&c.algebraic_type))
        .collect()
}

pub fn column_names(resp: &SqlResponse) -> Vec<String> {
    resp.schema
        .elements
        .iter()
        .map(|c| c.name.some.clone())
        .collect()
}

/// Finds `accessor`'s primary-key column name in `snapshot`, or an error
/// naming the table if it declares none (every table in this schema has
/// exactly one -- `server/bounds/tests/schema_shape.rs` -- but this crate
/// never assumes that of a snapshot it did not itself generate).
pub fn primary_key_column<'a>(snapshot: &'a ModuleSchema, accessor: &str) -> Result<&'a str> {
    let table = table_def(snapshot, accessor)?;
    table
        .columns
        .iter()
        .find(|c| c.primary_key)
        .map(|c| c.name.as_str())
        .ok_or_else(|| {
            err(format!(
                "'{accessor}' has no primary_key column in the snapshot"
            ))
        })
}

/// The index of `column` among `resp`'s own live columns (name-
/// normalised), or an error naming every live column found -- used by
/// `column-values` to extract one column's values exactly, by name,
/// rather than a bare `grep` of the raw response that could match a
/// substring anywhere in the line (Quentin's direction: sentinel
/// assertions must be by column on a known row).
pub fn column_index(resp: &SqlResponse, column: &str) -> Result<usize> {
    let want = normalize_name(column);
    let live = column_names(resp);
    live.iter()
        .position(|n| normalize_name(n) == want)
        .ok_or_else(|| {
            err(format!(
                "column '{column}' not found among [{}]",
                live.join(", ")
            ))
        })
}

/// Every row's value at `column`, as one canonical JSON-value line each
/// (the same exact-precision text `row_to_line` would give that one
/// field) -- an Identity/Timestamp stays wrapped (`["0x..."]`/`[micros]`),
/// exactly as `spacetime sql --format json` -- and the reducer-call arg
/// shape both give it, so a caller compares against the same literal it
/// would pass to a `restore_<table>` call.
pub fn column_values(resp: &SqlResponse, column: &str) -> Result<Vec<String>> {
    let index = column_index(resp, column)?;
    resp.rows
        .iter()
        .map(|row| {
            let field = row
                .as_array()
                .and_then(|a| a.get(index))
                .ok_or_else(|| err("a row is shorter than its schema's column count"))?;
            Ok(serde_json::to_string(field).expect("a parsed field always re-serializes"))
        })
        .collect()
}

/// Every non-scheduled table with an auto_inc primary key that SQL can
/// also write to directly with an all-zero probe row (no `Timestamp`/
/// `ScheduleAt` column -- SQL cannot construct either literal at all --
/// and no `Identity`/`ConnectionId` column either -- SQL can write one,
/// but only as a real hex literal, not the `0` this generator's probe
/// row always uses for a non-string, non-bool column) -- derived from
/// the snapshot, never a hand-written list, so `verify-independent.sh`'s
/// auto_inc probe covers every table it actually can the moment a new
/// one is added.
pub fn sql_probeable_autoinc_tables(snapshot: &ModuleSchema) -> Vec<String> {
    snapshot
        .tables
        .iter()
        .filter(|t| t.scheduled_reducer.is_none())
        .filter(|t| t.columns.iter().any(|c| c.primary_key && c.auto_inc))
        .filter(|t| {
            !t.columns.iter().any(|c| {
                matches!(
                    c.ty.as_str(),
                    "Timestamp" | "ScheduleAt" | "Identity" | "ConnectionId"
                )
            })
        })
        .map(|t| t.accessor.clone())
        .collect()
}

/// `accessor`'s auto_inc primary-key column name, or an error if it has
/// none -- used to build the probe insert for
/// [`sql_probeable_autoinc_tables`]' members.
pub fn auto_inc_column<'a>(snapshot: &'a ModuleSchema, accessor: &str) -> Result<&'a str> {
    let table = table_def(snapshot, accessor)?;
    table
        .columns
        .iter()
        .find(|c| c.primary_key && c.auto_inc)
        .map(|c| c.name.as_str())
        .ok_or_else(|| err(format!("'{accessor}' has no auto_inc primary_key column")))
}

/// Every non-scheduled table with an auto_inc primary key, regardless of
/// its other columns' types -- unlike [`sql_probeable_autoinc_tables`],
/// which excludes anything SQL cannot also write a *probe row* to.
/// `st_sequence` (a system table, distinct from the target table's own
/// row data) is readable via SQL for every auto_inc table without
/// exception, so `export-world.sh`'s own sequence-floor reads use this
/// list, never the narrower SQL-probeable one.
pub fn autoinc_tables(snapshot: &ModuleSchema) -> Vec<String> {
    snapshot
        .tables
        .iter()
        .filter(|t| t.scheduled_reducer.is_none())
        .filter(|t| t.columns.iter().any(|c| c.primary_key && c.auto_inc))
        .map(|t| t.accessor.clone())
        .collect()
}

/// `table`'s auto_inc `column`'s own `st_sequence.allocated` value, read
/// from a `SELECT * FROM st_sequence` response -- a safe upper bound on
/// every id that table's sequence has ever issued (SpacetimeDB
/// pre-allocates `auto_inc` ids in blocks; `allocated` is the current
/// block's own ceiling, confirmed empirically, never smaller than the
/// highest id actually used). `sequence_name`'s own naming convention,
/// confirmed empirically against a real local instance: `<table>_
/// <column>_seq`.
pub fn sequence_floor(resp: &SqlResponse, table: &str, column: &str) -> Result<String> {
    let name_index = column_index(resp, "sequence_name")?;
    let allocated_index = column_index(resp, "allocated")?;
    let want = format!("{table}_{column}_seq");
    for row in &resp.rows {
        let arr = row
            .as_array()
            .ok_or_else(|| err("st_sequence row is not an array"))?;
        let name = arr
            .get(name_index)
            .and_then(|v| v.as_str())
            .ok_or_else(|| err("st_sequence row's sequence_name is not a string"))?;
        if name == want {
            let allocated = arr
                .get(allocated_index)
                .ok_or_else(|| err("st_sequence row is shorter than its schema's column count"))?;
            return match allocated {
                Value::Number(n) => Ok(n.to_string()),
                other => Err(err(format!(
                    "st_sequence.allocated for '{want}' is not a plain integer: {other}"
                ))),
            };
        }
    }
    Err(err(format!(
        "no st_sequence row named '{want}' -- sequence_name's naming convention may have changed"
    )))
}

/// The primary-key value of `accessor`'s own highest exported row (by
/// [`canonical_rows`]' real-primary-key sort, never column 0 or a
/// `sed`/`sort -g` pipeline over raw text, which both re-introduces the
/// "primary key is column 0" assumption `canonical_rows` itself was built
/// to remove, and compares through a machine float via `sort -g`) --
/// `None` if the table has no rows.
pub fn max_pk(
    snapshot: &ModuleSchema,
    accessor: &str,
    resp: &SqlResponse,
) -> Result<Option<String>> {
    let rows = canonical_rows(snapshot, accessor, resp)?;
    let Some(last) = rows.last() else {
        return Ok(None);
    };
    let pk_index = primary_key_index(snapshot, accessor, resp)?;
    let field = last
        .as_array()
        .and_then(|a| a.get(pk_index))
        .ok_or_else(|| err("a row is shorter than its schema's column count"))?;
    match field {
        Value::Number(n) => Ok(Some(n.to_string())),
        other => Err(err(format!(
            "primary key value is not a plain integer: {other}"
        ))),
    }
}

/// The exact adversarial string [`edge_values`] seeds every `String`
/// column with -- exposed here so a caller building the *expected* value
/// for a sentinel check (`scripts/ci/check-backup-restore.sh`) reuses the
/// literal bytes [`edge_values`] itself seeds with, rather than
/// retyping them (a latent drift risk) or reaching for `jq` to
/// JSON-escape a hand-typed copy (`docs/architecture.md`'s "never `jq`"
/// rule, Tim's direction).
pub const ADVERSARIAL_STRING: &str =
    "adversarial: '\"quote\"'\tTAB\nNEWLINE\rCR\\backslash\\'literal-\\n'pipe|emoji\u{1F600}";

/// `manifest`'s own `sequence_floors.<table>` value, as exact decimal
/// text -- parsed with `serde_json`'s `arbitrary_precision`, never a
/// hand-rolled regex over the manifest's raw text (the same precision
/// risk `docs/architecture.md`'s "never `jq`" rule exists to avoid, just
/// reached a different way).
///
/// A hard error, never a silent `"0"`, if `table` has no entry or
/// `sequence_floors` is missing entirely (Tim's direction): `export-
/// world.sh` always writes one entry per auto_inc table, so a missing
/// one only ever means a truncated, hand-edited or pre-cycle-4 manifest
/// -- reading that as `"0"` (`restore_autoinc_rows`'s own "do not
/// advance" sentinel, used only for a non-final batch, never for this
/// function's own return value) would silently bring back the very id
/// re-use this cycle removed. There is no legacy export to stay
/// compatible with: nothing has ever gone live, and no backup has ever
/// actually been taken. An empty table whose sequence was never touched
/// still gets a real, explicit `"0"` from export -- the only legitimate
/// zero, and it still round-trips through here exactly, since it is a
/// present entry, not a missing one.
pub fn manifest_sequence_floor(manifest: &Value, table: &str) -> Result<String> {
    let floors = manifest.get("sequence_floors").ok_or_else(|| {
        err(format!(
            "manifest.json has no sequence_floors at all -- cannot restore auto_inc table '{table}' without its recorded floor (a truncated, hand-edited or pre-cycle-4 export?)"
        ))
    })?;
    let value = floors.get(table).ok_or_else(|| {
        err(format!(
            "manifest.json's sequence_floors has no entry for '{table}' -- cannot restore it without its recorded floor (a truncated, hand-edited or pre-cycle-4 export?)"
        ))
    })?;
    match value {
        Value::Number(n) => Ok(n.to_string()),
        other => Err(err(format!(
            "manifest.json's sequence_floors.{table} is not a plain integer: {other}"
        ))),
    }
}

pub fn table_def<'a>(snapshot: &'a ModuleSchema, accessor: &str) -> Result<&'a TableDef> {
    snapshot
        .tables
        .iter()
        .find(|t| t.accessor == accessor)
        .ok_or_else(|| err(format!("no table named '{accessor}' in the snapshot")))
}

/// The index, among `resp`'s own live columns, of `accessor`'s
/// primary-key column (name-normalised). An error, never a silent
/// fallback to column 0 -- a table whose key is not the first column
/// must be sorted by its real key, not by assumption.
pub fn primary_key_index(
    snapshot: &ModuleSchema,
    accessor: &str,
    resp: &SqlResponse,
) -> Result<usize> {
    let pk_name = normalize_name(primary_key_column(snapshot, accessor)?);
    let live = column_names(resp);
    live.iter()
        .position(|n| normalize_name(n) == pk_name)
        .ok_or_else(|| {
            err(format!(
                "'{accessor}': primary key '{pk_name}' not found among live columns [{}]",
                live.join(", ")
            ))
        })
}

/// A row's value at `index` reduced to an exact, orderable key. Every
/// primary key in this schema is a plain non-negative integer
/// (u8/u32/u64, `#[primary_key]`) -- `serde_json`'s arbitrary-precision
/// number text is compared as a big integer (length, then lexicographic,
/// both exact for a non-negative integer's decimal text), never parsed
/// through a machine float.
fn pk_sort_key(row: &Value, index: usize) -> Result<(usize, String)> {
    let field = row
        .as_array()
        .and_then(|a| a.get(index))
        .ok_or_else(|| err("a row is shorter than its schema's column count"))?;
    let text = match field {
        Value::Number(n) => n.to_string(),
        other => {
            return Err(err(format!(
                "primary key value is not a plain integer: {other}"
            )));
        }
    };
    if text.starts_with('-') {
        return Err(err(format!("primary key value is negative: {text}")));
    }
    Ok((text.len(), text))
}

/// Sorts `resp.rows` by `accessor`'s real primary-key column (never
/// column 0 by assumption) and fails if that column is not unique across
/// the rows -- a future table whose key is not the first column, or a
/// duplicate that slipped through, is a hard error here rather than a
/// nondeterministic export.
pub fn canonical_rows(
    snapshot: &ModuleSchema,
    accessor: &str,
    resp: &SqlResponse,
) -> Result<Vec<Value>> {
    let pk_index = primary_key_index(snapshot, accessor, resp)?;
    let mut keyed: Vec<(String, Value)> = Vec::with_capacity(resp.rows.len());
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for row in &resp.rows {
        let (len, digits) = pk_sort_key(row, pk_index)?;
        let key = format!("{len:020}:{digits}");
        *seen.entry(key.clone()).or_insert(0) += 1;
        keyed.push((key, row.clone()));
    }
    if let Some((dup, _)) = seen.iter().find(|(_, count)| **count > 1) {
        return Err(err(format!(
            "'{accessor}': primary key is not unique across exported rows (key {dup})"
        )));
    }
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(keyed.into_iter().map(|(_, row)| row).collect())
}

/// One canonical row as one compact JSON line -- what `rows-canonical`
/// writes to a table's export file, and what `verify-world.sh` compares
/// byte for byte.
pub fn row_to_line(row: &Value) -> String {
    serde_json::to_string(row).expect("a parsed row always re-serializes")
}

/// Batches canonical rows (already-serialized JSON-line strings, e.g.
/// from a table's export file) into `spacetime call restore_<table>`
/// argument blobs, sized by a **byte** budget, never a row count
/// (Quentin's direction: a fixed row count breaks the moment a table's
/// average row size crosses the command-line length limit -- 131,072
/// bytes for one argv element on Linux, ~32K characters for the whole
/// command line on Windows). One pass over `lines`, never re-reading
/// from the start per batch (the quadratic bug this replaces).
///
/// Each batch is `[row1,row2,...]` -- the bare `Vec<Row>` value, with no
/// extra wrapping array: `spacetime call`'s one positional argument *is*
/// the reducer's one parameter's own JSON value (confirmed empirically;
/// an extra outer `[...]` is rejected as "expected u32, found a
/// sequence" the moment a struct's own first field is itself scalar).
pub fn batch_by_bytes<'a>(lines: impl Iterator<Item = &'a str>, max_bytes: usize) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut current_bytes = 2usize; // the batch's own `[]` wrapper
    for line in lines {
        // +1 for the row's own trailing comma once joined, +0 the first time.
        let added = line.len() + if current.is_empty() { 0 } else { 1 };
        if !current.is_empty() && current_bytes + added > max_bytes {
            batches.push(format!("[{}]", current.join(",")));
            current.clear();
            current_bytes = 2;
        }
        current.push(line);
        current_bytes += line.len() + if current.len() > 1 { 1 } else { 0 };
    }
    if !current.is_empty() {
        batches.push(format!("[{}]", current.join(",")));
    }
    batches
}

// --- schema-driven edge-value seeding (mirrors export/restore's own
// value shapes exactly -- an Identity is `["0x...64 hex digits..."]`, a
// Timestamp is `[micros]`, everything else a plain JSON scalar) ---------

fn edge_values(kind: ColKind) -> Vec<Value> {
    use serde_json::json;
    match kind {
        ColKind::U8 => vec![json!(0), json!(255), json!(42)],
        ColKind::U16 => vec![json!(0), json!(65535), json!(1000)],
        ColKind::U32 => vec![json!(0), json!(4294967295u64), json!(12345)],
        ColKind::U64 => vec![
            Value::Number(serde_json::Number::from_string_unchecked("0".into())),
            Value::Number(serde_json::Number::from_string_unchecked(
                "18446744073709551615".into(),
            )),
            Value::Number(serde_json::Number::from_string_unchecked(
                "9223372036854775808".into(),
            )),
        ],
        ColKind::I8 => vec![json!(-128), json!(127), json!(0)],
        ColKind::I16 => vec![json!(-32768), json!(32767), json!(0)],
        ColKind::I32 => vec![json!(-2147483648i64), json!(2147483647), json!(0)],
        ColKind::I64 => vec![
            Value::Number(serde_json::Number::from_string_unchecked(
                "-9223372036854775808".into(),
            )),
            Value::Number(serde_json::Number::from_string_unchecked(
                "9223372036854775807".into(),
            )),
            json!(0),
        ],
        ColKind::Bool => vec![json!(true), json!(false)],
        ColKind::String => vec![
            json!(""),
            // quote, double-quote, tab, real newline, CR, backslash, a
            // literal two-char `\n`, emoji, pipe -- Quentin's direction.
            // `ADVERSARIAL_STRING`, not a second copy of the same
            // literal: a caller building the *expected* value for a
            // sentinel check reuses this exact constant instead.
            Value::String(ADVERSARIAL_STRING.to_string()),
            json!("plain seed value"),
        ],
        ColKind::Timestamp => vec![
            Value::Array(vec![json!(0)]),
            Value::Array(vec![Value::Number(
                serde_json::Number::from_string_unchecked("9223372036854775807".into()),
            )]),
            Value::Array(vec![json!(1_700_000_000_123_456i64)]),
        ],
        ColKind::U128
        | ColKind::U256
        | ColKind::I128
        | ColKind::I256
        | ColKind::Identity
        | ColKind::ConnectionId
        | ColKind::Schedule
        | ColKind::Other => vec![],
    }
}

/// One synthetic, well-formed Identity/ConnectionId hex literal, distinct
/// per `index` -- structurally valid (32 bytes, `0x`-prefixed), never a
/// claim of being a real cryptographic identity.
fn synthetic_identity(index: u64) -> Value {
    Value::Array(vec![Value::String(format!("0x{index:064x}"))])
}

/// `n` seed rows for `accessor`, schema-driven from `snapshot`'s own
/// column list and types -- never a hand-written per-table row. An
/// auto_inc primary key gets sequential ids starting at 1 (gap-free, so
/// the restore reducer's gap-filling loop is a no-op for freshly seeded
/// data); a non-auto_inc primary key or a `#[unique]` column gets a
/// synthetic, collision-free value derived from `base_offset` + the row
/// index; every other column cycles [`edge_values`] for its type. A
/// column type with no entry there is a hard failure, never a silent
/// skip.
pub fn seed_rows(
    snapshot: &ModuleSchema,
    accessor: &str,
    n: u64,
    base_offset: u64,
) -> Result<Vec<Value>> {
    let table = table_def(snapshot, accessor)?;
    // A non-auto_inc `u8` primary key is a singleton config row
    // (`module_owner`'s convention) -- seeding more than one would
    // collide on the same forced id (0).
    let is_singleton = table
        .columns
        .iter()
        .any(|c| c.primary_key && c.ty == "u8" && !c.auto_inc);
    let n = if is_singleton { 1 } else { n };
    let mut rows = Vec::with_capacity(n as usize);
    for i in 0..n {
        let mut fields = Vec::with_capacity(table.columns.len());
        for col in &table.columns {
            let value = if col.ty == "Identity" || col.ty == "ConnectionId" {
                synthetic_identity(base_offset + i)
            } else if col.primary_key && col.auto_inc {
                Value::Number((i + 1).into())
            } else if col.primary_key && col.ty == "u8" {
                // A non-auto_inc `u8` primary key is a singleton config
                // row's id (`module_owner.id`, permanently 0 --
                // `server/src/tables/ops.rs`) -- never a synthetic
                // offset, which would both overflow `u8` and break the
                // `id == 0` invariant `require_owner` depends on.
                Value::Number(0u8.into())
            } else if col.primary_key || col.unique {
                // Bounded by the column's own type width -- `base_offset`
                // is chosen for `u32`/`u64` headroom and would overflow a
                // narrower integer type.
                let bounded = match col.ty.as_str() {
                    "u8" => (base_offset + i) % 256,
                    "u16" => (base_offset + i) % 65536,
                    _ => base_offset + i,
                };
                Value::Number(bounded.into())
            } else {
                let kind = ty_to_kind(&col.ty).ok_or_else(|| {
                    err(format!(
                        "no edge-value generator for type '{}' on '{accessor}.{}' -- a new column type must be taught to this generator before it can be seeded or restored",
                        col.ty, col.name
                    ))
                })?;
                let values = edge_values(kind);
                if values.is_empty() {
                    return Err(err(format!(
                        "no edge-value generator for type '{}' on '{accessor}.{}'",
                        col.ty, col.name
                    )));
                }
                values[(i as usize) % values.len()].clone()
            };
            fields.push(value);
        }
        rows.push(Value::Array(fields));
    }
    Ok(rows)
}

/// Maps `server/schema.snapshot.json`'s own `ty` strings (see
/// `bounds/src/schema.rs`) to a [`ColKind`] -- used only by [`seed_rows`],
/// which reads the snapshot's `ty` text directly rather than a live
/// `algebraic_type` (there is no live response to read one from before
/// the first seed is written).
fn ty_to_kind(ty: &str) -> Option<ColKind> {
    Some(match ty {
        "u8" => ColKind::U8,
        "u16" => ColKind::U16,
        "u32" => ColKind::U32,
        "u64" => ColKind::U64,
        "i8" => ColKind::I8,
        "i16" => ColKind::I16,
        "i32" => ColKind::I32,
        "i64" => ColKind::I64,
        "bool" => ColKind::Bool,
        "String" => ColKind::String,
        "Timestamp" => ColKind::Timestamp,
        "Identity" => ColKind::Identity,
        "ConnectionId" => ColKind::ConnectionId,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resp(schema_json: &str, rows_json: &str) -> SqlResponse {
        let text = format!(
            r#"[{{"schema":{schema_json},"rows":{rows_json},"total_duration_micros":1,"stats":{{}}}}]"#
        );
        parse_response(&text).unwrap()
    }

    #[test]
    fn column_values_extracts_by_normalized_name_not_position() {
        let r = resp(
            r#"{"elements":[{"name":{"some":"x_0"},"algebraic_type":{"I32":[]}},{"name":{"some":"y_0"},"algebraic_type":{"I32":[]}}]}"#,
            r#"[[-2147483648,1],[2147483647,2]]"#,
        );
        assert_eq!(
            column_values(&r, "x0").unwrap(),
            vec!["-2147483648", "2147483647"]
        );
        assert_eq!(column_values(&r, "y0").unwrap(), vec!["1", "2"]);
    }

    #[test]
    fn column_values_keeps_identity_and_timestamp_wrapped() {
        let r = resp(
            r#"{"elements":[{"name":{"some":"owner"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"__identity__"},"algebraic_type":{"U256":[]}}]}}}]}"#,
            r#"[[["0xabc"]]]"#,
        );
        assert_eq!(column_values(&r, "owner").unwrap(), vec![r#"["0xabc"]"#]);
    }

    #[test]
    fn column_values_fails_on_an_unknown_column() {
        let r = resp(
            r#"{"elements":[{"name":{"some":"a"},"algebraic_type":{"I32":[]}}]}"#,
            "[]",
        );
        assert!(column_values(&r, "nope").is_err());
    }

    #[test]
    fn sql_probeable_autoinc_tables_excludes_timestamp_identity_and_scheduled_tables() {
        let snapshot = snap(
            r#"{"tables":[
                {"accessor":"widget","struct_name":"Widget","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                    {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}
                ]},
                {"accessor":"has_timestamp","struct_name":"HasTimestamp","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                    {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},
                    {"name":"t","ty":"Timestamp","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}
                ]},
                {"accessor":"has_identity","struct_name":"HasIdentity","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                    {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},
                    {"name":"owner","ty":"Identity","primary_key":false,"auto_inc":false,"unique":true,"has_default":false,"indexed":false}
                ]},
                {"accessor":"not_autoinc","struct_name":"NotAutoinc","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                    {"name":"code","ty":"u32","primary_key":true,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}
                ]},
                {"accessor":"scheduled_one","struct_name":"ScheduledOne","public":false,"scheduled_reducer":"tick","wide_table_waiver":null,"columns":[
                    {"name":"scheduled_id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}
                ]}
            ]}"#,
        );
        assert_eq!(sql_probeable_autoinc_tables(&snapshot), vec!["widget"]);
        assert_eq!(auto_inc_column(&snapshot, "widget").unwrap(), "id");
        assert!(auto_inc_column(&snapshot, "not_autoinc").is_err());
        // autoinc_tables: unlike sql_probeable_autoinc_tables, includes
        // every auto_inc table regardless of its other columns' types --
        // has_timestamp and has_identity both count, scheduled_one and
        // not_autoinc still do not.
        let mut all_autoinc = autoinc_tables(&snapshot);
        all_autoinc.sort();
        assert_eq!(all_autoinc, vec!["has_identity", "has_timestamp", "widget"]);
    }

    #[test]
    fn sequence_floor_finds_the_named_row_and_reads_its_allocated_value() {
        let r = resp(
            r#"{"elements":[
                {"name":{"some":"sequence_id"},"algebraic_type":{"U32":[]}},
                {"name":{"some":"sequence_name"},"algebraic_type":{"String":[]}},
                {"name":{"some":"allocated"},"algebraic_type":{"U64":[]}}
            ]}"#,
            r#"[[1,"other_id_seq",99],[2,"widget_id_seq",18446744073709551615]]"#,
        );
        assert_eq!(
            sequence_floor(&r, "widget", "id").unwrap(),
            "18446744073709551615"
        );
        assert!(sequence_floor(&r, "nope", "id").is_err());
    }

    #[test]
    fn max_pk_reads_the_highest_canonical_rows_own_primary_key() {
        let snapshot = snap(
            r#"{"tables":[{"accessor":"widget","struct_name":"Widget","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}
            ]}]}"#,
        );
        let r = resp(
            r#"{"elements":[{"name":{"some":"id"},"algebraic_type":{"U64":[]}}]}"#,
            r#"[[3],[18446744073709551615],[1]]"#,
        );
        assert_eq!(
            max_pk(&snapshot, "widget", &r).unwrap(),
            Some("18446744073709551615".to_string())
        );
        let empty = resp(
            r#"{"elements":[{"name":{"some":"id"},"algebraic_type":{"U64":[]}}]}"#,
            "[]",
        );
        assert_eq!(max_pk(&snapshot, "widget", &empty).unwrap(), None);
    }

    #[test]
    fn adversarial_string_is_seeded_verbatim_by_edge_values() {
        // The exact same constant `edge_values(ColKind::String)` seeds
        // with -- never two copies that could drift apart.
        let values = edge_values(ColKind::String);
        assert!(values.contains(&Value::String(ADVERSARIAL_STRING.to_string())));
    }

    #[test]
    fn manifest_sequence_floor_reads_the_named_table_exactly() {
        let manifest: Value = serde_json::from_str(
            r#"{"sequence_floors":{"widget":18446744073709551615,"empty_table":0}}"#,
        )
        .unwrap();
        assert_eq!(
            manifest_sequence_floor(&manifest, "widget").unwrap(),
            "18446744073709551615"
        );
        // An empty table whose sequence was never touched gets a real,
        // present, explicit "0" from export -- the one legitimate zero,
        // and it must still round-trip exactly, not be conflated with a
        // missing entry.
        assert_eq!(
            manifest_sequence_floor(&manifest, "empty_table").unwrap(),
            "0"
        );
        // Missing from sequence_floors, or no sequence_floors at all:
        // both a hard error (Tim's direction) -- never a silent "0" that
        // would bring back the id re-use this cycle removed.
        assert!(manifest_sequence_floor(&manifest, "nope").is_err());
        let no_floors: Value = serde_json::from_str(r#"{"cli_version":"2.9.0"}"#).unwrap();
        assert!(manifest_sequence_floor(&no_floors, "widget").is_err());
    }

    #[test]
    fn u64_max_and_high_bit_survive_parse_and_reserialize_exactly() {
        let r = resp(
            r#"{"elements":[{"name":{"some":"chunk_key"},"algebraic_type":{"U64":[]}}]}"#,
            r#"[[18446744073709551615],[9223372036854775808]]"#,
        );
        let lines: Vec<String> = r.rows.iter().map(row_to_line).collect();
        assert_eq!(
            lines,
            vec!["[18446744073709551615]", "[9223372036854775808]"]
        );
    }

    #[test]
    fn column_kind_classifies_every_scalar_identity_timestamp_and_schedule() {
        let r = resp(
            r#"{"elements":[
                {"name":{"some":"a"},"algebraic_type":{"U64":[]}},
                {"name":{"some":"b"},"algebraic_type":{"String":[]}},
                {"name":{"some":"c"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"__identity__"},"algebraic_type":{"U256":[]}}]}}},
                {"name":{"some":"d"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"__timestamp_micros_since_unix_epoch__"},"algebraic_type":{"I64":[]}}]}}},
                {"name":{"some":"e"},"algebraic_type":{"Sum":{"variants":[{"name":{"some":"Interval"},"algebraic_type":{}},{"name":{"some":"Time"},"algebraic_type":{}}]}}},
                {"name":{"some":"f"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"mystery"},"algebraic_type":{}}]}}}
            ]}"#,
            "[]",
        );
        assert_eq!(
            column_kinds(&r),
            vec![
                ColKind::U64,
                ColKind::String,
                ColKind::Identity,
                ColKind::Timestamp,
                ColKind::Schedule,
                ColKind::Other,
            ]
        );
    }

    fn snap(json: &str) -> ModuleSchema {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn canonical_rows_sorts_by_the_real_primary_key_not_column_zero() {
        let snapshot = snap(
            r#"{"tables":[{"accessor":"widget","struct_name":"Widget","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                {"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false},
                {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}
            ]}]}"#,
        );
        let r = resp(
            r#"{"elements":[{"name":{"some":"label"},"algebraic_type":{"String":[]}},{"name":{"some":"id"},"algebraic_type":{"U64":[]}}]}"#,
            r#"[["nine",9],["two",2],["ten",10]]"#,
        );
        let rows = canonical_rows(&snapshot, "widget", &r).unwrap();
        let lines: Vec<String> = rows.iter().map(row_to_line).collect();
        assert_eq!(
            lines,
            vec![r#"["two",2]"#, r#"["nine",9]"#, r#"["ten",10]"#]
        );
    }

    #[test]
    fn canonical_rows_fails_on_a_duplicate_primary_key() {
        let snapshot = snap(
            r#"{"tables":[{"accessor":"widget","struct_name":"Widget","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}
            ]}]}"#,
        );
        let r = resp(
            r#"{"elements":[{"name":{"some":"id"},"algebraic_type":{"U64":[]}}]}"#,
            "[[1],[1]]",
        );
        assert!(canonical_rows(&snapshot, "widget", &r).is_err());
    }

    #[test]
    fn batch_by_bytes_produces_one_batch_when_everything_fits() {
        let lines = ["[1]", "[2]", "[3]"];
        let batches = batch_by_bytes(lines.iter().copied(), 1000);
        assert_eq!(batches, vec!["[[1],[2],[3]]"]);
    }

    #[test]
    fn batch_by_bytes_splits_on_the_byte_budget_and_carries_a_partial_last_batch() {
        // Each line is 3 bytes ("[1]"); a budget that fits two but not
        // three per batch, with five total rows, must give 2/2/1.
        let lines = ["[1]", "[2]", "[3]", "[4]", "[5]"];
        let batches = batch_by_bytes(lines.iter().copied(), 9);
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[2], "[[5]]");
    }

    #[test]
    fn batch_by_bytes_never_produces_an_empty_batch_for_an_oversized_single_row() {
        // A single row bigger than the budget still gets its own batch,
        // never split mid-row and never dropped.
        let big = "x".repeat(50);
        let line = format!(r#"["{big}"]"#);
        let lines = vec![line.as_str()];
        let batches = batch_by_bytes(lines.into_iter(), 10);
        assert_eq!(batches.len(), 1);
        assert!(batches[0].contains(&big));
    }

    #[test]
    fn seed_rows_gives_auto_inc_pk_sequential_gap_free_ids() {
        let snapshot = snap(
            r#"{"tables":[{"accessor":"widget","struct_name":"Widget","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},
                {"name":"n","ty":"i32","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}
            ]}]}"#,
        );
        let rows = seed_rows(&snapshot, "widget", 3, 1000).unwrap();
        let ids: Vec<String> = rows.iter().map(|r| r[0].to_string()).collect();
        assert_eq!(ids, vec!["1", "2", "3"]);
    }

    #[test]
    fn seed_rows_fails_on_a_type_with_no_edge_value_entry() {
        let snapshot = snap(
            r#"{"tables":[{"accessor":"widget","struct_name":"Widget","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[
                {"name":"weird","ty":"f64","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}
            ]}]}"#,
        );
        assert!(seed_rows(&snapshot, "widget", 1, 1000).is_err());
    }

    #[test]
    fn normalize_name_strips_underscores_and_lowercases() {
        assert_eq!(normalize_name("x_0"), "x0");
        assert_eq!(normalize_name("x0"), "x0");
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        // Quentin's direction: a seeded, randomized round trip -- a few
        // thousand generated strings and integers, value -> canonical
        // JSON line -> parsed back, must reproduce the exact value. A
        // fixed seed (proptest's own deterministic default under
        // `PROPTEST_CASES`, docs/architecture.md) needs no new
        // dependency: `proptest` is already sanctioned native-only
        // tooling.
        #[test]
        fn any_string_round_trips_through_a_canonical_row_line(s in ".*") {
            let row = Value::Array(vec![Value::String(s.clone())]);
            let line = row_to_line(&row);
            let parsed: Value = serde_json::from_str(&line).unwrap();
            prop_assert_eq!(parsed[0].as_str().unwrap(), s);
        }

        #[test]
        fn any_u64_round_trips_through_a_canonical_row_line(n in any::<u64>()) {
            let row = Value::Array(vec![Value::Number(n.into())]);
            let line = row_to_line(&row);
            let parsed: Value = serde_json::from_str(&line).unwrap();
            prop_assert_eq!(parsed[0].to_string(), n.to_string());
        }

        #[test]
        fn any_i64_round_trips_through_a_canonical_row_line(n in any::<i64>()) {
            let row = Value::Array(vec![Value::Number(n.into())]);
            let line = row_to_line(&row);
            let parsed: Value = serde_json::from_str(&line).unwrap();
            prop_assert_eq!(parsed[0].to_string(), n.to_string());
        }

        /// A u64 above 2^53 (jq's silent-corruption range) round trips
        /// exactly -- the one property this whole crate exists for.
        #[test]
        fn u64_above_js_safe_integer_round_trips_exactly(n in (1u64 << 53)..u64::MAX) {
            let text = n.to_string();
            let row: Value = serde_json::from_str(&format!("[{text}]")).unwrap();
            let line = row_to_line(&row);
            prop_assert_eq!(line, format!("[{text}]"));
        }

        /// Quentin's direction: `batch_by_bytes` is the function that
        /// could silently drop or duplicate a row. Random line sets and
        /// budgets, checked three ways: every input row comes back out,
        /// in order; every batch parses as valid JSON; and every batch
        /// stays within budget unless a single oversized row forces it
        /// over (never split mid-row, never dropped).
        #[test]
        fn batch_by_bytes_never_drops_reorders_or_corrupts_rows(
            values in prop::collection::vec(any::<i64>(), 0..200),
            budget in 3usize..500,
        ) {
            let lines: Vec<String> = values.iter().map(|n| format!("[{n}]")).collect();
            let batches = batch_by_bytes(lines.iter().map(String::as_str), budget);

            for batch in &batches {
                let parsed: Value = serde_json::from_str(batch)
                    .unwrap_or_else(|e| panic!("batch is not valid JSON: {e}: {batch}"));
                prop_assert!(parsed.is_array());
                let rows = parsed.as_array().unwrap();
                if rows.len() > 1 {
                    prop_assert!(
                        batch.len() <= budget,
                        "batch of {} rows is {} bytes, over budget {budget}: {batch}",
                        rows.len(), batch.len()
                    );
                }
            }

            let recovered: Vec<i64> = batches
                .iter()
                .flat_map(|b| serde_json::from_str::<Vec<[i64; 1]>>(b).unwrap())
                .map(|row| row[0])
                .collect();
            prop_assert_eq!(recovered, values);
        }
    }
}
