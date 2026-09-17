//! The CLI edge for story 2.3's proposer: `cargo run --manifest-path
//! tools/defs-build/Cargo.toml --bin defs-propose -- <png>...`. Wiring
//! only -- the actual measurement is [`defs_build::propose::propose`];
//! this file only reads real files and renders stdout. Writes nothing
//! under `defs/`, ever, and reads nothing under it either (AC3/AC4): it
//! has no ids, keys or override tables, and both are guarded
//! mechanically by `scripts/ci/check-no-runtime-footprint-inference.sh`
//! and `scripts/ci/check-proposer-no-content-keys.sh`.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use defs_build::model::SPRITE_SHEET_ALLOWED_ROOT;
use defs_build::propose::{Proposal, propose};
use defs_build::{atlas, fsio};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Renders one successful [`Proposal`] as a `[[object]]` stanza: `sprite`
/// (the whole PNG, `x = 0, y = 0`), `width`, `height` and `collider`
/// (when present) -- and nothing else. `id`, `key`, `name`, `layer` and
/// `tags` are deliberately absent, so a stanza pasted unreviewed is
/// rejected by `defs-build` as `missing-required-key` (Tim's direction):
/// that is what makes "a starting point, never authority" mechanical.
fn render_stanza(sheet: &str, w: u32, h: u32, p: &Proposal) -> String {
    let mut out = format!(
        "[[object]]\nsprite = {{ sheet = \"{sheet}\", x = 0, y = 0, w = {w}, h = {h} }}\nwidth = {}\nheight = {}\n",
        p.width, p.height
    );
    if let Some(c) = p.collider {
        out.push_str(&format!(
            "collider = {{ x0 = {}, y0 = {}, x1 = {}, y1 = {} }}\n",
            c.x0, c.y0, c.x1, c.y1
        ));
    }
    out.push('\n');
    out
}

fn main() -> ExitCode {
    let root = repo_root();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!(
            "defs-propose: usage: cargo run --manifest-path tools/defs-build/Cargo.toml --bin defs-propose -- <png>..."
        );
        return ExitCode::FAILURE;
    }

    let mut had_error = false;
    // Input order preserved, never sorted -- determinism means "the same
    // input order gives the same output", not "the tool imposes its own
    // order" (Tim's direction).
    for arg in &args {
        let sheet = arg.replace('\\', "/");
        if !sheet.starts_with(SPRITE_SHEET_ALLOWED_ROOT) {
            eprintln!(
                "defs-propose: FAIL -- '{sheet}' is not under the allowed root '{SPRITE_SHEET_ALLOWED_ROOT}'"
            );
            had_error = true;
            continue;
        }
        let bytes = match fsio::read_bytes(&root, &[PathBuf::from(&sheet)]) {
            Ok(mut v) => v.remove(0).1,
            Err(e) => {
                eprintln!("defs-propose: FAIL -- '{sheet}': {e}");
                had_error = true;
                continue;
            }
        };
        let (w, h, rgba) = match atlas::image::decode_rgba8(&bytes) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("defs-propose: FAIL -- '{sheet}': {e}");
                had_error = true;
                continue;
            }
        };
        match propose(w, h, &rgba) {
            Ok(p) => print!("{}", render_stanza(&sheet, w, h, &p)),
            Err(e) => {
                eprintln!("defs-propose: FAIL -- '{sheet}': {e}");
                had_error = true;
            }
        }
    }

    if had_error {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
