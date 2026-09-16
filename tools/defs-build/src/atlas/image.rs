//! Story 2.6: RGBA8 pixel IO and compositing -- the only place this crate
//! touches the `png` crate (Tim's direction: pinned exact, new dependency,
//! impact analysed in his own PR comment). Every function here is pure
//! over already-in-memory bytes/buffers; no filesystem access, no `fsio`
//! call -- that stays the binary's own edge.

use crate::model::ATLAS_GUTTER_PX;

/// Decodes `bytes` (a whole PNG file) to `(width, height, rgba8)`,
/// `rgba8.len() == width * height * 4`. Every source is normalised to
/// straight (non-premultiplied), 8-bit-per-channel RGBA regardless of its
/// own color type or bit depth (Artie's direction: no retouching, no
/// premultiplied-alpha damage) -- `EXPAND`+`STRIP_16` get every input to
/// 8-bit grayscale/RGB/indexed-expanded-to-RGB(A) first; whatever channel
/// count remains is widened to RGBA here.
pub fn decode_rgba8(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("failed to read PNG header: {e}"))?;
    let mut buf = vec![
        0u8;
        reader
            .output_buffer_size()
            .ok_or_else(|| "PNG has no readable frame".to_string())?
    ];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("failed to decode PNG frame: {e}"))?;
    let width = info.width;
    let height = info.height;
    let pixels = &buf[..info.buffer_size()];

    let rgba = match info.color_type {
        png::ColorType::Rgba => pixels.to_vec(),
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity(pixels.len() / 3 * 4);
            let (chunks, _) = pixels.as_chunks::<3>();
            for px in chunks {
                out.extend_from_slice(px);
                out.push(255);
            }
            out
        }
        png::ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity(pixels.len() / 2 * 4);
            let (chunks, _) = pixels.as_chunks::<2>();
            for px in chunks {
                out.extend_from_slice(&[px[0], px[0], px[0], px[1]]);
            }
            out
        }
        png::ColorType::Grayscale => {
            let mut out = Vec::with_capacity(pixels.len() * 4);
            for px in pixels {
                out.extend_from_slice(&[*px, *px, *px, 255]);
            }
            out
        }
        png::ColorType::Indexed => {
            return Err("indexed PNG survived EXPAND -- this should never happen".to_string());
        }
    };
    Ok((width, height, rgba))
}

/// Encodes an RGBA8 buffer as a PNG, deterministically: non-interlaced,
/// one fixed compression level, one fixed filter, no metadata chunk ever
/// added (Tim's direction) -- the bytes are a pure function of the pixels
/// and the pinned crate version, nothing else.
pub fn encode_rgba8(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::High);
        encoder.set_filter(png::Filter::Paeth);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("failed to write PNG header: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("failed to write PNG image data: {e}"))?;
    }
    Ok(out)
}

/// One already-decoded source rect ready to be copied onto a page: the
/// source's own full RGBA8 buffer and dimensions, and the sub-rect within
/// it to copy.
pub struct SourceCrop<'a> {
    pub sheet_width: u32,
    pub sheet_height: u32,
    pub sheet_rgba: &'a [u8],
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

