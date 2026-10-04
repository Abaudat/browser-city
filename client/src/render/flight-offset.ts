import type { FlightDef } from "../defs/types";
import { footprintCells, footprintOrigin } from "../world/footprint";
import { bodyRect, type MovementConfig } from "../world/movement";
import {
  forwardOpenNeighbor,
  pairTransitions,
  reverseOpenNeighbor,
  type TransitionSpec,
} from "../world/transitions";
import { floorOffsetPx } from "./screen-position";

// FR182's flight offset (story 15.15): an actor on a flight is drawn lower
// or higher along the walked treads, following the drawn surface, instead of
// the whole floor offset arriving at the floor change. A pure function of
// position and floor -- never of time, velocity, facing or the previous
// tick -- so walking back retraces it exactly and standing still holds the
// height. It is summed with the floor offset inside `worldPointPx` and
// exists nowhere else: not in the sort key, collision, walk state or
// picking. No `pixi.js`, no scene state.

/** What a flight needs from its `defs/objects` row. */
export interface FlightSource {
  readonly width: number;
  readonly height: number;
  /** The def's `flight` table; absent means not a flight. */
  readonly flight?: FlightDef;
}

/** A placed row, as far as a flight is concerned. */
export interface PlacedFlightRow {
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

/** One flight: the footprint of the placed object under a transition's
 * anchor whose def has a `flight` table. */
export interface Flight {
  readonly floor: number;
  /** The footprint, in whole cells, half-open (`x1`/`y1` exclusive). */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** The unit step an actor walks from the open edge toward the anchor. */
  readonly dirX: number;
  readonly dirY: number;
  /** The axis coordinate (`x * dirX + y * dirY`) of the open edge, and of
   * the anchor cell's near edge, where the full drop is reached. */
  readonly startS: number;
  readonly fullS: number;
  /** Screen pixels at `fullS`, signed toward the transition's target floor
   * (positive is down the screen). */
  readonly dropPx: number;
}

/**
 * The flights of `transitions`, one per anchor a flight object covers.
 * The axis and open edge come from the pairing's own `d`
 * (`forwardOpenNeighbor` / `reverseOpenNeighbor`), the drop from the
 * object's def, the sign from `floorOffsetPx` of the two floors. An anchor
 * no flight object covers has no flight; two objects on one anchor, an
 * anchor that is not the footprint's far end, or a flight shorter than two
 * cells along its axis is an error. Every anchor of a flight wider than one
 * cell resolves that one flight.
 */
export function buildFlights(
  transitions: readonly TransitionSpec[],
  placed: readonly PlacedFlightRow[],
  sources: ReadonlyMap<number, FlightSource>,
  storeyHeightPx: number,
  tileSizePx: number,
): readonly Flight[] {
  const { pairings } = pairTransitions(transitions);
  const flights: Flight[] = [];
  // A flight wider than one cell is anchored in every column: each of its
  // anchors resolves the one flight, once.
  const built = new Set<PlacedFlightRow>();
  for (const pairing of pairings) {
    const sides = [
      { anchor: pairing.forward, dir: forwardOpenNeighbor(pairing).direction },
      { anchor: pairing.reverse, dir: reverseOpenNeighbor(pairing).direction },
    ];
    for (const { anchor, dir } of sides) {
      const covering = placed.filter((row) => {
        const source = sources.get(row.defId);
        return (
          row.floor === anchor.floor &&
          source?.flight !== undefined &&
          footprintCells(row.x, row.y, source).some((c) => c.x === anchor.x && c.y === anchor.y)
        );
      });
      const where = `(${anchor.x}, ${anchor.y}, floor ${anchor.floor})`;
      if (covering.length > 1) {
        throw new Error(`buildFlights: two flights cover the anchor ${where}`);
      }
      const row = covering[0];
      const source = row ? sources.get(row.defId) : undefined;
      if (!row || !source || !source.flight) continue;
      if (built.has(row)) continue;
      built.add(row);
      const { dropPx, fromPx, toPx } = source.flight;

      const origin = footprintOrigin(row.x, row.y, source);
      const x1 = origin.x + source.width;
      const y1 = origin.y + source.height;
      const alongX = dir.x !== 0;
      const length = alongX ? source.width : source.height;
      if (length < 2) {
        throw new Error(`buildFlights: the flight at ${where} is shorter than two cells`);
      }
      // The axis coordinate runs along `dir`: the open edge is its lowest
      // footprint value, the anchor cell must hold its highest cell.
      const lo = alongX ? (dir.x > 0 ? origin.x : -x1) : dir.y > 0 ? origin.y : -y1;
      const hi = lo + length;
      if (toPx > length * tileSizePx) {
        throw new Error(`buildFlights: the ramp of the flight at ${where} leaves its footprint`);
      }
      // The anchor cell's near edge on that axis (a cell spans one unit).
      const anchorNearS = alongX
        ? dir.x > 0
          ? anchor.x
          : -anchor.x - 1
        : dir.y > 0
          ? anchor.y
          : -anchor.y - 1;
      if (anchorNearS !== hi - 1) {
        throw new Error(`buildFlights: the anchor ${where} is not at the far end of its flight`);
      }
      const sign = Math.sign(
        floorOffsetPx(anchor.targetFloor, storeyHeightPx) -
          floorOffsetPx(anchor.floor, storeyHeightPx),
      );
      flights.push({
        floor: anchor.floor,
        x0: origin.x,
        y0: origin.y,
        x1,
        y1,
        dirX: dir.x + 0,
        dirY: dir.y + 0,
        startS: lo + fromPx / tileSizePx,
        fullS: lo + toPx / tileSizePx,
        dropPx: sign * dropPx + 0,
      });
    }
  }
  return flights;
}

function cellKey(floor: number, x: number, y: number): string {
  return `${floor}|${x}|${y}`;
}

/** The flights, keyed by cell: O(1) per query. */
export class FlightIndex {
  private readonly byCell = new Map<string, Flight>();

