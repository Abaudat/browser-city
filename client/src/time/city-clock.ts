// Current in-city time: the server's epoch row plus the reconciled server
// clock, evaluated on demand. Nothing ticks and nothing is stored.

import { type CityTime, cityMilliminutes, cityTime } from "./city-time";
import type { ServerClock } from "./server-clock";

export class CityClock {
  readonly #server: ServerClock;
  #realMsPerCityMinute: number | undefined;
  #epochMicros: bigint | undefined;
  #speed = 1;

  constructor(server: ServerClock) {
    this.#server = server;
  }

  /** The generated `real_ms_per_city_minute`, known once the defs are. */
  setRate(realMsPerCityMinute: number): void {
    this.#realMsPerCityMinute = realMsPerCityMinute;
  }

  /** Called with the subscribed `world_clock` row's `epoch_at` and
   * `speed`, on insert and on any later rewrite. */
  setClock(epochMicros: bigint, speed: number): void {
    this.#epochMicros = epochMicros;
    this.#speed = speed;
  }

  /** `undefined` until the rate, the epoch and a server sample are known. */
  now(): CityTime | undefined {
    const serverNow = this.#server.nowMicros();
    const rate = this.#realMsPerCityMinute;
    if (this.#epochMicros === undefined || serverNow === undefined || rate === undefined) {
      return undefined;
    }
    return cityTime(this.#epochMicros, serverNow, rate, this.#speed);
  }

  /** City time since the epoch in milliminutes, or `undefined` while
   * `now()` is. */
  nowMilliminutes(): number | undefined {
    const serverNow = this.#server.nowMicros();
    const rate = this.#realMsPerCityMinute;
    if (this.#epochMicros === undefined || serverNow === undefined || rate === undefined) {
      return undefined;
    }
    return cityMilliminutes(this.#epochMicros, serverNow, rate, this.#speed);
  }
}
