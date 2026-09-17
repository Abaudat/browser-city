//! Story 2.6: the atlas packer. `theme` derives a page's group from a
//! `sprite.sheet` path; `pack` is the pure shelf-packing geometry; `image`
//! is RGBA8 pixel IO/compositing (the crate's only `png` dependency);
//! `build` orchestrates all three into packed pages plus every object's
//! own [`crate::model::AtlasRect`]. Story 2.7: `character` builds every
//! character part's own compact strip and hands it to the same `pack`/
//! `image` pipeline, via `build`.

pub mod build;
pub mod character;
pub mod image;
pub mod pack;
pub mod theme;
