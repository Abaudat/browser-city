// Current in-city time: the server's epoch row plus the reconciled server
// clock, evaluated on demand. Nothing ticks and nothing is stored.

import { type CityTime, cityTime } from "./city-time";
import type { ServerClock } from "./server-clock";

export class CityClock {
  readonly #server: ServerClock;
  #realMsPerCityMinute: number | undefined;
  #epochMicros: bigint | undefined;

  constructor(server: ServerClock) {
    this.#server = server;
  }

  /** The generated `real_ms_per_city_minute`, known once the defs are. */
  setRate(realMsPerCityMinute: number): void {
    this.#realMsPerCityMinute = realMsPerCityMinute;
  }

  /** Called with the subscribed `world_clock` row's `epoch_at`, on insert
   * and on any later rewrite. */
  setEpoch(epochMicros: bigint): void {
    this.#epochMicros = epochMicros;
  }

  /** `undefined` until the rate, the epoch and a server sample are known. */
  now(): CityTime | undefined {
    const serverNow = this.#server.nowMicros();
    const rate = this.#realMsPerCityMinute;
    if (this.#epochMicros === undefined || serverNow === undefined || rate === undefined) {
      return undefined;
    }
    return cityTime(this.#epochMicros, serverNow, rate);
  }
}
