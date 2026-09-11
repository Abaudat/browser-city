//! CLI wrapper around `world_backup`'s pure logic -- see `lib.rs` for
//! what each subcommand actually does and why. Every subcommand reads
//! its file arguments and writes plain text to stdout; every failure
//! path prints to stderr and exits 1.

use std::fs;
use std::io::{self, Read};
use std::process::ExitCode;

use bounds::schema::ModuleSchema;
use serde_json::Value;
use world_backup::*;

fn die(msg: impl std::fmt::Display) -> ExitCode {
    eprintln!("world_backup: FAIL -- {msg}");
    ExitCode::FAILURE
}

fn read_file(path: &str) -> Result<String> {
    fs::read_to_string(path).map_err(|e| WorldBackupError(format!("could not read {path}: {e}")))
}

fn read_snapshot(path: &str) -> Result<ModuleSchema> {
    let text = read_file(path)?;
    serde_json::from_str(&text)
        .map_err(|e| WorldBackupError(format!("{path} is not a valid schema snapshot: {e}")))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => die(e),
    }
}

fn run(args: &[String]) -> Result<()> {
    let cmd = args
        .get(1)
        .map(String::as_str)
        .ok_or_else(|| WorldBackupError("usage: world_backup <subcommand> ...".into()))?;
    match cmd {
        "columns" => {
            let resp = parse_response(&read_file(&args[2])?)?;
            for name in column_names(&resp) {
                println!("{name}");
            }
        }
        "columns-normalized" => {
            let resp = parse_response(&read_file(&args[2])?)?;
            for name in column_names(&resp) {
                println!("{}", normalize_name(&name));
            }
        }
        "coltypes" => {
            let resp = parse_response(&read_file(&args[2])?)?;
            for k in column_kinds(&resp) {
                println!("{k:?}");
            }
        }
        "column-values" => {
            // column-values <response.json> <column-name>
            let resp = parse_response(&read_file(&args[2])?)?;
            for v in column_values(&resp, &args[3])? {
                println!("{v}");
            }
        }
        "row-count" => {
            let resp = parse_response(&read_file(&args[2])?)?;
            println!("{}", resp.rows.len());
        }
        "rows-canonical" => {
            let snapshot = read_snapshot(&args[2])?;
            let accessor = &args[3];
            let resp = parse_response(&read_file(&args[4])?)?;
            for row in canonical_rows(&snapshot, accessor, &resp)? {
                println!("{}", row_to_line(&row));
            }
        }
        "call-batches" => {
            // call-batches <rows.jsonl> <max-bytes>
            let text = read_file(&args[2])?;
            let max_bytes: usize = args[3]
                .parse()
                .map_err(|_| WorldBackupError(format!("not a number: {}", args[3])))?;
            let lines: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
            for batch in batch_by_bytes(lines.into_iter(), max_bytes) {
                println!("{batch}");
            }
        }
        "seed-rows" => {
            // seed-rows <snapshot.json> <accessor> <n> <base-offset>
            let snapshot = read_snapshot(&args[2])?;
            let accessor = &args[3];
            let n: u64 = args[4]
                .parse()
                .map_err(|_| WorldBackupError(format!("not a number: {}", args[4])))?;
            let base: u64 = args[5]
                .parse()
                .map_err(|_| WorldBackupError(format!("not a number: {}", args[5])))?;
            let rows = seed_rows(&snapshot, accessor, n, base)?;
            // One `spacetime call` argument: `[rows...]` -- the reducer
            // takes exactly one `Vec<Row>` parameter.
            println!(
                "[{}]",
                rows.iter().map(row_to_line).collect::<Vec<_>>().join(",")
            );
        }
        "snapshot-columns" => {
            let snapshot = read_snapshot(&args[2])?;
            let accessor = &args[3];
            let table = table_def(&snapshot, accessor)?;
            for c in &table.columns {
                println!("{}", normalize_name(&c.name));
            }
        }
        "sql-probeable-autoinc-tables" => {
            let snapshot = read_snapshot(&args[2])?;
            for accessor in sql_probeable_autoinc_tables(&snapshot) {
                println!("{accessor}");
            }
        }
        "auto-inc-column" => {
            let snapshot = read_snapshot(&args[2])?;
            println!("{}", auto_inc_column(&snapshot, &args[3])?);
        }
        "autoinc-tables" => {
            let snapshot = read_snapshot(&args[2])?;
            for accessor in autoinc_tables(&snapshot) {
                println!("{accessor}");
            }
        }
        "sequence-floor" => {
            // sequence-floor <st_sequence-response.json> <table> <column>
            let resp = parse_response(&read_file(&args[2])?)?;
            println!("{}", sequence_floor(&resp, &args[3], &args[4])?);
        }
        "max-pk" => {
            // max-pk <snapshot.json> <accessor> <response.json>
            let snapshot = read_snapshot(&args[2])?;
            let accessor = &args[3];
            let resp = parse_response(&read_file(&args[4])?)?;
            if let Some(pk) = max_pk(&snapshot, accessor, &resp)? {
                println!("{pk}");
            }
        }
        "adversarial-string-line" => {
            println!(
                "{}",
                row_to_line(&Value::String(ADVERSARIAL_STRING.to_string()))
            );
        }
        "manifest-floor" => {
            // manifest-floor <manifest.json> <table>
            let text = read_file(&args[2])?;
            let manifest: Value = serde_json::from_str(&text)
                .map_err(|e| WorldBackupError(format!("{}: not valid JSON: {e}", args[2])))?;
            println!("{}", manifest_sequence_floor(&manifest, &args[3])?);
        }
        "snapshot-tables" => {
            let snapshot = read_snapshot(&args[2])?;
            for t in &snapshot.tables {
                println!(
                    "{}\t{}",
                    t.accessor,
                    if t.scheduled_reducer.is_some() { 1 } else { 0 }
                );
            }
        }
        "normalize" => {
            println!("{}", normalize_name(&args[2]));
        }
        "describe-tables" => {
            let text = read_file(&args[2])?;
            let doc: Value = serde_json::from_str(&text).map_err(|e| {
                WorldBackupError(format!(
                    "{}: not valid JSON ('spacetime describe --json' shape drifted): {e}",
                    args[2]
                ))
            })?;
            let sections = doc
                .get("sections")
                .and_then(|s| s.as_array())
                .ok_or_else(|| WorldBackupError(format!("{}: no 'sections' array", args[2])))?;
            let tables = sections
                .iter()
                .find_map(|s| s.get("Tables"))
                .and_then(|t| t.as_array());
            let tables = tables.ok_or_else(|| {
                WorldBackupError(format!("{}: no 'Tables' section found", args[2]))
            })?;
            for t in tables {
                if let Some(name) = t.get("source_name").and_then(|n| n.as_str()) {
                    println!("{name}");
                }
            }
        }
        "write-manifest" => {
            // write-manifest <out.json> <key=value...> <name>_file=<path>...
            // -- any key ending `_file` embeds the JSON parsed from that
            // path under the key with `_file` stripped (e.g.
            // `tables_file=t.json` embeds t.json's own parsed value under
            // `"tables"`; `sequence_floors_file=f.json` under
            // `"sequence_floors"`), never a hardcoded single field name.
            let out = &args[2];
            let mut manifest = serde_json::Map::new();
            let mut file_fields: Vec<(String, String)> = Vec::new();
            for pair in &args[3..] {
                let (k, v) = pair
                    .split_once('=')
                    .ok_or_else(|| WorldBackupError(format!("not key=value: {pair}")))?;
                if let Some(field) = k.strip_suffix("_file") {
                    file_fields.push((field.to_string(), v.to_string()));
                } else {
                    manifest.insert(k.to_string(), Value::String(v.to_string()));
                }
            }
            for (field, path) in file_fields {
                let value: Value = serde_json::from_str(&read_file(&path)?)
                    .map_err(|e| WorldBackupError(format!("{path}: not valid JSON: {e}")))?;
                manifest.insert(field, value);
            }
            let text = serde_json::to_string_pretty(&Value::Object(manifest))
                .expect("a manifest built from strings always serializes");
            fs::write(out, format!("{text}\n"))
                .map_err(|e| WorldBackupError(format!("could not write {out}: {e}")))?;
        }
        "stdin-to-line" => {
            // Reads a JSON value from stdin and prints it as one
            // canonical compact line -- used to fold a single ad hoc
            // value through the same exact-precision path as everything
            // else, e.g. in a test fixture.
            let mut text = String::new();
            io::stdin()
                .read_to_string(&mut text)
                .map_err(|e| WorldBackupError(e.to_string()))?;
            let v: Value =
                serde_json::from_str(&text).map_err(|e| WorldBackupError(e.to_string()))?;
            println!("{}", row_to_line(&v));
        }
        other => return Err(WorldBackupError(format!("unknown subcommand: {other}"))),
    }
    Ok(())
}
