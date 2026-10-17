import {
  STREET_BOUNDARY,
  STREET_BUILDING_AREAS,
  STREET_GROUND_TILES,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  streetPlacedRows,
} from "./fixture";

const rows = streetPlacedRows();
const real = rows.filter((r) => r.defId < 10000);
const ids = real.map((r) => Number(r.objectId));
console.log(
  "rows",
  rows.length,
  "real",
  real.length,
  "idmin",
  Math.min(...ids),
  "idmax",
  Math.max(...ids),
);
console.log(
  "x",
  Math.min(...real.map((r) => r.x)),
  Math.max(...real.map((r) => r.x)),
  "y",
  Math.min(...real.map((r) => r.y)),
  Math.max(...real.map((r) => r.y)),
);
console.log("floors", [...new Set(real.map((r) => r.floor))]);
console.log(
  "transitions",
  STREET_TRANSITIONS.length,
  "bareas",
  STREET_BUILDING_AREAS.length,
  "rareas",
  STREET_ROOM_AREAS.length,
  "ground",
  STREET_GROUND_TILES.length,
  "boundary",
  STREET_BOUNDARY.length,
);
console.log(
  "ground",
  JSON.stringify(
    STREET_GROUND_TILES.map((g) => [
      "assetKey" in g ? g.assetKey : g.defId,
      g.floor,
      g.x0,
      g.y0,
      g.x1,
      g.y1,
    ]),
  ),
);
console.log("areas", JSON.stringify(STREET_BUILDING_AREAS.slice(0, 3)));
