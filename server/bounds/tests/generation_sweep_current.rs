//! `docs/generation.md`'s measured detour blocks (the threaded sweep and
//! the 50,000-seed exhaustive loop) each carry the `GENERATION_VERSION`
//! and generation-balance fingerprint they were measured under. A stamp
//! that differs from the generator's means the figures may be stale.

use bounds::generation_stamp::balance_fingerprint;
use sim::generated::defs;
use sim::generation::GENERATION_VERSION;

const BLOCKS: [&str; 2] = ["detour-bounds sweep", "exhaustive detour loop"];

/// `(version, fingerprint)` of every `<label> at GENERATION_VERSION=<n>
/// fingerprint=<hex>` line in `text`.
fn stamps(text: &str, label: &str) -> Vec<(u32, String)> {
    let prefix = format!("{label} at GENERATION_VERSION=");
    text.lines()
        .filter_map(|l| l.trim().strip_prefix(&prefix))
        .filter_map(|rest| {
            let (version, rest) = rest.split_once(" fingerprint=")?;
            let hex: String = rest.chars().take_while(char::is_ascii_hexdigit).collect();
            Some((version.parse().ok()?, hex))
        })
        .collect()
}

#[test]
fn docs_detour_blocks_are_stamped_with_the_current_version_and_fingerprint() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/generation.md");
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let fingerprint = format!("{:016x}", balance_fingerprint(defs::BALANCE));
    for label in BLOCKS {
        let found = stamps(&text, label);
        assert!(
            !found.is_empty(),
            "docs/generation.md has no `{label} at GENERATION_VERSION=<n> fingerprint=<hex>` line -- paste `measure-generation`'s output"
        );
        for (version, hex) in found {
            assert_eq!(
                version, GENERATION_VERSION,
                "docs/generation.md's `{label}` block is stale: VERSION moved (measured at {version}, generator at {GENERATION_VERSION}) -- re-run `cargo run -p bounds --release --bin measure-generation` (`-- detour 1000000` for the sweep; the exhaustive loop is the default run) and re-state every detour ceiling's figures"
            );
            assert_eq!(
                hex, fingerprint,
                "docs/generation.md's `{label}` block is stale: the generation.* balance FINGERPRINT moved (measured under {hex}, now {fingerprint}) -- a generation key was retuned; re-run `cargo run -p bounds --release --bin measure-generation` (`-- detour 1000000` for the sweep; the exhaustive loop is the default run) and re-state every detour ceiling's figures"
            );
        }
    }
}

#[test]
fn stamp_parser_reads_version_and_fingerprint_per_label() {
    let text = "detour-bounds sweep at GENERATION_VERSION=7 fingerprint=00ab12: 5 seeds\n\
                exhaustive detour loop at GENERATION_VERSION=9 fingerprint=ff: x\n\
                other at GENERATION_VERSION=3 fingerprint=aa\n";
    assert_eq!(stamps(text, BLOCKS[0]), vec![(7, "00ab12".to_string())]);
    assert_eq!(stamps(text, BLOCKS[1]), vec![(9, "ff".to_string())]);
    assert!(stamps("nothing", BLOCKS[0]).is_empty());
}
