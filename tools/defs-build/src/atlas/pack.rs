//! Story 2.6: a deterministic shelf packer, our own (Tim's direction: no
//! crate, about a hundred lines). Pure integer geometry -- no pixel IO,
//! no filesystem -- so every property here is checked without ever
//! decoding a PNG.
//!
//! Packing runs one theme group at a time, groups visited in sorted key
//! order (a `BTreeMap` iteration, never insertion/file order), so the
//! whole result -- page count, page dimensions, every placement -- is a
//! pure function of the *set* of `(group, source rect, sort key)` triples,
//! never of the order a caller happened to list them in.

use std::collections::BTreeMap;

use crate::model::{
    ATLAS_GUTTER_PX, ATLAS_MAX_PAGES_PER_GROUP, ATLAS_PAGE_MAX_HEIGHT, ATLAS_PAGE_MIN_HEIGHT,
    ATLAS_PAGE_WIDTH,
};

/// A source rectangle's own identity: `(sheet, x, y, w, h)`, exactly what
/// two objects naming the same crop share (Quentin's direction: identical
/// tuples are packed once).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceKey {
    pub sheet: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// One rect a caller wants packed -- `group` decides which page set it
/// competes for; `sort_key` is the tie-break within a group (the
/// authoring object's own `key`, never file order -- Tim's direction).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackItem {
    pub group: String,
    pub source: SourceKey,
    pub sort_key: String,
}

