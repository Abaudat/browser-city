//! Stage 2 of `parse, validate, emit`: cross-file and cross-kind checks a
//! single file's own parse can never catch -- duplicate ids/keys, dangling
//! references, and out-of-range balance values -- plus the conversion from
//! [`RawDefs`] (spans, one entry per file) to the plain [`Defs`]
//! [`crate::emit`] reads. Pure over an already-parsed tree; no filesystem
//! access.

use std::collections::{BTreeMap, BTreeSet, HashMap};

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

/// FR148's reach rules (Tim's direction, story 1.9). A declared
/// `interact_at` must have positive area, must not reach further than
/// [`INTERACT_AT_MAX_REACH_CELLS`] beyond its own footprint on any side,
/// and -- when the object also declares a `collider` -- must not lie
/// entirely inside it, because a player can never stand inside a
/// collider, so such a rect could never be reached. Widened to `i64`
/// throughout, exactly like the collider check, so no combination of
/// `i32` bounds can overflow a comparison.
fn check_object_interact_at(entries: &[ObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        let Some(interact_at) = &e.interact_at else {
            continue;
        };
        let r = interact_at.value;
        if (r.x1 as i64) <= (r.x0 as i64) || (r.y1 as i64) <= (r.y0 as i64) {
            return Err(DefsError::new(
                &e.path,
                interact_at.line,
                interact_at.col,
                format!(
                    "object '{}' interact_at ({}, {})-({}, {}) has zero or negative area",
                    e.key.value, r.x0, r.y0, r.x1, r.y1
                ),
            ));
        }

        let reach = INTERACT_AT_MAX_REACH_CELLS * COLLIDER_SUBCELLS_PER_CELL;
        let max_x = e.width as i64 * COLLIDER_SUBCELLS_PER_CELL;
        let max_y = e.height as i64 * COLLIDER_SUBCELLS_PER_CELL;
        if (r.x0 as i64) < -reach
            || (r.y0 as i64) < -reach
            || (r.x1 as i64) > max_x + reach
            || (r.y1 as i64) > max_y + reach
        {
            return Err(DefsError::new(
                &e.path,
                interact_at.line,
                interact_at.col,
                format!(
                    "object '{}' interact_at ({}, {})-({}, {}) reaches further than {INTERACT_AT_MAX_REACH_CELLS} cell(s) beyond its own {}x{} footprint",
                    e.key.value, r.x0, r.y0, r.x1, r.y1, e.width, e.height
                ),
            ));
        }

        if let Some(collider) = &e.collider {
            let c = collider.value;
            let inside = (r.x0 as i64) >= (c.x0 as i64)
                && (r.y0 as i64) >= (c.y0 as i64)
                && (r.x1 as i64) <= (c.x1 as i64)
                && (r.y1 as i64) <= (c.y1 as i64);
            if inside {
                return Err(DefsError::new(
                    &e.path,
                    interact_at.line,
                    interact_at.col,
                    format!(
                        "object '{}' interact_at ({}, {})-({}, {}) lies entirely inside its own collider ({}, {})-({}, {}) -- it could never be reached",
                        e.key.value, r.x0, r.y0, r.x1, r.y1, c.x0, c.y0, c.x1, c.y1
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn check_object_names(entries: &[ObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.name.value.trim().is_empty() {
            return Err(DefsError::new(
                &e.path,
                e.name.line,
                e.name.col,
                format!("object '{}' has an empty name", e.key.value),
            ));
        }
    }
    Ok(())
}

/// Resolves one object's authored `layer` name against the codes golden's
/// own `name -> code` map (Tim's direction: resolved at build time, never
/// at runtime) -- refusing an unknown or deprecated name, naming the
/// object and the accepted set.
fn resolve_object_layer(
    e: &ObjectEntry,
    layer_codes: &BTreeMap<String, u32>,
) -> Result<u32, DefsError> {
    if crate::layer_codes::DEPRECATED_LAYER_NAMES.contains(&e.layer.value.as_str()) {
        return Err(DefsError::new(
            &e.path,
            e.layer.line,
            e.layer.col,
            format!(
                "object '{}' names deprecated layer '{}' -- a deprecated layer may never be placed on",
                e.key.value, e.layer.value
            ),
        ));
    }
    match layer_codes.get(&e.layer.value) {
        Some(&code) => Ok(code),
        None => {
            let accepted: Vec<&str> = layer_codes.keys().map(|s| s.as_str()).collect();
            Err(DefsError::new(
                &e.path,
                e.layer.line,
                e.layer.col,
                format!(
                    "object '{}' names unknown layer '{}' -- accepted layers are [{}]",
                    e.key.value,
                    e.layer.value,
                    accepted.join(", ")
                ),
            ))
        }
    }
}

fn check_object_layers(
    entries: &[ObjectEntry],
    layer_codes: &BTreeMap<String, u32>,
) -> Result<(), DefsError> {
    for e in entries {
        resolve_object_layer(e, layer_codes)?;
    }
    Ok(())
}

/// A sprite's own sheet must have had its `IHDR` dimensions read
/// (`sheet_dims`, exactly like an appearance part's `sheet`), and the
/// rect must lie entirely inside it, and have positive area.
fn check_object_sprite_sheets(
    entries: &[ObjectEntry],
    sheet_dims: &BTreeMap<String, (u32, u32)>,
) -> Result<(), DefsError> {
    for e in entries {
        let sprite = &e.sprite.value;
        let Some(&(sheet_w, sheet_h)) = sheet_dims.get(&sprite.sheet) else {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' names sheet '{}' but its dimensions were never read",
                    e.key.value, sprite.sheet
                ),
            ));
        };
        if sprite.w == 0 || sprite.h == 0 {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite rect has zero width or height",
                    e.key.value
                ),
            ));
        }
        let x1 = sprite.x as u64 + sprite.w as u64;
        let y1 = sprite.y as u64 + sprite.h as u64;
        if x1 > sheet_w as u64 || y1 > sheet_h as u64 {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite rect ({}, {})-({x1}, {y1}) does not fit inside sheet '{}' ({sheet_w}x{sheet_h}px)",
                    e.key.value, sprite.x, sprite.y, sprite.sheet
                ),
            ));
        }
    }
    Ok(())
}

