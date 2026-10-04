// The demo's one commuter (story 5.1): an L3 body walking the pavement outside
// the shops, to the lamppost and back, on a timetable read from city time. Its
// legs are fixture data standing in for L2; everything it does on screen comes
// from `l3/`. A civilian adult from the real appearance pipeline.

import { STREET_FLOOR } from "./fixture";
import type { TimetableSpec } from "./timetable";

export const COMMUTER_ID = "commuter";
export const COMMUTER_STABLE_ID = 1001n;

/** From the front of shop B's window, facing it, west along the pavement to
 * the lamppost, past which the route sidesteps. Both ends are places to stand:
 * a window to look at, a lamppost to wait by. One segment, so one pace end to
 * end. */
export const COMMUTER_SPEC: TimetableSpec = {
  out: [
    { x: 11, y: 7, floor: STREET_FLOOR },
    { x: 6, y: 8, floor: STREET_FLOOR },
  ],
  dwellMs: 3000,
  homeFacing: "up",
  outFacing: "right",
};
