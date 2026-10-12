// Story 4.14 (FR172): the client's one self-measurement call. It reports
// two figures through `report_client_measure` and nothing else:
//   - `Boot`: the `player-controllable` boot mark, once per page, only
//     while connected and only on a page that has not lost its connection
//     (a reconnecting page's mark is not a boot), and never on a first
//     boot -- one that went through the name prompt includes the player's
//     typing, which means nothing against NFR1 (story 4.6);
//   - `Resumed`: the outage from the status turning `disconnected` to the
//     next `connected`, once per drop.
// Never from a second stopwatch, never queued on a dead connection: a send
// happens only on the `connected` transition or the mark firing while
// connected. No timers.

import { BOOT_MARK, onBootMark } from "../boot/boot-marks";
import type { ConnectionStatus } from "./connection-status";

export type Measure = { tag: "Boot"; value: number } | { tag: "Resumed"; value: number };

export interface MeasureReporterDeps {
  send: (measure: Measure) => void;
  /** The `player-controllable` mark in ms since navigation, when set. */
  bootMs: () => number | undefined;
  now: () => number;
  /** This boot went through the name prompt (the name was submitted). */
  firstBoot?: () => boolean;
}

export interface MeasureReporter {
  setStatus(status: ConnectionStatus): void;
  /** The controllable mark has just fired. */
  markControllable(): void;
}

/** A whole, positive millisecond figure, or `undefined`. */
function wholeMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const ms = Math.round(value);
  return ms >= 1 ? ms : undefined;
}

export function createMeasureReporter(deps: MeasureReporterDeps): MeasureReporter {
  let connected = false;
  let everDropped = false;
  let bootSent = false;
  let droppedAt: number | undefined;

  const tryBoot = (): void => {
    if (!connected || bootSent || everDropped) return;
    if (deps.firstBoot?.()) return;
    const ms = wholeMs(deps.bootMs());
    if (ms === undefined) return;
    bootSent = true;
    deps.send({ tag: "Boot", value: ms });
  };

  return {
    setStatus: (status) => {
      if (status === "connected") {
        if (connected) return;
        connected = true;
        if (droppedAt !== undefined) {
          const outage = wholeMs(deps.now() - droppedAt);
          droppedAt = undefined;
          if (outage !== undefined) deps.send({ tag: "Resumed", value: outage });
        }
        tryBoot();
      } else if (status === "disconnected") {
        if (connected) {
          connected = false;
          everDropped = true;
          droppedAt = deps.now();
        }
      }
    },
    markControllable: tryBoot,
  };
}

/** What the reporter needs of a live connection. */
export interface MeasureConnection {
  reducers: { reportClientMeasure(args: { measure: Measure }): Promise<unknown> };
}

/** The production wiring: reads the connection at the moment of use, the
 * boot figure from the controllable mark and time from `performance`.
 * Returns the reporter and the unsubscribe of its mark watch. */
export function startMeasureReporter(conn: () => MeasureConnection): {
  reporter: MeasureReporter;
  stop: () => void;
} {
  const reporter = createMeasureReporter({
    send: (measure) => {
      conn()
        .reducers.reportClientMeasure({ measure })
        .catch((error: unknown) => {
          console.error("[net] measure refused", error);
        });
    },
    bootMs: bootControllableMs,
    now: () => performance.now(),
    firstBoot: () => performance.getEntriesByName(BOOT_MARK.NAME_SUBMITTED, "mark").length > 0,
  });
  const stop = watchControllableMark(() => reporter.markControllable());
  return { reporter, stop };
}

/** The boot figure: the `player-controllable` entry `markBoot` recorded. */
export function bootControllableMs(): number | undefined {
  const entries = performance.getEntriesByName(BOOT_MARK.PLAYER_CONTROLLABLE, "mark");
  return entries.at(-1)?.startTime;
}

/** Calls `onFired` when the `player-controllable` mark is set; returns the
 * unsubscribe. */
export function watchControllableMark(onFired: () => void): () => void {
  return onBootMark((name) => {
    if (name === BOOT_MARK.PLAYER_CONTROLLABLE) onFired();
  });
}
