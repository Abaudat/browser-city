// Story 4.6: the local note that this device has arrived -- a character
// exists for its identity. `index.html`'s inline script reads the same key
// synchronously before first paint to keep a returning player from ever
// seeing the name prompt; `tests/unit/identity/shell-contract.test.ts`
// pins the two copies together.

import type { SettingsStorage } from "../settings/settings-storage";

export const ARRIVED_FLAG_KEY = "bc.arrived.v1";

/** Written once `my_character` reports a character -- never on submit
 * alone. Never throws. */
export function markArrived(storage: SettingsStorage | null | undefined): void {
  try {
    storage?.setItem(ARRIVED_FLAG_KEY, "1");
  } catch {
    // Storage unavailable: the next boot asks again, which is honest.
  }
}

export function hasArrived(storage: SettingsStorage | null | undefined): boolean {
  try {
    return storage?.getItem(ARRIVED_FLAG_KEY) != null;
  } catch {
    return false;
  }
}
