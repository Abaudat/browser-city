// The in-city clock's pure arithmetic (FR1-FR3): the client's own
// implementation of `sim::time::city_time`, pinned to it by
// `fixtures/city-clock-conformance.v1.json` (NFR30). BigInt throughout, so
// no `|0`/`>>` truncation or float rounding can creep in; the rate always
// comes from the generated defs, never a literal here.

export interface CityTime {
  /** Days since the city's own epoch; negative before it. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** `day` mod 7 -- the only calendar cycle the game defines. */
  readonly weekday: number;
  /** Real milliseconds elapsed inside the current city minute. For
   * rendering interpolation only; no reducer, rule or gameplay decision may
   * read this field -- the minute is the smallest unit of city time. */
  readonly realMsIntoMinute: number;
}

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7n;

/** Floor division and non-negative remainder, correct for negative `a`. */
function divMod(a: bigint, b: bigint): [bigint, bigint] {
  const q = a / b;
  const r = a % b;
  return r < 0n ? [q - 1n, r + b] : [q, r];
}

/** City time at `nowMicros` for a clock whose day 0, 00:00 is `epochMicros`
 * (both microseconds since the Unix epoch, as the SDK's `Timestamp` carries
 * them). Total: an instant before the epoch still decomposes correctly. */
export function cityTime(
  epochMicros: bigint,
  nowMicros: bigint,
  realMsPerCityMinute: number,
): CityTime {
  const [elapsedMs] = divMod(nowMicros - epochMicros, 1000n);
  const [totalMinutes, intoMinute] = divMod(elapsedMs, BigInt(realMsPerCityMinute));
  const minutesPerDay = BigInt(MINUTES_PER_HOUR * HOURS_PER_DAY);
  const [day, minuteOfDay] = divMod(totalMinutes, minutesPerDay);
  const [, weekday] = divMod(day, DAYS_PER_WEEK);
  return {
    day: Number(day),
    hour: Number(minuteOfDay / BigInt(MINUTES_PER_HOUR)),
    minute: Number(minuteOfDay % BigInt(MINUTES_PER_HOUR)),
    weekday: Number(weekday),
    realMsIntoMinute: Number(intoMinute),
  };
}