/// FR126's decomposition reads per-cell sub-rects from the sprite, so the
/// sprite must agree with the footprint exactly (Tim's direction):
/// `w == width * tile_size_px` exactly (an object never overhangs
/// sideways -- that overhang was refused at mount time before this story;
/// now it is refused here, at authoring time), `h` a whole multiple of
/// `tile_size_px`, and `h >= height * tile_size_px` (a tall prop may
/// overhang upward, never downward -- bottom-anchored).
fn check_object_sprite_matches_footprint(
    entries: &[ObjectEntry],
    tile_size_px: u32,
) -> Result<(), DefsError> {
    for e in entries {
        let sprite = &e.sprite.value;
        let expected_w = e.width * tile_size_px;
        if sprite.w != expected_w {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite width {} does not equal its footprint width {} * tile_size_px {tile_size_px} ({expected_w}px)",
                    e.key.value, sprite.w, e.width
                ),
            ));
        }
        if sprite.h % tile_size_px != 0 {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite height {} is not a whole multiple of tile_size_px {tile_size_px}",
                    e.key.value, sprite.h
                ),
            ));
        }
        let min_h = e.height * tile_size_px;
        if sprite.h < min_h {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite height {} is shorter than its footprint height {} * tile_size_px {tile_size_px} ({min_h}px)",
                    e.key.value, sprite.h, e.height
                ),
            ));
        }
    }
    Ok(())
}

/// FR127's cap, checked on `width` and `height` independently (Tim's
/// direction) -- the error names the object and its size, and directs the
/// author to compose the structure from multiple objects (the acceptance
/// criterion's own sentence).
fn check_object_footprint_cap(entries: &[ObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.width == 0 || e.height == 0 {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' has a footprint width or height of 0 -- every object occupies at least one cell",
                    e.key.value
                ),
            ));
        }
        if e.width as i64 > MAX_FOOTPRINT_CELLS {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' footprint width {} exceeds MAX_FOOTPRINT_CELLS ({MAX_FOOTPRINT_CELLS}) -- compose the structure from multiple objects",
                    e.key.value, e.width
                ),
            ));
        }
        if e.height as i64 > MAX_FOOTPRINT_CELLS {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' footprint height {} exceeds MAX_FOOTPRINT_CELLS ({MAX_FOOTPRINT_CELLS}) -- compose the structure from multiple objects",
                    e.key.value, e.height
                ),
            ));
        }
    }
    Ok(())
}

/// `render.tile_size_px` is a balance key like any other (`defs/balance/
/// render.toml`), read from the already-parsed tree -- never a literal
/// here. `None` when the tree declares no such key; `validate` turns that
/// into a hard error the moment the tree also declares an object (a tree
/// with objects but no `render.tile_size_px` cannot check FR126's sprite
/// agreement at all).
fn find_tile_size_px(balance: &[BalanceEntry]) -> Option<u32> {
    balance
        .iter()
        .find(|b| b.key.value == "render.tile_size_px")
        .map(|b| b.value.value as u32)
}

/// Id `0` is never issued for any appearance part kind -- it is the
/// runtime sentinel for "no layer" (legal only for a generated
/// hairstyle/accessory *value*, never for a declared def), so a declared
/// id of `0` here is always a mistake, not a valid entry.
fn check_appearance_id_not_zero<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    for e in entries {
        if e.id().value == 0 {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "{kind} '{}' declares id 0 -- 0 is reserved as the runtime \"no layer\" sentinel and is never a declared id",
                    e.key().value
                ),
            ));
        }
    }
    Ok(())
}

/// A body/eyes/hairstyle/outfit/accessory id is stored as `u16`
/// (`sim::appearance::Appearance` and the `citizen` schema columns): an
/// id above 65535 would silently truncate into a different part, so it
/// is rejected here rather than at the cast.
const APPEARANCE_ID_MAX: u32 = u16::MAX as u32;

fn check_appearance_id_u16<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    for e in entries {
        if e.id().value > APPEARANCE_ID_MAX {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "{kind} '{}' declares id {} which does not fit in a u16 (max {APPEARANCE_ID_MAX})",
                    e.key().value,
                    e.id().value
                ),
            ));
        }
    }
    Ok(())
}

/// A layout is only ever shared within one family, so every part sheet's
/// `(animation, direction, frame)` cells must fit inside its own family's
/// declared grid -- checked against the sheet's own `IHDR` dimensions
/// (`sheet_dims`, read by `fsio` from the real file), never assumed from
/// a byte count or a vendor's own claim.
fn layout_for_family(
    layouts: &[AppearanceLayoutEntry],
    family: Family,
) -> Option<&AppearanceLayoutEntry> {
    layouts.iter().find(|l| l.family.value == family)
}