fn get_px(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let i = (y as usize * width as usize + x as usize) * 4;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

fn set_px(rgba: &mut [u8], width: u32, x: u32, y: u32, px: [u8; 4]) {
    let i = (y as usize * width as usize + x as usize) * 4;
    rgba[i..i + 4].copy_from_slice(&px);
}

/// Copies `crop`'s pixels, byte-for-byte (Artie's direction: never resize,
/// never smooth, never touch alpha premultiplication or colour), onto
/// `page_rgba` at `(dest_x, dest_y)`, then extrudes a
/// [`ATLAS_GUTTER_PX`]-wide border around it by repeating the copied
/// rect's own edge pixels outward (Artie's direction: extrusion, never a
/// transparent-only gutter, is what stops bleed at a fractional camera
/// position). Corners repeat the crop's own corner pixel.
pub fn composite_with_extrusion(
    page_rgba: &mut [u8],
    page_width: u32,
    crop: &SourceCrop,
    dest_x: u32,
    dest_y: u32,
) {
    let g = ATLAS_GUTTER_PX;
    for row in 0..crop.h {
        for col in 0..crop.w {
            let px = get_px(
                crop.sheet_rgba,
                crop.sheet_width,
                crop.x + col,
                crop.y + row,
            );
            set_px(page_rgba, page_width, dest_x + col, dest_y + row, px);
        }
    }
    // Edges: extrude the crop's own boundary row/column outward by `g`.
    for row in 0..crop.h {
        let left = get_px(crop.sheet_rgba, crop.sheet_width, crop.x, crop.y + row);
        let right = get_px(
            crop.sheet_rgba,
            crop.sheet_width,
            crop.x + crop.w - 1,
            crop.y + row,
        );
        for gx in 1..=g {
            set_px(page_rgba, page_width, dest_x - gx, dest_y + row, left);
            set_px(
                page_rgba,
                page_width,
                dest_x + crop.w - 1 + gx,
                dest_y + row,
                right,
            );
        }
    }
    for col in 0..crop.w {
        let top = get_px(crop.sheet_rgba, crop.sheet_width, crop.x + col, crop.y);
        let bottom = get_px(
            crop.sheet_rgba,
            crop.sheet_width,
            crop.x + col,
            crop.y + crop.h - 1,
        );
        for gy in 1..=g {
            set_px(page_rgba, page_width, dest_x + col, dest_y - gy, top);
            set_px(
                page_rgba,
                page_width,
                dest_x + col,
                dest_y + crop.h - 1 + gy,
                bottom,
            );
        }
    }
    // Corners.
    let tl = get_px(crop.sheet_rgba, crop.sheet_width, crop.x, crop.y);
    let tr = get_px(
        crop.sheet_rgba,
        crop.sheet_width,
        crop.x + crop.w - 1,
        crop.y,
    );
    let bl = get_px(
        crop.sheet_rgba,
        crop.sheet_width,
        crop.x,
        crop.y + crop.h - 1,
    );
    let br = get_px(
        crop.sheet_rgba,
        crop.sheet_width,
        crop.x + crop.w - 1,
        crop.y + crop.h - 1,
    );
    for gy in 1..=g {
        for gx in 1..=g {
            set_px(page_rgba, page_width, dest_x - gx, dest_y - gy, tl);
            set_px(
                page_rgba,
                page_width,
                dest_x + crop.w - 1 + gx,
                dest_y - gy,
                tr,
            );
            set_px(
                page_rgba,
                page_width,
                dest_x - gx,
                dest_y + crop.h - 1 + gy,
                bl,
            );
            set_px(
                page_rgba,
                page_width,
                dest_x + crop.w - 1 + gx,
                dest_y + crop.h - 1 + gy,
                br,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_rgba(width: u32, height: u32, px: [u8; 4]) -> Vec<u8> {
        let mut out = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width * height) {
            out.extend_from_slice(&px);
        }
        out
    }

    #[test]
    fn encode_then_decode_round_trips_pixels_exactly() {
        let width = 4;
        let height = 3;
        let mut rgba = Vec::new();
        for i in 0..(width * height) {
            let b = (i * 17) as u8;
            rgba.extend_from_slice(&[b, b.wrapping_add(1), b.wrapping_add(2), b.wrapping_add(3)]);
        }
        let png_bytes = encode_rgba8(width, height, &rgba).unwrap();
        let (w2, h2, rgba2) = decode_rgba8(&png_bytes).unwrap();
        assert_eq!((w2, h2), (width, height));
        assert_eq!(rgba2, rgba);
    }

    #[test]
    fn encode_is_deterministic_byte_for_byte() {
        let rgba = solid_rgba(8, 8, [10, 20, 30, 255]);
        let a = encode_rgba8(8, 8, &rgba).unwrap();
        let b = encode_rgba8(8, 8, &rgba).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn encode_never_carries_a_text_or_time_chunk() {
        let rgba = solid_rgba(2, 2, [1, 2, 3, 4]);
        let bytes = encode_rgba8(2, 2, &rgba).unwrap();
        assert!(!contains_chunk(&bytes, b"tEXt"));
        assert!(!contains_chunk(&bytes, b"tIME"));
        assert!(!contains_chunk(&bytes, b"zTXt"));
    }

    fn contains_chunk(png_bytes: &[u8], chunk_type: &[u8; 4]) -> bool {
        png_bytes.windows(4).any(|w| w == chunk_type)
    }

    #[test]
    fn decode_widens_a_straight_rgb_source_to_rgba_with_opaque_alpha() {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, 2, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[10, 20, 30, 40, 50, 60]).unwrap();
        }
        let (w, h, rgba) = decode_rgba8(&out).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(rgba, vec![10, 20, 30, 255, 40, 50, 60, 255]);
    }

    #[test]
    fn composite_with_extrusion_copies_pixels_exactly_and_repeats_edges() {
        // A 2x2 source crop from a 2x2 sheet, distinct colours per pixel,
        // composited onto a page with a 1px gutter (ATLAS_GUTTER_PX).
        let sheet = vec![
            1, 1, 1, 255, // (0,0)
            2, 2, 2, 255, // (1,0)
            3, 3, 3, 255, // (0,1)
            4, 4, 4, 255, // (1,1)
        ];
        let crop = SourceCrop {
            sheet_width: 2,
            sheet_height: 2,
            sheet_rgba: &sheet,
            x: 0,
            y: 0,
            w: 2,
            h: 2,
        };
        let page_w = 6;
        let page_h = 6;
        let mut page = vec![0u8; page_w as usize * page_h as usize * 4];
        composite_with_extrusion(&mut page, page_w, &crop, 2, 2);

        // Inner pixels copied exactly.
        assert_eq!(get_px(&page, page_w, 2, 2), [1, 1, 1, 255]);
        assert_eq!(get_px(&page, page_w, 3, 2), [2, 2, 2, 255]);
        assert_eq!(get_px(&page, page_w, 2, 3), [3, 3, 3, 255]);
        assert_eq!(get_px(&page, page_w, 3, 3), [4, 4, 4, 255]);

        // Left/top/right/bottom edges extruded, not transparent.
        assert_eq!(get_px(&page, page_w, 1, 2), [1, 1, 1, 255]); // left of (0,0)
        assert_eq!(get_px(&page, page_w, 2, 1), [1, 1, 1, 255]); // above (0,0)
        assert_eq!(get_px(&page, page_w, 4, 2), [2, 2, 2, 255]); // right of (1,0)
        assert_eq!(get_px(&page, page_w, 3, 4), [4, 4, 4, 255]); // below (1,1)

        // Corner extruded too.
        assert_eq!(get_px(&page, page_w, 1, 1), [1, 1, 1, 255]);
        assert_eq!(get_px(&page, page_w, 4, 4), [4, 4, 4, 255]);
    }
}
