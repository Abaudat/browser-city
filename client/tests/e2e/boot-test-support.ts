// Shared by every e2e spec that needs to know the scene has genuinely
// mounted and is accepting input (the camera/viewport story, Quentin's
// direction): `boot-marks.spec.ts` already proves `PLAYER_CONTROLLABLE`
// is honest (it never fires before a key press actually moves the
// player), so waiting on it here is not a second, weaker readiness
// signal -- it is the one `client/src/boot/boot-marks.ts` already
// promises to be truthful.
import type { Page } from "@playwright/test";
import { BOOT_MARK } from "../../src/boot/boot-marks";

export async function waitForPlayerControllable(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    (markName) => performance.getEntriesByName(markName).length > 0,
    BOOT_MARK.PLAYER_CONTROLLABLE,
    { timeout },
  );
}
