// A synthetic transition fixture that targets its own cell has no collision
// world to check the kept position against: it says so, by name, here.
export const OPEN_ENTRY_BAND = {
  subcellsPerCell: 16,
  isBodyClear: () => true,
} as const;
