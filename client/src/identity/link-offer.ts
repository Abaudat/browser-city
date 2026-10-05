// Story 4.5 (FR143): the pieces of the in-world link offer that are decisions,
// kept pure so `main.ts` only wires them. The offer's carrier is an
// `[[object]]` found by its tag (never by key), placed once per session when
// the scene mounts if the offer is due; using it starts `offerLink`.

import type { Defs } from "../defs/types";
import type { CharacterReport, IdentityReport } from "../net/connection";
import { cityTime } from "../time/city-time";
import { isLinkPromptDue, type LinkPromptRules } from "./link-prompt";

/** The tag whose object carries the offer (`defs/tags/city.toml`). */
export const LINK_CARRIER_TAG_KEY = "registry_post";

export interface OfferInputs {
  readonly character: CharacterReport | null;
  readonly identity: IdentityReport | null;
  /** An OIDC provider is configured. */
  readonly configured: boolean;
  /** The `world_clock` row, once received. */
  readonly clock: { readonly epochMicros: bigint; readonly speed: number } | null;
  readonly realMsPerCityMinute: number;
  /** The current city day, `undefined` until the server clock has a sample. */
  readonly today: number | undefined;
  readonly lastShownDay: number | null;
  readonly rules: LinkPromptRules;
}

/** Whether the offer is due this session. Every input missing is "not due":
 * the offer is never made on a guess. */
export function offerDue(i: OfferInputs): boolean {
  if (!i.character || !i.identity || !i.clock || i.today === undefined) return false;
  const createdDay = cityTime(
    i.clock.epochMicros,
    i.character.createdAtMicros,
    i.realMsPerCityMinute,
    i.clock.speed,
  ).day;
  return isLinkPromptDue(
    {
      hasCharacter: true,
      linked: i.character.linked,
      tokenPersisted: i.identity.persisted,
      issuerConfigured: i.configured,
      characterCreatedDay: createdDay,
      today: i.today,
      lastShownDay: i.lastShownDay,
    },
    i.rules,
  );
}

/** The def id of the object carrying the carrier tag, found by tag. */
export function carrierDefId(defs: Pick<Defs, "tags" | "objects">): number | undefined {
  const tag = defs.tags.find((t) => t.key === LINK_CARRIER_TAG_KEY);
  if (!tag) return undefined;
  return defs.objects.find((o) => o.tags.includes(tag.id))?.id;
}

export function readOfferRules(defs: Pick<Defs, "balance">): LinkPromptRules {
  const get = (key: string): number => {
    const entry = defs.balance.find((b) => b.key === key);
    if (!entry) throw new Error(`readOfferRules: no balance entry for '${key}'`);
    return entry.value;
  };
  return {
    minCharacterAgeDays: get("identity.link_prompt_min_character_age_days"),
    cooloffDays: get("identity.link_prompt_cooloff_days"),
  };
}
