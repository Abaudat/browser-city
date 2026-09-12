//! Stage 2 of `parse, validate, emit`: cross-file and cross-kind checks a
//! single file's own parse can never catch -- duplicate ids/keys, dangling
//! references, and out-of-range balance values -- plus the conversion from
//! [`RawDefs`] (spans, one entry per file) to the plain [`Defs`]
//! [`crate::emit`] reads. Pure over an already-parsed tree; no filesystem
//! access.

use std::collections::{BTreeSet, HashMap};

use crate::error::DefsError;
use crate::model::*;

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
    check_id_key_dupes(&raw.objects, "object")?;
    check_id_key_dupes(&raw.items, "item")?;
    check_id_key_dupes(&raw.recipes, "recipe")?;
    check_id_key_dupes(&raw.professions, "profession")?;
    check_id_key_dupes(&raw.chains, "chain")?;
    check_balance_key_dupes(&raw.balance)?;

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
                "[[object]]\nid = 1\nkey = \"trash-bin\"\nwidth = 1\nheight = 1\n",
            ),
            (
                "defs/items/sanitation.toml",
                "[[item]]\nid = 1\nkey = \"bottle\"\n\n[[item]]\nid = 2\nkey = \"recycled-glass\"\n",
            ),
            (
                "defs/recipes/sanitation.toml",
                "[[recipe]]\nid = 1\nkey = \"bottle-recycling\"\ninputs = [\"bottle\"]\noutputs = [\"recycled-glass\"]\n",
            ),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation-worker\"\n",
            ),
            (
                "defs/chains/sanitation.toml",
                "[[chain]]\nid = 1\nkey = \"plastic-bottle\"\nlinks = [\"sanitation-worker\"]\n",
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
        assert_eq!(defs.objects[0].key, "trash-bin");
        assert_eq!(defs.items[0].key, "bottle");
        assert_eq!(defs.recipes[0].inputs, vec!["bottle"]);
        assert_eq!(defs.chains[0].links, vec!["sanitation-worker"]);
        assert_eq!(defs.balance[0].value, 10);
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
    fn an_in_range_balance_value_at_the_boundary_is_accepted() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 10\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw).is_ok());
    }
}