/// The part-agnostic fields [`check_sheet_fits_layout`] needs -- bundled so
/// that function stays under clippy's argument-count lint despite naming a
/// path, a span, a kind, a key, a family and a sheet all independently.
struct SheetCheck<'a> {
    path: &'a std::path::Path,
    line: usize,
    col: usize,
    kind: &'a str,
    key: &'a str,
    family: Family,
    sheet: &'a str,
}

fn check_sheet_fits_layout(
    part: SheetCheck<'_>,
    layouts: &[AppearanceLayoutEntry],
    sheet_dims: &BTreeMap<String, (u32, u32)>,
) -> Result<(), DefsError> {
    let SheetCheck {
        path,
        line,
        col,
        kind,
        key,
        family,
        sheet,
    } = part;
    let Some(layout) = layout_for_family(layouts, family) else {
        return Err(DefsError::new(
            path,
            line,
            col,
            format!(
                "{kind} '{key}' declares family '{}' but no [[appearance_layout]] entry declares that family",
                family.as_str()
            ),
        ));
    };
    let Some(&(width, height)) = sheet_dims.get(sheet) else {
        return Err(DefsError::new(
            path,
            line,
            col,
            format!("{kind} '{key}' names sheet '{sheet}' but its dimensions were never read"),
        ));
    };
    if !layout.accepted_sizes.value.contains(&(width, height)) {
        let accepted: Vec<String> = layout
            .accepted_sizes
            .value
            .iter()
            .map(|(w, h)| format!("{w}x{h}"))
            .collect();
        return Err(DefsError::new(
            path,
            line,
            col,
            format!(
                "{kind} '{key}' sheet '{sheet}' is {width}x{height}px but family '{}' only accepts [{}]",
                family.as_str(),
                accepted.join(", ")
            ),
        ));
    }
    Ok(())
}

