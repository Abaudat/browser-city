// Story 4.5 (FR143): where the link offer's carrier stands in the test
// street. Throwaway placement -- the mechanism (`identity/link-offer.ts`)
// is the permanent part. Shop A's east end, in the row south of the
// counter: inside the shop the player arrives in, a short walk from the
// arrival point, and off the column the player walks to the counter and the
// door by.

import { placeExtraStreetProp, STREET_FLOOR } from "./fixture";

export const LINK_CARRIER_PROP_ID = 5000n;
export const LINK_CARRIER_CELL = { x: 7, y: 3, floor: STREET_FLOOR } as const;

export function placeLinkCarrier(defId: number): void {
  placeExtraStreetProp({
    id: LINK_CARRIER_PROP_ID,
    x: LINK_CARRIER_CELL.x,
    y: LINK_CARRIER_CELL.y,
    floor: LINK_CARRIER_CELL.floor,
    layer: "objects",
    defId,
  });
}
