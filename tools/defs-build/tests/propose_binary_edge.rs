//! Story 2.3 (AC1/AC3), Tim/Quentin's direction: the `defs-propose`
//! binary's own edge, run for real via `std::process::Command` (never
//! only the pure `propose()` function) -- stdout-only output, the
//! `defs/` tree left byte-for-byte untouched by running it, and a real
//! stanza (with the five missing keys filled in, exactly as a reviewer
//! would paste it) accepted by `validate` as-is.

use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

const LAMP_SHEET: &str = "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/ME_Singles_City_Props_16x16_Street_Lamp_5.png";

fn run_defs_propose(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_defs-propose"))
        .args(args)
        .current_dir(repo_root())
        .output()
        .expect("failed to run defs-propose")
}

/// `git status --porcelain -- defs` before and after running the binary
/// over a real sheet must be identical -- the proposer never opens
/// anything under `defs/` for writing (Tim's direction), proven by
/// actually running it, not merely by code inspection.
#[test]
fn running_the_binary_leaves_the_defs_tree_untouched() {
    let root = repo_root();
    let status_before = Command::new("git")
        .args(["status", "--porcelain", "--", "defs"])
        .current_dir(&root)
        .output()
        .expect("git status failed");

    let out = run_defs_propose(&[LAMP_SHEET]);
    assert!(
        out.status.success(),
        "defs-propose failed over a real sheet: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let status_after = Command::new("git")
        .args(["status", "--porcelain", "--", "defs"])
        .current_dir(&root)
        .output()
        .expect("git status failed");

    assert_eq!(
        status_before.stdout, status_after.stdout,
        "running defs-propose changed something under defs/"
    );
}

/// AC4's "exactly once per prop" read as determinism: running the real
/// binary over the same real sheets twice in a row produces
/// byte-identical stdout both times.
#[test]
fn running_the_binary_twice_over_the_same_real_sheets_is_byte_identical() {
    let sheets = [
        LAMP_SHEET,
        "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Bus_Left_1.png",
    ];
    let first = run_defs_propose(&sheets);
    let second = run_defs_propose(&sheets);
    assert!(first.status.success());
    assert!(second.status.success());
    assert_eq!(first.stdout, second.stdout);
}

/// Every existing script passes `--bin defs-build` explicitly
/// (`default-run = "defs-build"` in `Cargo.toml`) -- this only proves the
/// second bin exists and runs on its own name; it says nothing about
/// which bin a bare `cargo run` picks (that is `Cargo.toml`'s own job).
#[test]
fn the_binary_runs_and_emits_a_stanza_on_stdout_only() {
    let out = run_defs_propose(&[LAMP_SHEET]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("[[object]]"));
    assert!(stdout.contains("sprite = "));
    assert!(stdout.contains("width = "));
    assert!(stdout.contains("height = "));
    // The five keys a real object needs are deliberately absent.
    for missing in ["id =", "key =", "name =", "layer =", "tags ="] {
        assert!(
            !stdout.contains(missing),
            "stdout unexpectedly contains '{missing}'"
        );
    }
}

/// A stanza pasted unreviewed (no missing key filled in) is rejected by
/// `defs-build` as `missing-required-key` -- proven end to end via the
/// real binary's own edge, not by unit-testing `parse.rs` alone.
#[test]
fn a_raw_stanza_pasted_unreviewed_is_rejected_as_missing_required_key() {
    let out = run_defs_propose(&[LAMP_SHEET]);
    let stanza = String::from_utf8_lossy(&out.stdout).to_string();
    let err = defs_build::parse::parse_all(&[(PathBuf::from("defs/objects/x.toml"), stanza)])
        .expect_err("a raw proposer stanza must fail to parse as a whole object");
    assert!(err.message.contains("missing field"));
}

/// Story 2.3's own AC3 acceptance: pasting the proposer's real stdout
/// with the five missing keys filled in (exactly what an agent
/// classifying a proposal would do) passes `validate` as-is.
#[test]
fn a_stanza_with_the_five_missing_keys_filled_in_passes_validate() {
    let out = run_defs_propose(&[LAMP_SHEET]);
    let stanza = String::from_utf8_lossy(&out.stdout).to_string();
    assert!(stanza.starts_with("[[object]]\n"));
    let filled = stanza.replacen(
        "[[object]]\n",
        "[[object]]\nid = 1\nkey = \"proposed_lamp\"\nname = \"Proposed Lamp\"\nlayer = \"objects\"\n",
        1,
    ) + "tags = [\"fixture\"]\n";

    let files = vec![
        (PathBuf::from("defs/objects/proposed.toml"), filled),
        (
            PathBuf::from("defs/tags/roles.toml"),
            "[[tag]]\nid = 1\nkey = \"fixture\"\nrole = { layers = [\"objects\"] }\n".to_string(),
        ),
        (
            PathBuf::from("defs/balance/render.toml"),
            "[[balance]]\nkey = \"render.tile_size_px\"\nvalue = 16\nmin = 1\nmax = 64\n"
                .to_string(),
        ),
    ];
    let raw = defs_build::parse::parse_all(&files).unwrap();
    let sheet_dims: std::collections::BTreeMap<String, (u32, u32)> =
        [(LAMP_SHEET.to_string(), (16, 64))].into_iter().collect();
    let layer_codes: std::collections::BTreeMap<String, u32> =
        [("objects".to_string(), 3u32)].into_iter().collect();
    defs_build::validate::validate(&raw, &sheet_dims, &layer_codes, "").unwrap();
}
