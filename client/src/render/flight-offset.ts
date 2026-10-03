// Stub: FR182's flight offset (story 15.15). Implemented after its tests.
import type { MovementConfig } from "../world/movement";
import type { TransitionSpec } from "../world/transitions";

export interface Flight {
  readonly floor: number;
  readonly dropPx: number;
}

export interface FlightSource {
  readonly width: number;
  readonly height: number;
  readonly flightDropPx?: number;
}

export interface PlacedFlightRow {
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export function buildFlights(
  _transitions: readonly TransitionSpec[],
  _placed: readonly PlacedFlightRow[],
  _sources: ReadonlyMap<number, FlightSource>,
  _storeyHeightPx: number,
): readonly Flight[] {
  throw new Error("not implemented");
}

export class FlightIndex {
  constructor(_flights: readonly Flight[], _config: MovementConfig) {}
  offsetPx(_x: number, _y: number, _floor: number): number {
    throw new Error("not implemented");
  }
}