  constructor(
    flights: readonly Flight[],
    private readonly config: MovementConfig,
  ) {
    for (const flight of flights) {
      for (let y = flight.y0; y < flight.y1; y++) {
        for (let x = flight.x0; x < flight.x1; x++) {
          const key = cellKey(flight.floor, x, y);
          if (this.byCell.has(key)) {
            throw new Error(
              `FlightIndex: two flights share cell (${x}, ${y}, floor ${flight.floor})`,
            );
          }
          this.byCell.set(key, flight);
        }
      }
    }
  }

  /**
   * The screen-pixel offset for an actor whose feet are at `(x, y)` on
   * `floor`: `0` (exactly `+0`) off every flight. An actor is on a flight
   * when its body overlaps the footprint -- a body pressed against the near
   * railing rests with its feet on the row boundary, outside the tread cell
   * -- and progress is read from the feet along the flight's axis, clamped
   * to it (flat before the first tread and after the last).
   */
  offsetPx(x: number, y: number, floor: number): number {
    if (this.byCell.size === 0) return 0;
    const sub = this.config.subcellsPerCell;
    const body = bodyRect({ x, y }, this.config);
    const cx1 = Math.ceil(body.x1 / sub) - 1;
    const cy1 = Math.ceil(body.y1 / sub) - 1;
    for (let cy = Math.floor(body.y0 / sub); cy <= cy1; cy++) {
      for (let cx = Math.floor(body.x0 / sub); cx <= cx1; cx++) {
        const flight = this.byCell.get(cellKey(floor, cx, cy));
        if (!flight) continue;
        const s = x * flight.dirX + y * flight.dirY;
        const t = Math.min(1, Math.max(0, (s - flight.startS) / (flight.fullS - flight.startS)));
        return flight.dropPx * t + 0;
      }
    }
    return 0;
  }
}