/// Exactly one `[[appearance_layout]]` per family (a layout is shared
/// *within* a family, so two competing layouts for the same family would
/// make "the" family layout ambiguous), a non-empty `directions` and
/// `accepted_sizes` list, and every declared row fits inside every
/// declared accepted size -- a layout that names a size too small for its
/// own grid is a defs-authoring mistake, not something to catch only once
/// a sheet happens to use that size.
fn check_one_layout_per_family(layouts: &[AppearanceLayoutEntry]) -> Result<(), DefsError> {
    let mut seen: HashMap<Family, &AppearanceLayoutEntry> = HashMap::new();
    for l in layouts {
        if let Some(prev) = seen.get(&l.family.value) {
            return Err(DefsError::new(
                &l.path,
                l.family.line,
                l.family.col,
                format!(
                    "appearance_layout '{}' declares family '{}' but '{}' already declared it -- exactly one layout per family",
                    l.key.value,
                    l.family.value.as_str(),
                    prev.key.value
                ),
            ));
        }
        seen.insert(l.family.value, l);
        if l.directions.is_empty() {
            return Err(DefsError::new(
                &l.path,
                l.key.line,
                l.key.col,
                format!("appearance_layout '{}' declares no directions", l.key.value),
            ));
        }
        if l.accepted_sizes.value.is_empty() {
            return Err(DefsError::new(
                &l.path,
                l.accepted_sizes.line,
                l.accepted_sizes.col,
                format!(
                    "appearance_layout '{}' declares no accepted_sizes",
                    l.key.value
                ),
            ));
        }
        for r in &l.rows {
            if r.frames_per_direction == 0 {
                return Err(DefsError::new(
                    &l.path,
                    l.key.line,
                    l.key.col,
                    format!(
                        "appearance_layout '{}' row '{}' declares 0 frames_per_direction",
                        l.key.value, r.animation
                    ),
                ));
            }
        }
        let num_directions = l.directions.len() as u32;
        let needed_width = l
            .rows
            .iter()
            .map(|r| r.frames_per_direction * num_directions * l.cell_width)
            .max()
            .unwrap_or(0);
        let needed_height = l
            .rows
            .iter()
            .map(|r| (r.row + 1) * l.cell_height)
            .max()
            .unwrap_or(0);
        for &(width, height) in &l.accepted_sizes.value {
            if width < needed_width || height < needed_height {
                return Err(DefsError::new(
                    &l.path,
                    l.accepted_sizes.line,
                    l.accepted_sizes.col,
                    format!(
                        "appearance_layout '{}' declares accepted size {width}x{height}px but its own grid needs at least {needed_width}x{needed_height}px",
                        l.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// A `[[uniform]]` is a fixed, permanent override for one profession's
/// outfit and/or accessory layer -- never a pool, never re-derived.
/// Every reference is validated exactly like a `chain`'s profession
/// links: the profession must exist, the override must name something
/// real, and whatever it names must actually be reserved for role use
/// (`pool = "role_only"`) on the adult family -- never a civilian part
/// (which would make it indistinguishable from a
/// random roll) and never a costume (dead content with no role to wear
/// it).
fn check_uniforms(
    uniforms: &[UniformEntry],
    profession_keys: &BTreeSet<&str>,
    outfits: &[OutfitEntry],
    accessories: &[AccessoryEntry],
) -> Result<(), DefsError> {
    let mut seen_profession: HashMap<&str, &UniformEntry> = HashMap::new();
    for u in uniforms {
        if !profession_keys.contains(u.profession.value.as_str()) {
            return Err(DefsError::new(
                &u.path,
                u.profession.line,
                u.profession.col,
                format!(
                    "uniform '{}' names unknown profession '{}'",
                    u.key.value, u.profession.value
                ),
            ));
        }
        if let Some(prev) = seen_profession.get(u.profession.value.as_str()) {
            return Err(DefsError::new(
                &u.path,
                u.profession.line,
                u.profession.col,
                format!(
                    "uniform '{}' duplicates profession '{}' already covered by uniform '{}' -- exactly one uniform per profession",
                    u.key.value, u.profession.value, prev.key.value
                ),
            ));
        }
        seen_profession.insert(u.profession.value.as_str(), u);

        if u.outfit.is_none() && u.accessory.is_none() {
            return Err(DefsError::new(
                &u.path,
                u.key.line,
                u.key.col,
                format!(
                    "uniform '{}' overrides neither outfit nor accessory -- a uniform overriding nothing is meaningless",
                    u.key.value
                ),
            ));
        }

        if let Some(outfit_key) = &u.outfit {
            let found = outfits.iter().find(|o| &o.key.value == outfit_key);
            match found {
                None => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names unknown outfit '{outfit_key}'",
                            u.key.value
                        ),
                    ));
                }
                Some(o) if o.family.value != Family::Adult || o.pool.value != Pool::RoleOnly => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names outfit '{outfit_key}' which is not an adult role_only outfit",
                            u.key.value
                        ),
                    ));
                }
                Some(_) => {}
            }
        }

        if let Some(accessory_key) = &u.accessory {
            let found = accessories.iter().find(|a| &a.key.value == accessory_key);
            match found {
                None => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names unknown accessory '{accessory_key}'",
                            u.key.value
                        ),
                    ));
                }
                Some(a) if a.family.value != Family::Adult || a.pool.value != Pool::RoleOnly => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names accessory '{accessory_key}' which is not an adult role_only accessory",
                            u.key.value
                        ),
                    ));
                }
                Some(_) => {}
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
///
/// `sheet_dims` carries the `(width, height)` `fsio::read_png_dims` read
/// from every appearance part's own `sheet` file -- validation never
/// touches the filesystem itself (Quentin's direction), so a caller with
/// no appearance parts in its tree (every test fixture but story 1.10's
/// own) passes an empty map.
pub fn validate(
    raw: &RawDefs,
    sheet_dims: &BTreeMap<String, (u32, u32)>,
    layer_codes: &BTreeMap<String, u32>,
) -> Result<Defs, DefsError> {
    check_key_format(&raw.objects, "object")?;
    check_key_format(&raw.items, "item")?;
    check_key_format(&raw.recipes, "recipe")?;
    check_key_format(&raw.professions, "profession")?;
    check_key_format(&raw.chains, "chain")?;
    check_balance_key_format(&raw.balance)?;
    check_key_format(&raw.bodies, "body")?;
    check_key_format(&raw.eyes, "eyes")?;
    check_key_format(&raw.hairstyles, "hairstyle")?;
    check_key_format(&raw.outfits, "outfit")?;
    check_key_format(&raw.accessories, "accessory")?;
    check_key_format(&raw.appearance_layouts, "appearance_layout")?;
    check_key_format(&raw.uniforms, "uniform")?;

    check_id_key_dupes(&raw.objects, "object")?;
    check_id_key_dupes(&raw.items, "item")?;
    check_id_key_dupes(&raw.recipes, "recipe")?;
    check_id_key_dupes(&raw.professions, "profession")?;
    check_id_key_dupes(&raw.chains, "chain")?;
    check_balance_key_dupes(&raw.balance)?;
    check_id_key_dupes(&raw.bodies, "body")?;
    check_id_key_dupes(&raw.eyes, "eyes")?;
    check_id_key_dupes(&raw.hairstyles, "hairstyle")?;
    check_id_key_dupes(&raw.outfits, "outfit")?;
    check_id_key_dupes(&raw.accessories, "accessory")?;
    check_id_key_dupes(&raw.appearance_layouts, "appearance_layout")?;
    check_id_key_dupes(&raw.uniforms, "uniform")?;

    check_appearance_id_not_zero(&raw.bodies, "body")?;
    check_appearance_id_not_zero(&raw.eyes, "eyes")?;
    check_appearance_id_not_zero(&raw.hairstyles, "hairstyle")?;
    check_appearance_id_not_zero(&raw.outfits, "outfit")?;
    check_appearance_id_not_zero(&raw.accessories, "accessory")?;
    check_appearance_id_not_zero(&raw.appearance_layouts, "appearance_layout")?;
    check_appearance_id_not_zero(&raw.uniforms, "uniform")?;

    check_appearance_id_u16(&raw.bodies, "body")?;
    check_appearance_id_u16(&raw.eyes, "eyes")?;
    check_appearance_id_u16(&raw.hairstyles, "hairstyle")?;
    check_appearance_id_u16(&raw.outfits, "outfit")?;
    check_appearance_id_u16(&raw.accessories, "accessory")?;

    check_object_names(&raw.objects)?;
    check_object_layers(&raw.objects, layer_codes)?;
    check_object_footprint_cap(&raw.objects)?;
    check_object_colliders(&raw.objects)?;
    check_object_interact_at(&raw.objects)?;
    check_object_sprite_sheets(&raw.objects, sheet_dims)?;
    if !raw.objects.is_empty() {
        let tile_size_px = find_tile_size_px(&raw.balance).ok_or_else(|| {
            DefsError::new(
                &raw.objects[0].path,
                raw.objects[0].key.line,
                raw.objects[0].key.col,
                "defs/ declares an object but no 'render.tile_size_px' balance key -- FR126's sprite/footprint agreement cannot be checked without it".to_string(),
            )
        })?;
        check_object_sprite_matches_footprint(&raw.objects, tile_size_px)?;
    }

    let item_keys: BTreeSet<&str> = raw.items.iter().map(|i| i.key.value.as_str()).collect();
    check_recipe_item_refs(&raw.recipes, &item_keys)?;

    let profession_keys: BTreeSet<&str> = raw
        .professions
        .iter()
        .map(|p| p.key.value.as_str())
        .collect();
    check_chain_profession_refs(&raw.chains, &profession_keys)?;

    check_balance_range(&raw.balance)?;

    check_one_layout_per_family(&raw.appearance_layouts)?;
    for b in &raw.bodies {
        check_sheet_fits_layout(
            SheetCheck {
                path: &b.path,
                line: b.sheet.line,
                col: b.sheet.col,
                kind: "body",
                key: &b.key.value,
                family: b.family.value,
                sheet: &b.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
        )?;
    }
    for e in &raw.eyes {
        check_sheet_fits_layout(
            SheetCheck {
                path: &e.path,
                line: e.sheet.line,
                col: e.sheet.col,
                kind: "eyes",
                key: &e.key.value,
                family: e.family.value,
                sheet: &e.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
        )?;
    }
    for h in &raw.hairstyles {
        check_sheet_fits_layout(
            SheetCheck {
                path: &h.path,
                line: h.sheet.line,
                col: h.sheet.col,
                kind: "hairstyle",
                key: &h.key.value,
                family: h.family.value,
                sheet: &h.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
        )?;
    }
    for o in &raw.outfits {
        check_sheet_fits_layout(
            SheetCheck {
                path: &o.path,
                line: o.sheet.line,
                col: o.sheet.col,
                kind: "outfit",
                key: &o.key.value,
                family: o.family.value,
                sheet: &o.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
        )?;
    }
    for a in &raw.accessories {
        check_sheet_fits_layout(
            SheetCheck {
                path: &a.path,
                line: a.sheet.line,
                col: a.sheet.col,
                kind: "accessory",
                key: &a.key.value,
                family: a.family.value,
                sheet: &a.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
        )?;
    }
    check_uniforms(
        &raw.uniforms,
        &profession_keys,
        &raw.outfits,
        &raw.accessories,
    )?;

    let mut objects: Vec<ObjectDef> = raw
        .objects
        .iter()
        .map(|o| {
            // Already checked by `check_object_layers` above; `validate`
            // never partially resolves a tree it will go on to reject.
            let layer = resolve_object_layer(o, layer_codes).expect("layer already validated");
            ObjectDef {
                id: o.id.value,
                key: o.key.value.clone(),
                name: o.name.value.clone(),
                layer,
                sprite: SpriteRect {
                    sheet: o.sprite.value.sheet.clone(),
                    x: o.sprite.value.x,
                    y: o.sprite.value.y,
                    w: o.sprite.value.w,
                    h: o.sprite.value.h,
                },
                width: o.width,
                height: o.height,
                collider: o.collider.as_ref().map(|c| ColliderRect {
                    x0: c.value.x0,
                    y0: c.value.y0,
                    x1: c.value.x1,
                    y1: c.value.y1,
                }),
                interact_at: o.interact_at.as_ref().map(|c| ColliderRect {
                    x0: c.value.x0,
                    y0: c.value.y0,
                    x1: c.value.x1,
                    y1: c.value.y1,
                }),
                window: o.window,
            }
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

    let mut bodies: Vec<BodyDef> = raw
        .bodies
        .iter()
        .map(|b| BodyDef {
            id: b.id.value as u16,
            key: b.key.value.clone(),
            family: b.family.value,
            sheet: b.sheet.value.clone(),
            pool: b.pool.value,
        })
        .collect();
    bodies.sort_by(|a, b| a.key.cmp(&b.key));

    let mut eyes: Vec<EyesDef> = raw
        .eyes
        .iter()
        .map(|e| EyesDef {
            id: e.id.value as u16,
            key: e.key.value.clone(),
            family: e.family.value,
            sheet: e.sheet.value.clone(),
            pool: e.pool.value,
        })
        .collect();
    eyes.sort_by(|a, b| a.key.cmp(&b.key));

    let mut hairstyles: Vec<HairstyleDef> = raw
        .hairstyles
        .iter()
        .map(|h| HairstyleDef {
            id: h.id.value as u16,
            key: h.key.value.clone(),
            family: h.family.value,
            sheet: h.sheet.value.clone(),
            style: h.style,
            color: h.color,
            rare: h.rare,
        })
        .collect();
    hairstyles.sort_by(|a, b| a.key.cmp(&b.key));

    let mut outfits: Vec<OutfitDef> = raw
        .outfits
        .iter()
        .map(|o| OutfitDef {
            id: o.id.value as u16,
            key: o.key.value.clone(),
            family: o.family.value,
            sheet: o.sheet.value.clone(),
            pool: o.pool.value,
            hides_hairstyle: o.hides_hairstyle,
        })
        .collect();
    outfits.sort_by(|a, b| a.key.cmp(&b.key));

    let mut accessories: Vec<AccessoryDef> = raw
        .accessories
        .iter()
        .map(|a| AccessoryDef {
            id: a.id.value as u16,
            key: a.key.value.clone(),
            family: a.family.value,
            sheet: a.sheet.value.clone(),
            pool: a.pool.value,
            slot: a.slot.value,
        })
        .collect();
    accessories.sort_by(|a, b| a.key.cmp(&b.key));

    let mut appearance_layouts: Vec<AppearanceLayoutDef> = raw
        .appearance_layouts
        .iter()
        .map(|l| AppearanceLayoutDef {
            id: l.id.value,
            key: l.key.value.clone(),
            family: l.family.value,
            cell_width: l.cell_width,
            cell_height: l.cell_height,
            directions: l.directions.clone(),
            rows: l
                .rows
                .iter()
                .map(|r| AppearanceLayoutRowDef {
                    animation: r.animation.clone(),
                    row: r.row,
                    frames_per_direction: r.frames_per_direction,
                })
                .collect(),
            accepted_sizes: l.accepted_sizes.value.clone(),
        })
        .collect();
    appearance_layouts.sort_by(|a, b| a.key.cmp(&b.key));

    let mut uniforms: Vec<UniformDef> = raw
        .uniforms
        .iter()
        .map(|u| UniformDef {
            id: u.id.value,
            key: u.key.value.clone(),
            profession: u.profession.value.clone(),
            outfit: u.outfit.clone(),
            accessory: u.accessory.clone(),
        })
        .collect();
    uniforms.sort_by(|a, b| a.key.cmp(&b.key));

    Ok(Defs {
        objects,
        items,
        recipes,
        professions,
        chains,
        balance,
        bodies,
        eyes,
        hairstyles,
        outfits,
        accessories,
        appearance_layouts,
        uniforms,
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

    /// `name`/`layer`/`sprite` boilerplate for a 1x1 object whose sprite is
    /// exactly one tile (16x16) -- appended to every object fixture below
    /// that is not itself exercising name/layer/sprite validation, so the
    /// pre-existing collider/interact_at tests stay focused on the one
    /// thing each already asserts.
    const OBJECT_HEADER: &str = "name = \"Trash Bin\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\n";

    const BALANCE_RENDER_TOML: &str =
        "[[balance]]\nkey = \"render.tile_size_px\"\nvalue = 16\nmin = 1\nmax = 64\n";

    fn object_sheet_dims() -> BTreeMap<String, (u32, u32)> {
        [("fixtures/objects/test.png".to_string(), (16u32, 16u32))]
            .into_iter()
            .collect()
    }

    fn object_layer_codes() -> BTreeMap<String, u32> {
        [
            ("furniture".to_string(), 2u32),
            ("objects".to_string(), 3u32),
            ("walls".to_string(), 4u32),
        ]
        .into_iter()
        .collect()
    }

    fn valid_tree() -> Vec<(PathBuf, String)> {
        files(&[
            (
                "defs/objects/city-props.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"trash_bin\"\n{OBJECT_HEADER}width = 1\nheight = 1\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
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
        let defs = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap();
        assert_eq!(defs.objects[0].key, "trash_bin");
        assert_eq!(defs.objects[0].name, "Trash Bin");
        assert_eq!(defs.objects[0].layer, 2);
        assert_eq!(defs.objects[0].sprite.sheet, "fixtures/objects/test.png");
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
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("invalid item key 'trash-bin'"));
    }

    #[test]
    fn a_balance_key_with_a_kebab_case_segment_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"citizen.bar-decay.rest\"\nvalue = 1\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
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
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("duplicate item id 1"));
    }

    #[test]
    fn duplicate_id_across_two_files_in_the_same_subdirectory_is_rejected() {
        let f = files(&[
            ("defs/items/a.toml", "[[item]]\nid = 1\nkey = \"a\"\n"),
            ("defs/items/b.toml", "[[item]]\nid = 1\nkey = \"b\"\n"),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
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
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("duplicate item key 'a'"));
    }

    #[test]
    fn duplicate_balance_key_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 1\nmin = 0\nmax = 10\n\n[[balance]]\nkey = \"a\"\nvalue = 2\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("duplicate balance key 'a'"));
    }

    #[test]
    fn a_recipe_naming_an_unknown_item_is_rejected() {
        let f = files(&[(
            "defs/recipes/x.toml",
            "[[recipe]]\nid = 1\nkey = \"r\"\ninputs = [\"nope\"]\noutputs = []\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("unknown item 'nope'"));
    }

    #[test]
    fn a_chain_naming_an_unknown_profession_is_rejected() {
        let f = files(&[(
            "defs/chains/x.toml",
            "[[chain]]\nid = 1\nkey = \"c\"\nlinks = [\"nope\"]\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("unknown profession 'nope'"));
    }

    #[test]
    fn an_out_of_range_balance_value_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 999\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("out of its own declared range"));
    }

    #[test]
    fn a_zero_area_collider_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 5, y0 = 5, x1 = 5, y1 = 9 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("zero or negative area"));
    }

    #[test]
    fn a_collider_outside_the_footprint_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 20, y1 = 8 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("does not fit inside its footprint"));
    }

    #[test]
    fn a_collider_flush_with_the_footprint_edge_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 16, y1 = 16 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap();
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
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!("[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\n"),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap();
        assert_eq!(defs.objects[0].collider, None);
    }

    #[test]
    fn a_zero_area_interact_at_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ninteract_at = {{ x0 = 0, y0 = 16, x1 = 0, y1 = 32 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("zero or negative area"));
        assert!(err.message.contains("interact_at"));
    }

    #[test]
    fn an_interact_at_beyond_the_reach_bound_is_rejected() {
        // The bound is INTERACT_AT_MAX_REACH_CELLS cells beyond the
        // footprint on every side; one sub-cell further out is refused.
        let beyond = -(INTERACT_AT_MAX_REACH_CELLS * COLLIDER_SUBCELLS_PER_CELL) - 1;
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ninteract_at = {{ x0 = {beyond}, y0 = 0, x1 = 16, y1 = 16 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("reaches further than"));
    }

    #[test]
    fn an_interact_at_exactly_at_the_reach_bound_is_accepted() {
        let at = -(INTERACT_AT_MAX_REACH_CELLS * COLLIDER_SUBCELLS_PER_CELL);
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ninteract_at = {{ x0 = {at}, y0 = 0, x1 = 16, y1 = 16 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap();
        assert_eq!(defs.objects[0].interact_at.unwrap().x0, at as i32);
    }

    #[test]
    fn an_interact_at_entirely_inside_the_objects_own_collider_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 16, y1 = 16 }}\ninteract_at = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("could never be reached"));
    }

    #[test]
    fn an_interact_at_reaching_outside_its_own_collider_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\ninteract_at = {{ x0 = 0, y0 = 16, x1 = 16, y1 = 32 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw, &object_sheet_dims(), &object_layer_codes()).is_ok());
    }

    #[test]
    fn an_absent_interact_at_stays_none() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!("[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\n"),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap();
        assert_eq!(defs.objects[0].interact_at, None);
    }

    #[test]
    fn an_object_with_an_empty_name_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("empty name"));
    }

    #[test]
    fn an_object_naming_an_unknown_layer_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"basement\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("unknown layer 'basement'"));
    }

    #[test]
    fn an_object_naming_a_deprecated_layer_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"overhead\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut codes = object_layer_codes();
        codes.insert("overhead".to_string(), 1);
        let err = validate(&raw, &object_sheet_dims(), &codes).unwrap_err();
        assert!(err.message.contains("deprecated layer"));
    }

    #[test]
    fn an_object_naming_a_sheet_never_read_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!("[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\n"),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("dimensions were never read"));
    }

    #[test]
    fn a_sprite_rect_outside_its_sheet_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 4, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("does not fit inside sheet"));
    }

    #[test]
    fn a_sprite_width_not_matching_the_footprint_width_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 2\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("does not equal its footprint width"));
    }

    #[test]
    fn a_sprite_height_not_a_whole_multiple_of_tile_size_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 20 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (16, 20));
        let err = validate(&raw, &dims, &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("whole multiple of tile_size_px"));
    }

    #[test]
    fn a_sprite_height_shorter_than_the_footprint_height_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 2\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("shorter than its footprint height"));
    }

    #[test]
    fn a_sprite_taller_than_the_footprint_overhanging_upward_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 32 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (16, 32));
        assert!(validate(&raw, &dims, &object_layer_codes()).is_ok());
    }

    #[test]
    fn a_footprint_width_of_zero_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 0\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_layer_codes()).unwrap_err();
        assert!(err.message.contains("footprint width or height of 0"));
    }

    #[test]
    fn a_footprint_of_exactly_the_cap_on_both_axes_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 128, h = 128 }\nwidth = 8\nheight = 8\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (128, 128));
        assert!(validate(&raw, &dims, &object_layer_codes()).is_ok());
    }

    #[test]
    fn a_footprint_one_wider_than_the_cap_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 144, h = 16 }\nwidth = 9\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (144, 16));
        let err = validate(&raw, &dims, &object_layer_codes()).unwrap_err();
        assert!(
            err.message
                .contains("footprint width 9 exceeds MAX_FOOTPRINT_CELLS (8)")
        );
        assert!(
            err.message
                .contains("compose the structure from multiple objects")
        );
    }

    #[test]
    fn a_footprint_one_taller_than_the_cap_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 144 }\nwidth = 1\nheight = 9\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (16, 144));
        let err = validate(&raw, &dims, &object_layer_codes()).unwrap_err();
        assert!(
            err.message
                .contains("footprint height 9 exceeds MAX_FOOTPRINT_CELLS (8)")
        );
    }

    #[test]
    fn a_footprint_exceeding_the_cap_on_both_axes_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 144, h = 144 }\nwidth = 9\nheight = 9\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (144, 144));
        let err = validate(&raw, &dims, &object_layer_codes()).unwrap_err();
        assert!(
            err.message
                .contains("footprint width 9 exceeds MAX_FOOTPRINT_CELLS (8)")
        );
    }

    #[test]
    fn an_in_range_balance_value_at_the_boundary_is_accepted() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 10\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw, &BTreeMap::new(), &BTreeMap::new()).is_ok());
    }

    // --- Story 1.10: appearance --------------------------------------------

    const LAYOUT_TOML: &str = "[[appearance_layout]]\nid = 1\nkey = \"adult\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"right\", \"up\", \"left\", \"down\"]\nrows = [\n  { animation = \"idle\", row = 1, frames_per_direction = 6 },\n  { animation = \"walk\", row = 2, frames_per_direction = 6 },\n]\naccepted_sizes = [{ width = 896, height = 656 }]\n";

    fn appearance_sheet_dims() -> BTreeMap<String, (u32, u32)> {
        [("sheets/body.png".to_string(), (896, 656))]
            .into_iter()
            .collect()
    }

    #[test]
    fn a_body_fitting_its_familys_layout_is_accepted() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap();
        assert_eq!(defs.bodies[0].key, "body_01");
    }

    #[test]
    fn a_sheet_too_small_for_its_familys_layout_is_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut small_dims = BTreeMap::new();
        small_dims.insert("sheets/body.png".to_string(), (32, 32));
        let err = validate(&raw, &small_dims, &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("only accepts"));
    }

    #[test]
    fn a_sheet_bigger_than_the_grid_but_not_a_declared_size_is_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut bigger_dims = BTreeMap::new();
        // Bigger than the grid on every axis, but not one of LAYOUT_TOML's
        // declared accepted_sizes -- must still be rejected by name, not
        // waved through for being "big enough".
        bigger_dims.insert("sheets/body.png".to_string(), (960, 700));
        let err = validate(&raw, &bigger_dims, &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("only accepts"));
        assert!(err.message.contains("960x700"));
    }

    #[test]
    fn a_part_naming_a_family_with_no_layout_is_rejected() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("no [[appearance_layout]] entry"));
    }

    #[test]
    fn a_declared_id_above_u16_max_is_rejected() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 65536\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("does not fit in a u16"));
    }

    #[test]
    fn a_declared_id_at_exactly_u16_max_is_accepted() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 65535\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap();
        assert_eq!(defs.bodies[0].id, 65535);
    }

    #[test]
    fn a_declared_id_of_zero_is_rejected_for_every_appearance_kind() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 0\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("declares id 0"));
    }

    #[test]
    fn two_layouts_for_the_same_family_are_rejected() {
        let f = files(&[(
            "defs/appearance/layouts.toml",
            "[[appearance_layout]]\nid = 1\nkey = \"a\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"down\"]\nrows = [{ animation = \"idle\", row = 0, frames_per_direction = 1 }]\naccepted_sizes = [{ width = 16, height = 32 }]\n\n[[appearance_layout]]\nid = 2\nkey = \"b\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"down\"]\nrows = [{ animation = \"idle\", row = 0, frames_per_direction = 1 }]\naccepted_sizes = [{ width = 16, height = 32 }]\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("exactly one layout per family"));
    }

    fn appearance_and_profession_tree(uniform_toml: &str) -> Vec<(PathBuf, String)> {
        files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/appearance/accessories.toml",
                "[[accessory]]\nid = 1\nkey = \"jacket\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"role_only\"\nslot = \"torso\"\n",
            ),
            ("defs/appearance/uniforms.toml", uniform_toml),
        ])
    }

    #[test]
    fn a_uniform_naming_a_real_profession_and_role_only_accessory_is_accepted() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"sanitation_worker_uniform\"\nprofession = \"sanitation_worker\"\naccessory = \"jacket\"\n",
        );
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).is_ok());
    }

    #[test]
    fn a_uniform_naming_an_unknown_profession_is_rejected() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"no_such_profession\"\naccessory = \"jacket\"\n",
        );
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("names unknown profession"));
    }

    #[test]
    fn a_uniform_naming_an_unknown_accessory_is_rejected() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"sanitation_worker\"\naccessory = \"no_such_accessory\"\n",
        );
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("names unknown accessory"));
    }

    #[test]
    fn a_uniform_naming_a_civilian_pool_accessory_is_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/appearance/accessories.toml",
                "[[accessory]]\nid = 1\nkey = \"backpack\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\nslot = \"back\"\n",
            ),
            (
                "defs/appearance/uniforms.toml",
                "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"sanitation_worker\"\naccessory = \"backpack\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("not an adult role_only accessory"));
    }

    #[test]
    fn a_uniform_overriding_neither_outfit_nor_accessory_is_rejected() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"sanitation_worker\"\n",
        );
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("overrides neither"));
    }

    #[test]
    fn two_uniforms_for_the_same_profession_are_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/appearance/accessories.toml",
                "[[accessory]]\nid = 1\nkey = \"jacket\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"role_only\"\nslot = \"torso\"\n\n[[accessory]]\nid = 2\nkey = \"helmet\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"role_only\"\nslot = \"head\"\n",
            ),
            (
                "defs/appearance/uniforms.toml",
                "[[uniform]]\nid = 1\nkey = \"a\"\nprofession = \"sanitation_worker\"\naccessory = \"jacket\"\n\n[[uniform]]\nid = 2\nkey = \"b\"\nprofession = \"sanitation_worker\"\naccessory = \"helmet\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &BTreeMap::new()).unwrap_err();
        assert!(err.message.contains("exactly one uniform per profession"));
    }

    #[test]
    fn an_invalid_pool_value_is_rejected_at_parse_time() {
        let f = files(&[(
            "defs/appearance/accessories.toml",
            "[[accessory]]\nid = 1\nkey = \"a\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"bogus\"\nslot = \"head\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("bogus"));
    }

    #[test]
    fn an_invalid_slot_value_is_rejected_at_parse_time() {
        let f = files(&[(
            "defs/appearance/accessories.toml",
            "[[accessory]]\nid = 1\nkey = \"a\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\nslot = \"waist\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("waist"));
    }

    #[test]
    fn an_invalid_family_value_is_rejected_at_parse_time() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 1\nkey = \"a\"\nfamily = \"teen\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("teen"));
    }
}
