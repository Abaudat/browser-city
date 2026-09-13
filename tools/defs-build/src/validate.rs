//! Stage 2 of `parse, validate, emit`: cross-file and cross-kind checks a
//! single file's own parse can never catch -- duplicate ids/keys, dangling
//! references, and out-of-range balance values -- plus the conversion from
//! [`RawDefs`] (spans, one entry per file) to the plain [`Defs`]
//! [`crate::emit`] reads. Pure over an already-parsed tree; no filesystem
//! access.

use std::collections::{BTreeSet, HashMap};

use crate::error::DefsError;
use crate::model::*;
use crate::naming::{is_dotted_snake_case, is_snake_case};

/// A def key's own value must be snake_case (`docs/architecture.md`'s
/// naming table: "Data keys -- snake_case, matches Rust") -- distinct
/// from a file name's stem, which is kebab-case and checked in
/// `parse.rs`. Tim's direction: this is the check that keeps a key
/// permanently wrong the moment `check-defs-ids-append-only.sh` pins it.
fn check_key_format<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    for e in entries {
        if !is_snake_case(&e.key().value) {
            return Err(DefsError::new(
                e.path(),
                e.key().line,
                e.key().col,
                format!(
                    "invalid {kind} key '{}' -- keys must be snake_case (lowercase letters, digits, single underscores)",
                    e.key().value
                ),
            ));
        }
    }
    Ok(())
}

/// A balance key is dotted snake_case, every segment held to the same
/// rule as any other kind's key.
fn check_balance_key_format(entries: &[BalanceEntry]) -> Result<(), DefsError> {
    for e in entries {
        if !is_dotted_snake_case(&e.key.value) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "invalid balance key '{}' -- keys must be dotted snake_case, each segment lowercase letters, digits and single underscores",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

fn check_id_key_dupes<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    let mut seen_ids: HashMap<u32, &T> = HashMap::new();
    let mut seen_keys: HashMap<&str, &T> = HashMap::new();
    for e in entries {
        if let Some(prev) = seen_ids.get(&e.id().value) {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "duplicate {kind} id {} -- first declared at {}:{}:{}",
                    e.id().value,
                    prev.path().display(),
                    prev.id().line,
                    prev.id().col
                ),
            ));
        }
        seen_ids.insert(e.id().value, e);

        if let Some(prev) = seen_keys.get(e.key().value.as_str()) {
            return Err(DefsError::new(
                e.path(),
                e.key().line,
                e.key().col,
                format!(
                    "duplicate {kind} key '{}' -- first declared at {}:{}:{}",
                    e.key().value,
                    prev.path().display(),
                    prev.key().line,
                    prev.key().col
                ),
            ));
        }
        seen_keys.insert(e.key().value.as_str(), e);
    }
    Ok(())
}

fn check_balance_key_dupes(entries: &[BalanceEntry]) -> Result<(), DefsError> {
    let mut seen: HashMap<&str, &BalanceEntry> = HashMap::new();
    for e in entries {
        if let Some(prev) = seen.get(e.key.value.as_str()) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "duplicate balance key '{}' -- first declared at {}:{}:{}",
                    e.key.value,
                    prev.path.display(),
                    prev.key.line,
                    prev.key.col
                ),
            ));
        }
        seen.insert(e.key.value.as_str(), e);
    }
    Ok(())
}