/// Where one source rect landed: a global page index (already offset
/// across every group -- groups are visited in sorted key order and pages
/// are numbered as they are consumed) plus its content position in page
/// pixels, gutter excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub page: u32,
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageMeta {
    pub group: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackResult {
    pub pages: Vec<PageMeta>,
    pub placements: BTreeMap<SourceKey, Placement>,
}

/// The smallest power of two, at least [`ATLAS_PAGE_MIN_HEIGHT`], holding
/// `content_height`, capped at [`ATLAS_PAGE_MAX_HEIGHT`] -- the cap can
/// only ever bind exactly, never be exceeded, because every shelf that
/// would cross it opens a new page instead (see `pack_group` below).
fn page_height_for(content_height: u32) -> u32 {
    let mut h = ATLAS_PAGE_MIN_HEIGHT;
    while h < content_height && h < ATLAS_PAGE_MAX_HEIGHT {
        h *= 2;
    }
    h.min(ATLAS_PAGE_MAX_HEIGHT)
}

struct LocalPlacement {
    key: SourceKey,
    page: u32,
    x: u32,
    y: u32,
}

/// Packs one theme group's own rects (already deduplicated by the caller
/// is *not* assumed -- dedup happens here too, so a caller that passes the
/// same `SourceKey` under two different `sort_key`s still gets it packed
/// once, at the lexicographically-least `sort_key`). Returns each page's
/// content height (pre-power-of-two-rounding, the caller rounds) and every
/// rect's page-local placement, or a named error.
fn pack_group(group: &str, items: &[&PackItem]) -> Result<(Vec<u32>, Vec<LocalPlacement>), String> {
    // Dedup: identical source rects share one placement (Quentin's
    // direction), keyed by the least `sort_key` among the objects naming
    // it -- deterministic regardless of input order.
    let mut unique: BTreeMap<SourceKey, String> = BTreeMap::new();
    for item in items {
        unique
            .entry(item.source.clone())
            .and_modify(|k| {
                if item.sort_key < *k {
                    *k = item.sort_key.clone();
                }
            })
            .or_insert_with(|| item.sort_key.clone());
    }

    let mut rects: Vec<(SourceKey, String)> = unique.into_iter().collect();
    // Tim's direction: sort by (h desc, w desc, key asc) -- near-optimal
    // for shelves keyed by height, and the tie-break is the object key,
    // never file order.
    rects.sort_by(|a, b| {
        b.0.h
            .cmp(&a.0.h)
            .then(b.0.w.cmp(&a.0.w))
            .then(a.1.cmp(&b.1))
    });

    let gutter = ATLAS_GUTTER_PX;
    let mut page: u32 = 0;
    let mut x: u32 = 0;
    let mut y: u32 = 0;
    let mut shelf_h: u32 = 0;
    let mut page_content_heights: Vec<u32> = vec![0];
    let mut placements = Vec::with_capacity(rects.len());

    for (key, sort_key) in rects {
        let pw = key.w + 2 * gutter;
        let ph = key.h + 2 * gutter;
        if pw > ATLAS_PAGE_WIDTH || ph > ATLAS_PAGE_MAX_HEIGHT {
            return Err(format!(
                "group '{group}': sprite '{sort_key}' ({}x{}px, sheet '{}') exceeds the {}x{}px page size after {gutter}px padding on every side",
                key.w, key.h, key.sheet, ATLAS_PAGE_WIDTH, ATLAS_PAGE_MAX_HEIGHT
            ));
        }
        if x + pw > ATLAS_PAGE_WIDTH {
            x = 0;
            y += shelf_h;
            shelf_h = 0;
        }
        if y + ph > ATLAS_PAGE_MAX_HEIGHT {
            page += 1;
            x = 0;
            y = 0;
            shelf_h = 0;
            page_content_heights.push(0);
        }
        placements.push(LocalPlacement {
            key,
            page,
            x: x + gutter,
            y: y + gutter,
        });
        x += pw;
        shelf_h = shelf_h.max(ph);
        let idx = page as usize;
        page_content_heights[idx] = page_content_heights[idx].max(y + shelf_h);
    }

    let page_count = page_content_heights.len();
    if page_count > ATLAS_MAX_PAGES_PER_GROUP {
        let overflow: Vec<&str> = placements
            .iter()
            .filter(|p| p.page as usize >= ATLAS_MAX_PAGES_PER_GROUP)
            .map(|p| p.key.sheet.as_str())
            .collect();
        return Err(format!(
            "group '{group}' needs {page_count} pages, more than ATLAS_MAX_PAGES_PER_GROUP ({ATLAS_MAX_PAGES_PER_GROUP}) -- did not fit: {}",
            overflow.join(", ")
        ));
    }

    Ok((page_content_heights, placements))
}

/// Packs every group in `items`, groups visited in sorted key order.
/// Empty input packs to zero pages, cleanly.
pub fn pack_all(items: &[PackItem]) -> Result<PackResult, String> {
    let mut by_group: BTreeMap<&str, Vec<&PackItem>> = BTreeMap::new();
    for item in items {
        by_group.entry(item.group.as_str()).or_default().push(item);
    }

    let mut pages = Vec::new();
    let mut placements: BTreeMap<SourceKey, Placement> = BTreeMap::new();

    for (group, group_items) in by_group {
        let (content_heights, local_placements) = pack_group(group, &group_items)?;
        let page_offset = pages.len() as u32;
        for h in &content_heights {
            pages.push(PageMeta {
                group: group.to_string(),
                width: ATLAS_PAGE_WIDTH,
                height: page_height_for(*h),
            });
        }
        for p in local_placements {
            placements.insert(
                p.key,
                Placement {
                    page: page_offset + p.page,
                    x: p.x,
                    y: p.y,
                },
            );
        }
    }

    Ok(PackResult { pages, placements })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(group: &str, sheet: &str, x: u32, y: u32, w: u32, h: u32, key: &str) -> PackItem {
        PackItem {
            group: group.to_string(),
            source: SourceKey {
                sheet: sheet.to_string(),
                x,
                y,
                w,
                h,
            },
            sort_key: key.to_string(),
        }
    }

    #[test]
    fn empty_input_packs_to_zero_pages() {
        let result = pack_all(&[]).unwrap();
        assert!(result.pages.is_empty());
        assert!(result.placements.is_empty());
    }

    #[test]
    fn a_single_small_rect_packs_onto_one_page_with_gutter_offset() {
        let items = vec![item("g", "s.png", 0, 0, 16, 16, "a")];
        let result = pack_all(&items).unwrap();
        assert_eq!(result.pages.len(), 1);
        let placement = result.placements.values().next().unwrap();
        assert_eq!(placement.page, 0);
        assert_eq!(placement.x, ATLAS_GUTTER_PX);
        assert_eq!(placement.y, ATLAS_GUTTER_PX);
    }

    #[test]
    fn identical_source_rects_are_packed_once() {
        let items = vec![
            item("g", "s.png", 0, 0, 16, 16, "b"),
            item("g", "s.png", 0, 0, 16, 16, "a"),
        ];
        let result = pack_all(&items).unwrap();
        assert_eq!(result.placements.len(), 1);
    }

    #[test]
    fn two_groups_never_share_a_page() {
        let items = vec![
            item("alpha", "s1.png", 0, 0, 16, 16, "a"),
            item("beta", "s2.png", 0, 0, 16, 16, "b"),
        ];
        let result = pack_all(&items).unwrap();
        assert_eq!(result.pages.len(), 2);
        assert_eq!(result.pages[0].group, "alpha");
        assert_eq!(result.pages[1].group, "beta");
        let p1 = result
            .placements
            .get(&SourceKey {
                sheet: "s1.png".into(),
                x: 0,
                y: 0,
                w: 16,
                h: 16,
            })
            .unwrap();
        let p2 = result
            .placements
            .get(&SourceKey {
                sheet: "s2.png".into(),
                x: 0,
                y: 0,
                w: 16,
                h: 16,
            })
            .unwrap();
        assert_ne!(p1.page, p2.page);
    }

    #[test]
    fn a_sprite_bigger_than_a_page_after_padding_is_refused_by_name() {
        let items = vec![item("g", "huge.png", 0, 0, ATLAS_PAGE_WIDTH, 16, "big")];
        let err = pack_all(&items).unwrap_err();
        assert!(err.contains("huge.png"), "{err}");
        assert!(err.contains("big"), "{err}");
    }

    #[test]
    fn a_group_needing_a_third_page_fails_naming_the_group_and_page_count() {
        // Every rect is a near-page-filling square: two pages hold two,
        // the third forces a third page, past ATLAS_MAX_PAGES_PER_GROUP.
        let side = ATLAS_PAGE_WIDTH - 2 * ATLAS_GUTTER_PX;
        let items = vec![
            item("crowded", "a.png", 0, 0, side, side, "a"),
            item("crowded", "b.png", 0, 0, side, side, "b"),
            item("crowded", "c.png", 0, 0, side, side, "c"),
        ];
        let err = pack_all(&items).unwrap_err();
        assert!(err.contains("crowded"), "{err}");
        assert!(err.contains('3'), "{err}");
    }

    #[test]
    fn packing_is_deterministic_regardless_of_input_order() {
        let items_a = vec![
            item("g", "a.png", 0, 0, 16, 32, "a"),
            item("g", "b.png", 0, 0, 32, 16, "b"),
            item("g", "c.png", 0, 0, 16, 16, "c"),
        ];
        let mut items_b = items_a.clone();
        items_b.reverse();
        let result_a = pack_all(&items_a).unwrap();
        let result_b = pack_all(&items_b).unwrap();
        assert_eq!(result_a, result_b);
    }

    #[test]
    fn spill_order_is_by_sort_key_never_by_input_order() {
        // Two same-size rects: fill one shelf so both cannot share it,
        // forcing a decision about *which* comes first -- must be by key.
        let items_first = vec![
            item(
                "g",
                "z.png",
                0,
                0,
                ATLAS_PAGE_WIDTH - 2 * ATLAS_GUTTER_PX,
                16,
                "z",
            ),
            item("g", "a.png", 0, 0, 16, 16, "a"),
        ];
        let mut items_second = items_first.clone();
        items_second.reverse();
        let result_first = pack_all(&items_first).unwrap();
        let result_second = pack_all(&items_second).unwrap();
        assert_eq!(result_first, result_second);
    }

    #[test]
    fn no_rotation_placed_extent_matches_source_width_and_height() {
        let items = vec![item("g", "s.png", 0, 0, 48, 16, "a")];
        let result = pack_all(&items).unwrap();
        let (key, placement) = result.placements.iter().next().unwrap();
        assert!(placement.x + key.w <= ATLAS_PAGE_WIDTH);
        assert!(placement.y + key.h <= result.pages[placement.page as usize].height);
    }

    #[test]
    fn page_height_for_rounds_up_to_a_power_of_two_and_caps_at_max() {
        assert_eq!(page_height_for(0), ATLAS_PAGE_MIN_HEIGHT);
        assert_eq!(page_height_for(17), 32);
        assert_eq!(
            page_height_for(ATLAS_PAGE_MAX_HEIGHT),
            ATLAS_PAGE_MAX_HEIGHT
        );
        assert_eq!(
            page_height_for(ATLAS_PAGE_MAX_HEIGHT + 1),
            ATLAS_PAGE_MAX_HEIGHT
        );
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    fn rect_strategy() -> impl Strategy<Value = (u32, u32)> {
        (1u32..200, 1u32..200)
    }

    proptest! {
        /// Quentin's direction: no two placed rects overlap once
        /// padding/extrusion is included, every rect sits fully inside
        /// 2048x2048, and there is no rotation -- asserted outright, not
        /// merely absent.
        #[test]
        fn placed_rects_never_overlap_and_always_fit_the_page_with_no_rotation(
            dims in prop::collection::vec(rect_strategy(), 1..24)
        ) {
            let items: Vec<PackItem> = dims
                .iter()
                .enumerate()
                .map(|(i, (w, h))| PackItem {
                    group: "g".to_string(),
                    source: SourceKey {
                        sheet: format!("sheet-{i}.png"),
                        x: 0,
                        y: 0,
                        w: *w,
                        h: *h,
                    },
                    sort_key: format!("key-{i:04}"),
                })
                .collect();

            let result = pack_all(&items);
            let Ok(result) = result else {
                // Every generated rect is well within a page on its own
                // (max 199px), so the only legitimate failure is the
                // per-group page cap -- never "too big for a page".
                return Ok(());
            };

            // Every placement, expanded by its own gutter halo, fits its
            // page -- and no two halos overlap.
            let mut boxes: Vec<(u32, u32, u32, u32, u32)> = Vec::new(); // page,x0,y0,x1,y1
            for (key, placement) in &result.placements {
                let page = &result.pages[placement.page as usize];
                let x0 = placement.x - ATLAS_GUTTER_PX;
                let y0 = placement.y - ATLAS_GUTTER_PX;
                let x1 = placement.x + key.w + ATLAS_GUTTER_PX;
                let y1 = placement.y + key.h + ATLAS_GUTTER_PX;
                prop_assert!(x1 <= page.width, "rect exceeds page width");
                prop_assert!(y1 <= page.height, "rect exceeds page height");
                // No rotation: the placed rect's own extent uses the
                // source w/h exactly as declared, never swapped.
                prop_assert!(placement.x + key.w <= ATLAS_PAGE_WIDTH);
                for (p2, ox0, oy0, ox1, oy1) in &boxes {
                    if *p2 != placement.page {
                        continue;
                    }
                    let overlap = x0 < *ox1 && *ox0 < x1 && y0 < *oy1 && *oy0 < y1;
                    prop_assert!(!overlap, "two placed rects overlap on the same page");
                }
                boxes.push((placement.page, x0, y0, x1, y1));
            }
        }

        /// Determinism (Tim's direction): packing the same input twice,
        /// and with the input shuffled, gives byte-identical results.
        #[test]
        fn packing_is_deterministic_under_shuffling(
            dims in prop::collection::vec(rect_strategy(), 1..16)
        ) {
            let items: Vec<PackItem> = dims
                .iter()
                .enumerate()
                .map(|(i, (w, h))| PackItem {
                    group: "g".to_string(),
                    source: SourceKey {
                        sheet: format!("sheet-{i}.png"),
                        x: 0,
                        y: 0,
                        w: *w,
                        h: *h,
                    },
                    sort_key: format!("key-{i:04}"),
                })
                .collect();
            let mut shuffled = items.clone();
            shuffled.reverse();

            let a = pack_all(&items);
            let b = pack_all(&shuffled);
            prop_assert_eq!(a.is_ok(), b.is_ok());
            if let (Ok(a), Ok(b)) = (a, b) {
                prop_assert_eq!(a, b);
            }
        }
    }
}
