// The one thin `net/` adapter for the in-city clock (story 4.1): issues the
// stamped `sync_clock` round trip and wires the tab-visibility signal into
// the pure `time/clock-sync.ts`.

import { type ClockSync, startClockSync } from "../time/clock-sync";
import type { ServerClock } from "../time/server-clock";
import type { DbConnection } from "./bindings";

export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function startNetClockSync(
  conn: Pick<DbConnection, "procedures">,
  serverClock: ServerClock,
  doc: VisibilitySource,
): ClockSync {
  return startClockSync({
    serverClock,
    perfNow: () => performance.now(),
    fetchServerMicros: async () => (await conn.procedures.syncClock({})).microsSinceUnixEpoch,
    onVisible: (cb) => {
      const listener = () => {
        if (doc.visibilityState === "visible") cb();
      };
      doc.addEventListener("visibilitychange", listener);
      return () => doc.removeEventListener("visibilitychange", listener);
    },
  });
}
