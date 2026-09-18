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

/// Every file `fsio::list_defs_sources` hands `parse_all` must reach this
/// branch or the `.toml`-extension one below it -- there is no third,
/// silent path (Quentin/Tim's direction: a `defs/items/notes.md` or a
/// stray `.json` must be a hard, named build error, not quietly excluded
/// before parsing ever sees it; `list_defs_sources` is the one place that
/// excludes `defs/README.md`, agent-facing documentation, not a def).
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
    PageGroups,
    Appearance,
    Tags,
    Rules,
    Archetypes,
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
        "atlas" => Ok(Kind::PageGroups),
        "appearance" => Ok(Kind::Appearance),
        "tags" => Ok(Kind::Tags),
        "rules" => Ok(Kind::Rules),
        "archetypes" => Ok(Kind::Archetypes),
        other => Err(DefsError::new(
            path,
            1,
            1,
            format!(
                "not under a known defs/ kind directory (found '{other}') -- expected one of objects/items/recipes/professions/chains/balance/atlas/appearance/tags/rules/archetypes"
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
                        name: located(text, &o.name),
                        layer: located(text, &o.layer),
                        sprite: located(text, &o.sprite),
                        width: o.width,
                        height: o.height,
                        collider: o.collider.as_ref().map(|c| located(text, c)),
                        interact_at: o.interact_at.as_ref().map(|c| located(text, c)),
                        window: o.window,
                        tags: o.tags,
                        archetype: o.archetype.as_ref().map(|a| located(text, a)),
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
            Kind::PageGroups => {
                let file: PageGroupFile = parse_toml(path, text)?;
                for g in file.page_group {
                    raw.page_groups.push(PageGroupEntry {
                        path: path.clone(),
                        theme: located(text, &g.theme),
                        group: located(text, &g.group),
                    });
                }
            }
            Kind::Appearance => {
                let file: AppearanceFile = parse_toml(path, text)?;
                for b in file.body {
                    raw.bodies.push(BodyEntry {
                        path: path.clone(),
                        id: located(text, &b.id),
                        key: located(text, &b.key),
                        family: located(text, &b.family),
                        sheet: located(text, &b.sheet),
                        pool: located(text, &b.pool),
                    });
                }
                for e in file.eyes {
                    raw.eyes.push(EyesEntry {
                        path: path.clone(),
                        id: located(text, &e.id),
                        key: located(text, &e.key),
                        family: located(text, &e.family),
                        sheet: located(text, &e.sheet),
                        pool: located(text, &e.pool),
                    });
                }
                for h in file.hairstyle {
                    raw.hairstyles.push(HairstyleEntry {
                        path: path.clone(),
                        id: located(text, &h.id),
                        key: located(text, &h.key),
                        family: located(text, &h.family),
                        sheet: located(text, &h.sheet),
                        style: h.style,
                        color: h.color,
                        rare: h.rare,
                    });
                }
                for o in file.outfit {
                    raw.outfits.push(OutfitEntry {
                        path: path.clone(),
                        id: located(text, &o.id),
                        key: located(text, &o.key),
                        family: located(text, &o.family),
                        sheet: located(text, &o.sheet),
                        pool: located(text, &o.pool),
                        hides_hairstyle: o.hides_hairstyle,
                    });
                }
                for a in file.accessory {
                    raw.accessories.push(AccessoryEntry {
                        path: path.clone(),
                        id: located(text, &a.id),
                        key: located(text, &a.key),
                        family: located(text, &a.family),
                        sheet: located(text, &a.sheet),
                        pool: located(text, &a.pool),
                        slot: located(text, &a.slot),
                    });
                }
                for l in file.appearance_layout {
                    raw.appearance_layouts.push(AppearanceLayoutEntry {
                        path: path.clone(),
                        id: located(text, &l.id),
                        key: located(text, &l.key),
                        family: located(text, &l.family),
                        cell_width: l.cell_width,
                        cell_height: l.cell_height,
                        directions: l.directions,
                        rows: l
                            .rows
                            .into_iter()
                            .map(|r| AppearanceLayoutRowEntry {
                                animation: r.animation,
                                row: r.row,
                                frames_per_direction: r.frames_per_direction,
                            })
                            .collect(),
                        accepted_sizes: {
                            let located_sizes = located(text, &l.accepted_sizes);
                            Located::at(
                                located_sizes
                                    .value
                                    .into_iter()
                                    .map(|s| (s.width, s.height))
                                    .collect(),
                                located_sizes.line,
                                located_sizes.col,
                            )
                        },
                    });
                }
                for u in file.uniform {
                    raw.uniforms.push(UniformEntry {
                        path: path.clone(),
                        id: located(text, &u.id),
                        key: located(text, &u.key),
                        profession: located(text, &u.profession),
                        outfit: u.outfit,
                        accessory: u.accessory,
                    });
                }
            }
            Kind::Tags => {
                let file: TagFile = parse_toml(path, text)?;
                for t in file.tag {
                    raw.tags.push(TagEntry {
                        path: path.clone(),
                        id: located(text, &t.id),
                        key: located(text, &t.key),
                        role: t.role.clone(),
                    });
                }
            }
            Kind::Rules => {
                let file: RuleFile = parse_toml(path, text)?;
                for p in file.placement {
                    raw.placements.push(PlacementEntry {
                        path: path.clone(),
                        id: located(text, &p.id),
                        key: located(text, &p.key),
                        subject: located(text, &p.subject),
                        container: p.container.as_ref().map(|c| located(text, c)),
                        floor_min: p.floor_min,
                        floor_max: p.floor_max,
                    });
                }
                for d in file.distribution {
                    raw.distributions.push(DistributionEntry {
                        path: path.clone(),
                        id: located(text, &d.id),
                        key: located(text, &d.key),
                        subject: located(text, &d.subject),
                        per: located(text, &d.per),
                        ratio: located(text, &d.ratio),
                        tolerance_percent: located(text, &d.tolerance_percent),
                        min_spacing: d.min_spacing,
                        max_distance: located(text, &d.max_distance),
                    });
                }
                for coh in file.coherence {
                    raw.coherences.push(CoherenceEntry {
                        path: path.clone(),
                        id: located(text, &coh.id),
                        key: located(text, &coh.key),
                        subject: located(text, &coh.subject),
                        within: located(text, &coh.within),
                        mode: coh.mode,
                    });
                }
                for adj in file.adjacency {
                    raw.adjacencies.push(AdjacencyEntry {
                        path: path.clone(),
                        id: located(text, &adj.id),
                        key: located(text, &adj.key),
                        a: located(text, &adj.a),
                        b: adj.b.as_ref().map(|b| located(text, b)),
                        direction: adj.direction,
                        alternatives: adj.alternatives.clone(),
                        rotate: adj.rotate,
                        relation: adj.relation,
                    });
                }
                for req in file.requirement {
                    raw.requirements.push(RequirementEntry {
                        path: path.clone(),
                        id: located(text, &req.id),
                        key: located(text, &req.key),
                        container: located(text, &req.container),
                        requires: located(text, &req.requires),
                        min: req.min,
                        max: req.max,
                    });
                }
            }
            Kind::Archetypes => {
                let file: ArchetypeFile = parse_toml(path, text)?;
                for a in file.archetype {
                    raw.archetypes.push(ArchetypeEntry {
                        path: path.clone(),
                        key: located(text, &a.key),
                        height: a.height.as_ref().map(|h| located(text, h)),
                        collider_inset: a.collider_inset.as_ref().map(|c| located(text, c)),
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

    const OBJECT_TOML_HEADER: &str = "name = \"Trash Bin\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\n";

    #[test]
    fn parses_one_object_file_with_two_entries() {
        let f = files(&[(
            "defs/objects/city-props.toml",
            &format!(
                "[[object]]\nid = 1\nkey = \"trash_bin\"\n{OBJECT_TOML_HEADER}width = 1\nheight = 1\n\n[[object]]\nid = 2\nkey = \"bench\"\n{OBJECT_TOML_HEADER}width = 2\nheight = 1\n"
            ),
        )]);
        let raw = parse_all(&f).unwrap();
        assert_eq!(raw.objects.len(), 2);
        assert_eq!(raw.objects[0].id.value, 1);
        assert_eq!(raw.objects[0].key.value, "trash_bin");
        assert_eq!(raw.objects[0].name.value, "Trash Bin");
        assert_eq!(raw.objects[0].layer.value, "furniture");
        assert_eq!(
            raw.objects[0].sprite.value.sheet,
            "fixtures/objects/test.png"
        );
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
