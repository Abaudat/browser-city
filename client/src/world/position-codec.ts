// A position on the wire (story 4.4, FR138): the cell plus the fraction of
// the cell in 1/`unitsPerCell` (`defs`' `positionUnitsPerCell`, a multiple
// of the collider sub-cell, so every collider face is exact). The fraction
// is the nearest unit, held inside the cell: the cell, and so the chunk, of
// the wire position is always that of the float it came from.

/** A position as the server stores it. */
export interface WirePosition {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly fracX: number;
  readonly fracY: number;
}

function split(v: number, unitsPerCell: number): { cell: number; frac: number } {
  const cell = Math.floor(v) + 0; // never -0
  const frac = Math.min(unitsPerCell - 1, Math.round((v - cell) * unitsPerCell)) + 0;
  return { cell, frac };
}

export function quantise(
  xCells: number,
  yCells: number,
  floor: number,
  unitsPerCell: number,
): WirePosition {
  const x = split(xCells, unitsPerCell);
  const y = split(yCells, unitsPerCell);
  return { x: x.cell, y: y.cell, floor, fracX: x.frac, fracY: y.frac };
}

export function dequantise(
  p: WirePosition,
  unitsPerCell: number,
): { x: number; y: number; floor: number } {
  return {
    x: p.x + p.fracX / unitsPerCell,
    y: p.y + p.fracY / unitsPerCell,
    floor: p.floor,
  };
}
