// The street's raw `ModernTileset/` texture table and the wall crops,
// kept free of PixiJS so tests can read the same paths and frames the
// scene draws.

/** A pixel rect within a source sheet. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Each `new URL(<literal>, import.meta.url)` call below must stay a
// literal string argument, not a variable or template interpolation --
// that is what lets Vite statically detect each one as an asset
// reference, copy it into the production build, and resolve it correctly
// against the dev server's own module graph. A helper function taking a
// path parameter makes every one of these invisible to that analysis
// (confirmed against `npm run build`'s own output: nothing under
// `dist/assets/*.png`, and the template literal leaking into the bundle
// instead of a resolved URL, when this was tried).
export const ASSET_URLS: Readonly<Record<string, string>> = {
  sidewalk: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/2_City_Terrains_Singles_16x16/ME_Singles_City_Terrains_16x16_Sidewalk_1_1.png",
    import.meta.url,
  ).href,
  floorSheet: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles/Room_Builder_Floors_16x16.png",
    import.meta.url,
  ).href,
  wallSheet: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles/Room_Builder_Walls_16x16.png",
    import.meta.url,
  ).href,
  poster: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Poster_1.png",
    import.meta.url,
  ).href,
  // Story 2.6/2.13: every `defId`-placed prop (the counter, the window,
  // the bin, the lamppost, the wall segment, the bridge deck, the foot
  // stairs) draws through `render/atlas-pages.ts`'s `AtlasPageLoader`
  // instead of a `ModernTileset/` URL import -- see `resolvePropTexture`
  // below. Only a row with no real `defs/objects` id belongs in this
  // table. Shop B's own furniture: a grocer, not a second tiki bar
  // (Artie's "grounded city" direction).
  shelf: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/16_Grocery_Store_Singles/Grocery_Store_Singles_113.png",
    import.meta.url,
  ).href,
  basket: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/16_Grocery_Store_Singles/Grocery_Store_Singles_10.png",
    import.meta.url,
  ).href,
  table: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/ME_Singles_Camping_16x16_Benched_Table_1.png",
    import.meta.url,
  ).href,
  glass: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/ME_Singles_Camping_16x16_Bottle_1.png",
    import.meta.url,
  ).href,
  awning: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/4_Generic_Building_Singles_16x16/ME_Singles_Generic_Building_16x16_Shop_Tent_1.png",
    import.meta.url,
  ).href,
  // The subway: a real descending stairwell with railings on the street
  // and the same flight seen from the platform, drawn unflipped so its
  // treads rise toward the up anchor (a flipped side-on flight reverses
  // which end is high), the platform's own green way-out sign, and the subway
  // pack's own tiled wall, floor and hazard-striped platform edge --
  // never the shops' own interior art reused underground.
  subwayStairsDown: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Stairs_Complete_2.png",
    import.meta.url,
  ).href,
  subwayStairsUp: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Stairs_Complete_2.png",
    import.meta.url,
  ).href,
  subwayArrowUp: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Arrow_Up_Green_Sign.png",
    import.meta.url,
  ).href,
  subwayBench: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Two_Seats_Grey_Bench_Frontal_1.png",
    import.meta.url,
  ).href,
  subwayWall: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Lilac_Tile_1_Vers_1.png",
    import.meta.url,
  ).href,
  subwayFloor: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_White_Tile_1.png",
    import.meta.url,
  ).href,
  subwayEdge: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Binary_Edge_Left_Down_1.png",
    import.meta.url,
  ).href,
  // Story 15.2: every rest the scripted walk needs is now a real, drawn
  // prop (`fixture.ts`'s own doc comment, "The scripted walk's own rests,
  // as real street furniture", says why) -- flat, single-tile street
  // furniture, never sliced (`sliceTexture`'s 1x1 no-op case).
  doormat: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/ME_Singles_Vehicles_16x16_Gas_Station_Doormat_1.png",
    import.meta.url,
  ).href,
  bollard: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/ME_Singles_City_Props_16x16_Pedestrian_Barrier_Post_1.png",
    import.meta.url,
  ).href,
  manhole: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/ME_Singles_City_Props_16x16_Manhole_1.png",
    import.meta.url,
  ).href,
};

/** `wallTileH`/`wallTileV` are two real, whole-tile sub-rects of the same
 * `wallSheet` source file (never a new PNG): a 1x3-tile swatch for the
 * horizontal (north/south) walls, whose un-decomposed axis (height) is
 * free to overhang above each cell, and a flush 1x1-tile swatch for the
 * vertical (west/east) walls, whose width must never overhang
 * horizontally (Artie's rule). Both are reused whole, per cell -- see
 * `sliceTexture`'s "repeat" case. `wallTileV`'s own flush swatch doubles
 * as the FR120 retraction stub (Artie's direction: "the short wall caps
 * already in Room_Builder_Walls_16x16.png", no new art) -- see
 * `wallStub` below. */
export const WALL_TILE_H_FRAME: PixelRect = { x: 0, y: 528, width: 16, height: 48 };
export const WALL_TILE_V_FRAME: PixelRect = { x: 0, y: 528, width: 16, height: 16 };
