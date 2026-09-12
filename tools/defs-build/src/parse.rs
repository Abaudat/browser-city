//! Stage 1 of `parse, validate, emit`: turns `(relative path, file text)`
//! pairs into a [`RawDefs`] tree, or the first [`DefsError`] found. Pure
//! over in-memory input -- the only filesystem touch belongs to the
//! binary's own `main.rs` (Quentin's direction).

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use toml::Spanned;

use crate::error::DefsError;
use crate::model::*;
use crate::naming::is_kebab_case;
use crate::spans::line_col;

/// Every git-tracked file under `defs/` must reach this branch or the
/// `.toml`-extension one below it -- there is no third, silent path
/// (Quentin/Tim's direction: a `defs/items/notes.md` or a stray `.json`
/// must be a hard, named build error, not quietly excluded before
/// parsing ever sees it). Callers must never pre-filter the file list by
/// extension.
fn check_filename(path: &Path) -> Result<(), DefsError> {
    if path.extension().and_then(|e| e.to_str()) != Some("toml") {
        return Err(DefsError::new(
            path,
            1,
            1,
            "defs/ file must have a .toml extension",
        ));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if is_kebab_case(stem) {
        Ok(())
    } else {
        Err(DefsError::new(
            path,
            1,
            1,
            format!(
                "'{stem}' is not kebab-case -- file names under defs/ must be lowercase letters, digits and single hyphens (docs/architecture.md's naming table)"
            ),
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Objects,
    Items,
    Recipes,
    Professions,
    Chains,
    Balance,
}

/// `path` must read `defs/<kind>/<name>.toml` -- the kind is the second
/// path component, checked against every subdirectory `defs/` declares
/// (docs/architecture.md), never inferred from the file's own content.
fn kind_of(path: &Path) -> Result<Kind, DefsError> {
    let comps: Vec<&str> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();
    let kind_str = if comps.len() >= 2 {
        comps[comps.len() - 2]
    } else {
        ""
    };
    match kind_str {
        "objects" => Ok(Kind::Objects),
        "items" => Ok(Kind::Items),
        "recipes" => Ok(Kind::Recipes),
        "professions" => Ok(Kind::Professions),
        "chains" => Ok(Kind::Chains),
        "balance" => Ok(Kind::Balance),
        other => Err(DefsError::new(
            path,
            1,
            1,
            format!(
                "not under a known defs/ kind directory (found '{other}') -- expected one of objects/items/recipes/professions/chains/balance"
            ),
        )),
    }
}

fn located<T: Clone>(text: &str, spanned: &Spanned<T>) -> Located<T> {
    let (line, col) = line_col(text, spanned.span().start);
    Located::at(spanned.get_ref().clone(), line, col)
}

fn parse_toml<T: DeserializeOwned>(path: &Path, text: &str) -> Result<T, DefsError> {
    toml::from_str::<T>(text).map_err(|e| {
        let offset = e.span().map(|s| s.start).unwrap_or(0);
        let (line, col) = line_col(text, offset);
        DefsError::new(path, line, col, e.message().to_string())
    })
}

/// Parses every `(path, text)` pair into one [`RawDefs`] tree. Files are
/// processed in the order given -- callers sort by path first, so
/// duplicate-id/key detection in `validate.rs` reports a deterministic
/// "first declared at" location regardless of the host filesystem's own
/// directory-listing order.
pub fn parse_all(files: &[(PathBuf, String)]) -> Result<RawDefs, DefsError> {
    let mut raw = RawDefs::default();
    for (path, text) in files {
        check_filename(path)?;
        match kind_of(path)? {
            Kind::Objects => {
                let file: ObjectFile = parse_toml(path, text)?;
                for o in file.object {
                    raw.objects.push(ObjectEntry {
                        path: path.clone(),
                        id: located(text, &o.id),
                        key: located(text, &o.key),
                        width: o.width,
                        height: o.height,
                    });
                }
            }
            Kind::Items => {
                let file: ItemFile = parse_toml(path, text)?;
                for i in file.item {
                    raw.items.push(ItemEntry {
                        path: path.clone(),
                        id: located(text, &i.id),
                        key: located(text, &i.key),
                    });
                }
            }
            Kind::Recipes => {
                let file: RecipeFile = parse_toml(path, text)?;
                for r in file.recipe {
                    raw.recipes.push(RecipeEntry {
                        path: path.clone(),
                        id: located(text, &r.id),
                        key: located(text, &r.key),
                        inputs: r.inputs,
                        outputs: r.outputs,
                    });
                }
            }
            Kind::Professions => {
                let file: ProfessionFile = parse_toml(path, text)?;
                for p in file.profession {
                    raw.professions.push(ProfessionEntry {
                        path: path.clone(),
                        id: located(text, &p.id),
                        key: located(text, &p.key),
                    });
                }
            }
            Kind::Chains => {
                let file: ChainFile = parse_toml(path, text)?;
                for c in file.chain {
                    raw.chains.push(ChainEntry {
                        path: path.clone(),
                        id: located(text, &c.id),
                        key: located(text, &c.key),
                        links: c.links,
                    });
                }
            }
            Kind::Balance => {
                let file: BalanceFile = parse_toml(path, text)?;
                for b in file.balance {
                    raw.balance.push(BalanceEntry {
                        path: path.clone(),
                        key: located(text, &b.key),
                        value: located(text, &b.value),
                        min: b.min,
                        max: b.max,
                    });
                }
            }
        }
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(pairs: &[(&str, &str)]) -> Vec<(PathBuf, String)> {
        pairs
            .iter()
            .map(|(p, t)| (PathBuf::from(p), t.to_string()))
            .collect()
    }

    #[test]
    fn parses_one_object_file_with_two_entries() {
        let f = files(&[(
            "defs/objects/city-props.toml",
            "[[object]]\nid = 1\nkey = \"trash_bin\"\nwidth = 1\nheight = 1\n\n[[object]]\nid = 2\nkey = \"bench\"\nwidth = 2\nheight = 1\n",
        )]);
        let raw = parse_all(&f).unwrap();
        assert_eq!(raw.objects.len(), 2);
        assert_eq!(raw.objects[0].id.value, 1);
        assert_eq!(raw.objects[0].key.value, "trash_bin");
        assert_eq!(raw.objects[1].width, 2);
    }

    #[test]
    fn rejects_a_file_outside_a_known_kind_directory() {
        let f = files(&[("defs/mystery/x.toml", "id = 1\n")]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("not under a known defs/ kind"));
    }

    #[test]
    fn rejects_a_non_toml_extension() {
        let f = files(&[("defs/objects/city-props.json", "{}")]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains(".toml extension"));
    }

    #[test]
    fn rejects_a_non_kebab_case_filename_before_reading_content() {
        let f = files(&[("defs/objects/CityProps.toml", "not even valid toml {{{")]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("not kebab-case"));
    }

    #[test]
    fn a_toml_syntax_error_names_its_line_and_column() {
        let f = files(&[("defs/items/broken.toml", "[[item]\nid = 1\n")]);
        let err = parse_all(&f).unwrap_err();
        assert_eq!(err.path, PathBuf::from("defs/items/broken.toml"));
        assert_eq!(err.line, 1);
    }

    #[test]
    fn an_unknown_field_is_reported_with_its_own_line() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"a\"\nbogus = 2\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert_eq!(err.line, 4);
        assert!(err.message.contains("bogus"));
    }

    #[test]
    fn a_missing_required_field_is_reported() {
        let f = files(&[("defs/items/x.toml", "[[item]]\nkey = \"a\"\n")]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("missing field"));
        assert!(err.message.contains("id"));
    }

    #[test]
    fn a_wrong_value_type_is_reported_at_the_bad_value() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = \"nope\"\nkey = \"a\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert_eq!(err.line, 2);
        assert!(err.message.contains("invalid type"));
    }
}
