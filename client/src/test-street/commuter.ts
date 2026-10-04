// The demo's one commuter (story 5.1): an L3 body walking the pavement outside
// the shops, out and back on a timetable read from city time. Its legs are
// fixture data standing in for L2; everything it does on screen comes from
// `l3/`. A civilian adult from the real appearance pipeline.

import { STREET_FLOOR } from "./fixture";
import type { TimetableSpec } from "./timetable";

export const COMMUTER_ID = "commuter";
export const COMMUTER_STABLE_ID = 1001n;

/** From the west end of the pavement to the east, along the row the lamppost
 * stands on: the route goes up around it and back down, so it turns three
 * times before the far end. `detourCells` is the walk's length beyond its
 * Manhattan length. */
export const COMMUTER_SPEC: TimetableSpec = {
  out: [
    { x: 2, y: 8, floor: STREET_FLOOR },
    { x: 12, y: 8, floor: STREET_FLOOR },
    { x: 18, y: 8, floor: STREET_FLOOR },
  ],
  detourCells: 2,
  dwellMs: 3000,
  homeFacing: "right",
  outFacing: "down",
};