fn check_recipe_item_refs(
    recipes: &[RecipeEntry],
    item_keys: &BTreeSet<&str>,
) -> Result<(), DefsError> {
    for r in recipes {
        for input in &r.inputs {
            if !item_keys.contains(input.as_str()) {
                return Err(DefsError::new(
                    &r.path,
                    r.key.line,
                    r.key.col,
                    format!(
                        "recipe '{}' names unknown item '{input}' in inputs",
                        r.key.value
                    ),
                ));
            }
        }
        for output in &r.outputs {
            if !item_keys.contains(output.as_str()) {
                return Err(DefsError::new(
                    &r.path,
                    r.key.line,
                    r.key.col,
                    format!(
                        "recipe '{}' names unknown item '{output}' in outputs",
                        r.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn check_chain_profession_refs(
    chains: &[ChainEntry],
    profession_keys: &BTreeSet<&str>,
) -> Result<(), DefsError> {
    for c in chains {
        for link in &c.links {
            if !profession_keys.contains(link.as_str()) {
                return Err(DefsError::new(
                    &c.path,
                    c.key.line,
                    c.key.col,
                    format!(
                        "chain '{}' names unknown profession '{link}' in links",
                        c.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// FR128's containment rule: a declared `collider` must have positive
/// area and must fit entirely inside the object's own footprint, sized
/// `width*COLLIDER_SUBCELLS_PER_CELL x height*COLLIDER_SUBCELLS_PER_CELL`
/// sub-cells (Tim's direction, story 1.8). Widened to `i64` throughout so
/// no combination of `i32` collider bounds can overflow the comparison.
fn check_object_colliders(entries: &[ObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        let Some(collider) = &e.collider else {
            continue;
        };
        let c = collider.value;
        if (c.x1 as i64) <= (c.x0 as i64) || (c.y1 as i64) <= (c.y0 as i64) {
            return Err(DefsError::new(
                &e.path,
                collider.line,
                collider.col,
                format!(
                    "object '{}' collider ({}, {})-({}, {}) has zero or negative area",
                    e.key.value, c.x0, c.y0, c.x1, c.y1
                ),
            ));
        }
        let max_x = e.width as i64 * COLLIDER_SUBCELLS_PER_CELL;
        let max_y = e.height as i64 * COLLIDER_SUBCELLS_PER_CELL;
        if (c.x0 as i64) < 0 || (c.y0 as i64) < 0 || (c.x1 as i64) > max_x || (c.y1 as i64) > max_y
        {
            return Err(DefsError::new(
                &e.path,
                collider.line,
                collider.col,
                format!(
                    "object '{}' collider ({}, {})-({}, {}) does not fit inside its footprint {}x{} cells ({max_x}x{max_y} sub-cells)",
                    e.key.value, c.x0, c.y0, c.x1, c.y1, e.width, e.height
                ),
            ));
        }
    }
    Ok(())
}

fn check_balance_range(entries: &[BalanceEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.value.value < e.min || e.value.value > e.max {
            return Err(DefsError::new(
                &e.path,
                e.value.line,
                e.value.col,
                format!(
                    "balance '{}' value {} is out of its own declared range [{}, {}]",
                    e.key.value, e.value.value, e.min, e.max
                ),
            ));
        }
    }
    Ok(())
}

/// Runs every cross-file/cross-kind check and returns the plain [`Defs`]
/// tree, sorted by key within each kind (Tim's direction: byte-stable
/// output regardless of file-read order). Stops at the first violation --
/// "no partial output" is a property of when `emit` is called (only after
/// this returns `Ok`), not of collecting every error at once.
pub fn validate(raw: &RawDefs) -> Result<Defs, DefsError> {
    check_key_format(&raw.objects, "object")?;
    check_key_format(&raw.items, "item")?;
    check_key_format(&raw.recipes, "recipe")?;
    check_key_format(&raw.professions, "profession")?;
    check_key_format(&raw.chains, "chain")?;
    check_balance_key_format(&raw.balance)?;

    check_id_key_dupes(&raw.objects, "object")?;
    check_id_key_dupes(&raw.items, "item")?;
    check_id_key_dupes(&raw.recipes, "recipe")?;
    check_id_key_dupes(&raw.professions, "profession")?;
    check_id_key_dupes(&raw.chains, "chain")?;
    check_balance_key_dupes(&raw.balance)?;

    check_object_colliders(&raw.objects)?;

    let item_keys: BTreeSet<&str> = raw.items.iter().map(|i| i.key.value.as_str()).collect();
    check_recipe_item_refs(&raw.recipes, &item_keys)?;

    let profession_keys: BTreeSet<&str> = raw
        .professions
        .iter()
        .map(|p| p.key.value.as_str())
        .collect();
    check_chain_profession_refs(&raw.chains, &profession_keys)?;

    check_balance_range(&raw.balance)?;

    let mut objects: Vec<ObjectDef> = raw
        .objects
        .iter()
        .map(|o| ObjectDef {
            id: o.id.value,
            key: o.key.value.clone(),
            width: o.width,
            height: o.height,
            collider: o.collider.as_ref().map(|c| ColliderRect {
                x0: c.value.x0,
                y0: c.value.y0,
                x1: c.value.x1,
                y1: c.value.y1,
            }),
        })
        .collect();
    objects.sort_by(|a, b| a.key.cmp(&b.key));

    let mut items: Vec<ItemDef> = raw
        .items
        .iter()
        .map(|i| ItemDef {
            id: i.id.value,
            key: i.key.value.clone(),
        })
        .collect();
    items.sort_by(|a, b| a.key.cmp(&b.key));

    let mut recipes: Vec<RecipeDef> = raw
        .recipes
        .iter()
        .map(|r| RecipeDef {
            id: r.id.value,
            key: r.key.value.clone(),
            inputs: {
                let mut v = r.inputs.clone();
                v.sort();
                v
            },
            outputs: {
                let mut v = r.outputs.clone();
                v.sort();
                v
            },
        })
        .collect();
    recipes.sort_by(|a, b| a.key.cmp(&b.key));

    let mut professions: Vec<ProfessionDef> = raw
        .professions
        .iter()
        .map(|p| ProfessionDef {
            id: p.id.value,
            key: p.key.value.clone(),
        })
        .collect();
    professions.sort_by(|a, b| a.key.cmp(&b.key));

    let mut chains: Vec<ChainDef> = raw
        .chains
        .iter()
        .map(|c| ChainDef {
            id: c.id.value,
            key: c.key.value.clone(),
            links: {
                let mut v = c.links.clone();
                v.sort();
                v
            },
        })
        .collect();
    chains.sort_by(|a, b| a.key.cmp(&b.key));

    let mut balance: Vec<BalanceDef> = raw
        .balance
        .iter()
        .map(|b| BalanceDef {
            key: b.key.value.clone(),
            value: b.value.value,
            min: b.min,
            max: b.max,
        })
        .collect();
    balance.sort_by(|a, b| a.key.cmp(&b.key));

    Ok(Defs {
        objects,
        items,
        recipes,
        professions,
        chains,
        balance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_all;
    use std::path::PathBuf;

    fn files(pairs: &[(&str, &str)]) -> Vec<(PathBuf, String)> {
        pairs
            .iter()
            .map(|(p, t)| (PathBuf::from(p), t.to_string()))
            .collect()
    }

    fn valid_tree() -> Vec<(PathBuf, String)> {
        files(&[
            (
                "defs/objects/city-props.toml",
                "[[object]]\nid = 1\nkey = \"trash_bin\"\nwidth = 1\nheight = 1\n",
            ),
            (
                "defs/items/sanitation.toml",
                "[[item]]\nid = 1\nkey = \"bottle\"\n\n[[item]]\nid = 2\nkey = \"recycled_glass\"\n",
            ),
            (
                "defs/recipes/sanitation.toml",
                "[[recipe]]\nid = 1\nkey = \"bottle_recycling\"\ninputs = [\"bottle\"]\noutputs = [\"recycled_glass\"]\n",
            ),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/chains/sanitation.toml",
                "[[chain]]\nid = 1\nkey = \"plastic_bottle\"\nlinks = [\"sanitation_worker\"]\n",
            ),
            (
                "defs/balance/citizen.toml",
                "[[balance]]\nkey = \"citizen.bar_decay.rest\"\nvalue = 10\nmin = 0\nmax = 100\n",
            ),
        ])
    }

    #[test]
    fn a_consistent_tree_validates_and_sorts_by_key() {
        let raw = parse_all(&valid_tree()).unwrap();
        let defs = validate(&raw).unwrap();
        assert_eq!(defs.objects[0].key, "trash_bin");
        assert_eq!(defs.items[0].key, "bottle");
        assert_eq!(defs.recipes[0].inputs, vec!["bottle"]);
        assert_eq!(defs.chains[0].links, vec!["sanitation_worker"]);
        assert_eq!(defs.balance[0].value, 10);
    }

    #[test]
    fn a_kebab_case_key_is_rejected_as_invalid_snake_case() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"trash-bin\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("invalid item key 'trash-bin'"));
    }

    #[test]
    fn a_balance_key_with_a_kebab_case_segment_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"citizen.bar-decay.rest\"\nvalue = 1\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(
            err.message
                .contains("invalid balance key 'citizen.bar-decay.rest'")
        );
    }

    #[test]
    fn duplicate_id_within_one_file_is_rejected() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"a\"\n\n[[item]]\nid = 1\nkey = \"b\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("duplicate item id 1"));
    }

    #[test]
    fn duplicate_id_across_two_files_in_the_same_subdirectory_is_rejected() {
        let f = files(&[
            ("defs/items/a.toml", "[[item]]\nid = 1\nkey = \"a\"\n"),
            ("defs/items/b.toml", "[[item]]\nid = 1\nkey = \"b\"\n"),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.path.ends_with("b.toml"));
        assert!(err.message.contains("duplicate item id 1"));
        assert!(err.message.contains("a.toml"));
    }

    #[test]
    fn duplicate_key_is_rejected_even_with_distinct_ids() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"a\"\n\n[[item]]\nid = 2\nkey = \"a\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("duplicate item key 'a'"));
    }

    #[test]
    fn duplicate_balance_key_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 1\nmin = 0\nmax = 10\n\n[[balance]]\nkey = \"a\"\nvalue = 2\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("duplicate balance key 'a'"));
    }

    #[test]
    fn a_recipe_naming_an_unknown_item_is_rejected() {
        let f = files(&[(
            "defs/recipes/x.toml",
            "[[recipe]]\nid = 1\nkey = \"r\"\ninputs = [\"nope\"]\noutputs = []\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("unknown item 'nope'"));
    }

    #[test]
    fn a_chain_naming_an_unknown_profession_is_rejected() {
        let f = files(&[(
            "defs/chains/x.toml",
            "[[chain]]\nid = 1\nkey = \"c\"\nlinks = [\"nope\"]\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("unknown profession 'nope'"));
    }

    #[test]
    fn an_out_of_range_balance_value_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 999\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("out of its own declared range"));
    }

    #[test]
    fn a_zero_area_collider_is_rejected() {
        let f = files(&[(
            "defs/objects/x.toml",
            "[[object]]\nid = 1\nkey = \"a\"\nwidth = 1\nheight = 1\ncollider = { x0 = 5, y0 = 5, x1 = 5, y1 = 9 }\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("zero or negative area"));
    }

    #[test]
    fn a_collider_outside_the_footprint_is_rejected() {
        let f = files(&[(
            "defs/objects/x.toml",
            "[[object]]\nid = 1\nkey = \"a\"\nwidth = 1\nheight = 1\ncollider = { x0 = 0, y0 = 0, x1 = 20, y1 = 8 }\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw).unwrap_err();
        assert!(err.message.contains("does not fit inside its footprint"));
    }

    #[test]
    fn a_collider_flush_with_the_footprint_edge_is_accepted() {
        let f = files(&[(
            "defs/objects/x.toml",
            "[[object]]\nid = 1\nkey = \"a\"\nwidth = 1\nheight = 1\ncollider = { x0 = 0, y0 = 0, x1 = 16, y1 = 16 }\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw).unwrap();
        assert_eq!(
            defs.objects[0].collider,
            Some(ColliderRect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16
            })
        );
    }

    #[test]
    fn an_absent_collider_stays_none() {
        let f = files(&[(
            "defs/objects/x.toml",
            "[[object]]\nid = 1\nkey = \"a\"\nwidth = 1\nheight = 1\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw).unwrap();
        assert_eq!(defs.objects[0].collider, None);
    }

    #[test]
    fn an_in_range_balance_value_at_the_boundary_is_accepted() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 10\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw).is_ok());
    }
}
