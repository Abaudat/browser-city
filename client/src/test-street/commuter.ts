// The demo's one commuter (story 5.1): an L3 body walking from the pavement by
// shop A's awning, past the lamppost, round to the head of the subway stairs
// and back, on a timetable read from city time. Its legs are fixture data
// standing in for L2; everything it does on screen comes from `l3/`. A
// civilian adult from the real appearance pipeline.

import { STAIRS_X, STAIRS_Y, STREET_FLOOR } from "./fixture";
import type { TimetableSpec } from "./timetable";

export const COMMUTER_ID = "commuter";
export const COMMUTER_STABLE_ID = 1001n;

/** From the pavement cell by shop A's awning, east along the shopfronts past
 * the lamppost (the route drifts round it), down beside the stairwell to the
 * street exit cell (`STAIRS_X + 1, STAIRS_Y`): the first tread of the subway
 * stairs, one step from the down anchor, where a player climbing out lands. She
 * stands there facing the stairs, drawn sunk by the flight offset. One
 * segment, so one pace end to end. */
export const COMMUTER_SPEC: TimetableSpec = {
  out: [
    { x: 6, y: 8, floor: STREET_FLOOR },
    { x: STAIRS_X + 1, y: STAIRS_Y, floor: STREET_FLOOR },
  ],
  dwellMs: 1500,
  homeFacing: "right",
  outFacing: "left",
};
