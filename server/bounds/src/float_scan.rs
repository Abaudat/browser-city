//! Token-level float scan over `sim`'s sources (NFR25). `sim` is integer
//! and fixed-point only; clippy's `disallowed_types` and `float_arithmetic`
//! miss an untyped literal that is only compared, and a float reached
//! through a method call, so this walks every token -- macro bodies and
//! groups included -- and reports any float literal or `f32`/`f64`
//! identifier. Comments and string literals are not tokens of that kind,
//! which is why this is a tokeniser and not a text search.
//!
//! Native test tooling only: `proc-macro2` is a dev-dependency of `bounds`,
//! never of `sim` or `browser_city`.

use proc_macro2::{TokenStream, TokenTree};
use std::path::{Path, PathBuf};

/// The one file exempt from the scan, by its path relative to the scanned
/// root (`sim/src/`): a same-named file anywhere else is scanned.
pub const EXEMPT: &str = "lint_canary.rs";

const INT_SUFFIXES: [&str; 12] = [
    "u8", "u16", "u32", "u64", "u128", "usize", "i8", "i16", "i32", "i64", "i128", "isize",
];

fn is_float_literal(text: &str) -> bool {
    if !text.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    if text.starts_with("0x") || text.starts_with("0o") || text.starts_with("0b") {
        return false;
    }
    if text.ends_with("f32") || text.ends_with("f64") {
        return true;
    }
    let mut body = text;
    for suffix in INT_SUFFIXES {
        if let Some(stripped) = body.strip_suffix(suffix) {
            body = stripped;
            break;
        }
    }
    body.contains('.') || body.contains('e') || body.contains('E')
}

fn walk(stream: TokenStream, found: &mut Vec<(usize, String)>) {
    for tree in stream {
        match tree {
            TokenTree::Group(g) => walk(g.stream(), found),
            TokenTree::Ident(i) => {
                let name = i.to_string();
                if name == "f32" || name == "f64" {
                    found.push((i.span().start().line, name));
                }
            }
            TokenTree::Literal(l) => {
                let text = l.to_string();
                if is_float_literal(&text) {
                    found.push((l.span().start().line, text));
                }
            }
            TokenTree::Punct(_) => {}
        }
    }
}

