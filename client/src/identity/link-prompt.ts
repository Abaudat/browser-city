// Whether the offer to link an account is due (story 4.5, FR143): a pure
// function of explicit inputs, evaluated once per session when the scene
// mounts, never mid-session. The offer is an in-world object, not a dialog,
// and declining is simply not taking it: nothing is withheld, and it is
// offered again only after the cool-off. Showing it records the city day
// under `bc.link-prompt.v1`.

import { loadVersioned, type SettingsStorage, saveVersioned } from "../settings/settings-storage";

export const LINK_PROMPT_STORAGE_KEY = "bc.link-prompt.v1";
const VERSION = 1;
const PAYLOAD = "day";

export interface LinkPromptInputs {
  readonly hasCharacter: boolean;
  /** Some identity of the character already came through an OIDC issuer. */
  readonly linked: boolean;
  /** The device's token is in storage: a link on a device that cannot keep
   * its identity would protect nothing. */
  readonly tokenPersisted: boolean;
  readonly issuerConfigured: boolean;
  /** City days. */
  readonly characterCreatedDay: number;
  readonly today: number;
  readonly lastShownDay: number | null;
}

/** `identity.link_prompt_*` balance keys, in city days. */
export interface LinkPromptRules {
  readonly minCharacterAgeDays: number;
  readonly cooloffDays: number;
}

export function isLinkPromptDue(i: LinkPromptInputs, rules: LinkPromptRules): boolean {
  if (!i.hasCharacter || i.linked || !i.tokenPersisted || !i.issuerConfigured) return false;
  if (i.today - i.characterCreatedDay < rules.minCharacterAgeDays) return false;
  if (i.lastShownDay !== null && i.today < i.lastShownDay + rules.cooloffDays) return false;
  return true;
}

function normaliseDay(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

export function loadLastShownDay(storage: SettingsStorage | null | undefined): number | null {
  return loadVersioned(storage, LINK_PROMPT_STORAGE_KEY, VERSION, PAYLOAD, null, normaliseDay);
}

/** Whether the write landed. */
export function saveLastShownDay(
  storage: SettingsStorage | null | undefined,
  day: number,
): boolean {
  return saveVersioned(storage, LINK_PROMPT_STORAGE_KEY, VERSION, PAYLOAD, day);
}
