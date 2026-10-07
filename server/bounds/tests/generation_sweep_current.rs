//! `docs/generation.md`'s detour-bounds sweep block names the
//! `GENERATION_VERSION` it was measured at; a mismatch means pass 1-2
//! output may have moved since, so every ceiling's measured worst and
//! miss rate is stale.

use sim::generation::GENERATION_VERSION;

const STAMP: &str = "detour-bounds sweep at GENERATION_VERSION=";

/// Every stamp found in `text`, in order.
fn stamps(text: &str) -> Vec<u32> {
    text.lines()
        .filter_map(|l| l.trim().strip_prefix(STAMP))
        .filter_map(|rest| {
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            digits.parse().ok()
        })
        .collect()
}

#[test]
fn docs_sweep_block_is_stamped_with_the_current_generation_version() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/generation.md");
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let found = stamps(&text);
    assert!(
        !found.is_empty(),
        "docs/generation.md has no `{STAMP}<n>` line -- paste `measure-generation -- detour 1000000`'s output into the street-network pass"
    );
    for v in found {
        assert_eq!(
            v, GENERATION_VERSION,
            "docs/generation.md's detour-bounds sweep was measured at GENERATION_VERSION {v}, the generator is at {GENERATION_VERSION} -- re-run `cargo run -p bounds --release --bin measure-generation -- detour 1000000` (and the 50,000-seed exhaustive loop), paste the output, and re-state every detour ceiling's measured figures at the new version"
        );
    }
}

#[test]
fn stamp_parser_reads_the_version_and_ignores_other_lines() {
    let text =
        "x\ndetour-bounds sweep at GENERATION_VERSION=7: 5 seeds\nother GENERATION_VERSION=9\n";
    assert_eq!(stamps(text), vec![7]);
    assert!(stamps("nothing here").is_empty());
}