/// Every float token in `src` as `(line, token text)`, or the lexer's
/// complaint when `src` does not tokenise.
pub fn float_tokens(src: &str) -> Result<Vec<(usize, String)>, String> {
    let stream: TokenStream = src.parse().map_err(|e| format!("{e}"))?;
    let mut found = Vec::new();
    walk(stream, &mut found);
    Ok(found)
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .map(|e| e.expect("dir entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Scans every `.rs` file under `dir` (generated ones included) except the
/// exempt canary; one `file:line: token` message per hit.
pub fn scan_tree(dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    rust_files(dir, &mut files);
    let mut hits = Vec::new();
    for file in files {
        if file
            .strip_prefix(dir)
            .is_ok_and(|rel| rel == Path::new(EXEMPT))
        {
            continue;
        }
        let src = std::fs::read_to_string(&file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        match float_tokens(&src) {
            Ok(found) => {
                for (line, token) in found {
                    hits.push(format!("{}:{line}: {token}", file.display()));
                }
            }
            Err(e) => hits.push(format!("{}: does not tokenise: {e}", file.display())),
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits(src: &str) -> Vec<(usize, String)> {
        float_tokens(src).expect("tokenises")
    }

    #[test]
    fn red_a_literal_that_is_only_compared() {
        assert_eq!(hits("fn f() {\n let y = 1.5;\n if y > 1.0 {}\n}").len(), 2);
    }

    #[test]
    fn red_a_suffixed_literal() {
        assert_eq!(hits("fn f() { let _ = 1.5f32 > 1.0; }")[0].1, "1.5f32");
        assert_eq!(hits("fn f() { let _ = 3f64; }")[0].1, "3f64");
    }

    #[test]
    fn red_a_method_on_a_float_literal() {
        assert!(!hits("fn f() { let _ = 2.0_f64.sqrt() > 1.4; }").is_empty());
        assert!(!hits("fn f(x: i32) { let _ = 1.07_f64.powi(x) as i32; }").is_empty());
    }

    #[test]
    fn red_an_integer_to_float_to_integer_round_trip() {
        assert!(!hits("fn f(x: u64) { let _ = (x as f64).sqrt() as u64; }").is_empty());
    }

    #[test]
    fn red_an_exponent_literal() {
        assert_eq!(hits("fn f() { let _ = 2e3; }")[0].1, "2e3");
        assert_eq!(hits("fn f() { let _ = 1E-9; }")[0].1, "1E-9");
    }

    #[test]
    fn red_an_f64_type_and_its_line() {
        assert_eq!(hits("\n\nfn f(x: f64) {}"), vec![(3, "f64".to_string())]);
    }

    #[test]
    fn red_a_float_inside_a_macro_body() {
        assert!(!hits("macro_rules! m { () => { 0.5 }; }").is_empty());
        assert!(!hits("fn f() { assert!(x > 0.25); }").is_empty());
    }

    #[test]
    fn green_a_decimal_in_a_comment_or_a_string() {
        assert!(hits("// 1.5 and f64 and 2e3\nfn f() { let _ = \"1.5 f64 2e3\"; }").is_empty());
        assert!(hits("/// 0.5 of f32\n/* 1.0 */ fn f() {}").is_empty());
    }

    #[test]
    fn green_integer_shapes_that_contain_a_dot_or_an_e() {
        assert!(hits("const A: u64 = 0x9E3779B97F4A7C15;").is_empty());
        assert!(hits("fn f() { for _ in 0..5 {} }").is_empty());
        assert!(hits("fn f(x: (u8, u8)) { let _ = x.0; }").is_empty());
        assert!(hits("fn f() { let _ = 1.max(2); }").is_empty());
        assert!(hits("fn f() { let _ = 1usize + 2_usize + 3u128; }").is_empty());
        assert!(hits("const B: u8 = 0b1010_1010; const C: u8 = 0o17;").is_empty());
    }

    #[test]
    fn red_the_ticket_shapes_verbatim() {
        assert_eq!(
            hits("fn f(x: u64) { let _ = Duration::from_millis(x).as_secs_f64().sqrt() as u64; }")
                [0]
            .1,
            "as_secs_f64"
        );
        assert_eq!(
            hits("fn f(x: i32) { let _ = 0.5_f64.max(x.into()); }")[0].1,
            "0.5_f64"
        );
    }

    #[test]
    fn red_an_identifier_carrying_a_float_name() {
        assert_eq!(hits("fn f() { let _: c_float = 0; }")[0].1, "c_float");
        assert_eq!(hits("fn f() { let _: c_double = 0; }")[0].1, "c_double");
        assert_eq!(
            hits("fn f(x: u32) { let _ = Duration::from_secs_f32(x); }")[0].1,
            "from_secs_f32"
        );
        assert_eq!(hits("fn f(d: D) { let _ = d.mul_f64(y); }")[0].1, "mul_f64");
    }

    #[test]
    fn red_a_float_name_is_matched_as_a_substring_not_a_segment() {
        // `buf64` costs a rename; a miss is permanent in the persisted world.
        assert_eq!(hits("fn f() { let buf64 = 0; }")[0].1, "buf64");
        assert_eq!(hits("fn f() { let half32 = 0; }")[0].1, "half32");
    }

    #[test]
    fn red_a_nested_tuple_index_lexes_as_a_float_by_design() {
        // `x.0.1` lexes as the literal `0.1`; write `(x.0).1`.
        assert_eq!(hits("fn f(x: ((u8, u8), u8)) { let _ = x.0.1; }")[0].1, "0.1");
        assert!(hits("fn f(x: ((u8, u8), u8)) { let _ = (x.0).1; }").is_empty());
    }

    #[test]
    fn red_the_other_float_widths_and_a_trailing_dot() {
        assert_eq!(hits("fn f() { let _ = 3f128; }")[0].1, "3f128");
        assert_eq!(hits("fn f() { let _ = 1f16; }")[0].1, "1f16");
        assert_eq!(hits("fn f() { let _ = 1.; }")[0].1, "1.");
    }

    #[test]
    fn red_a_float_in_a_nested_macro_group_or_an_attribute() {
        assert_eq!(hits("macro_rules! m { () => { [ ( 0.5 ) ] }; }")[0].1, "0.5");
        assert_eq!(hits("#[cfg_attr(test, foo(1.5))]\nfn f() {}")[0].1, "1.5");
    }

    #[test]
    fn green_hex_digits_that_spell_a_float_suffix_and_non_float_literals() {
        assert!(hits("const A: u32 = 0x1f32; const B: u64 = 0xdead_bf64;").is_empty());
        assert!(hits("const A: isize = 1isize;").is_empty());
        assert!(hits("const A: &[u8] = b\"1.5\"; const B: &str = r\"1.5 f64\";").is_empty());
        assert!(hits("const A: char = 'e';").is_empty());
    }

    #[test]
    fn the_scan_names_file_and_line() {
        let dir = std::env::temp_dir().join(format!("bc-float-scan-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.rs"), "fn f() {}\nfn g() { let _ = 1.5; }\n").unwrap();
        std::fs::write(dir.join(EXEMPT), "fn h(x: f64) {}\n").unwrap();
        let out = scan_tree(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].contains("a.rs:2: 1.5"), "{out:?}");
    }

    #[test]
    fn a_same_named_file_below_the_root_is_still_scanned() {
        let dir = std::env::temp_dir().join(format!("bc-float-scan-sub-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("generation")).unwrap();
        std::fs::write(
            dir.join(EXEMPT),
            "fn h(x: f64) {}
",
        )
        .unwrap();
        std::fs::write(
            dir.join("generation").join(EXEMPT),
            "fn h(x: f64) {}
",
        )
        .unwrap();
        let out = scan_tree(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].contains("generation"), "{out:?}");
    }

    /// NFR25: no float token anywhere in `sim`'s sources, `generated/`
    /// included, outside the lint canary.
    #[test]
    fn sim_sources_hold_no_float_token() {
        let sim_src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../sim/src");
        let out = scan_tree(&sim_src);
        assert!(out.is_empty(), "float tokens in sim:\n{}", out.join("\n"));
        // The exemption is the only reason the tree is green: the canary
        // must exist and the scan must see its floats.
        let canary = std::fs::read_to_string(sim_src.join(EXEMPT)).expect("canary exists");
        assert!(!float_tokens(&canary).expect("tokenises").is_empty());
    }
}
