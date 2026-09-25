// Keeps a `ServerClock` reconciled with the server: one stamped round trip
// on start, then every `CLOCK_SYNC_INTERVAL_MS`, and again whenever the tab
// becomes visible (a backgrounded tab's timers are throttled). Pure of
// `net/` and the DOM: the round trip and the visibility signal are injected.

import type { ServerClock } from "./server-clock";

export const CLOCK_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export interface ClockSyncDeps {
  readonly serverClock: ServerClock;
  readonly perfNow: () => number;
  /** One stamped round trip: resolves with the server's `ctx.timestamp`
   * in microseconds since the Unix epoch. */
  readonly fetchServerMicros: () => Promise<bigint>;
  /** Calls back whenever the tab becomes visible; returns the unsubscribe. */
  readonly onVisible: (cb: () => void) => () => void;
}

export interface ClockSync {
  syncNow(): Promise<void>;
  stop(): void;
}

export function startClockSync(deps: ClockSyncDeps): ClockSync {
  const syncNow = async (): Promise<void> => {
    const tSend = deps.perfNow();
    try {
      const serverMicros = await deps.fetchServerMicros();
      deps.serverClock.observe(tSend, deps.perfNow(), serverMicros);
    } catch (error) {
      // NFR42: a failed sample keeps the previous estimate.
      console.error("[time] clock sync failed", error);
    }
  };
  const timer = setInterval(() => void syncNow(), CLOCK_SYNC_INTERVAL_MS);
  const unsubscribe = deps.onVisible(() => void syncNow());
  void syncNow();
  return {
    syncNow,
    stop: () => {
      clearInterval(timer);
      unsubscribe();
    },
  };
}
