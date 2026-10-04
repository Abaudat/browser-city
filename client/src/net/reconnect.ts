// Story 4.8 (FR140, FR179, NFR4): the one supervisor of the connection. A
// reconnect is a new `open()`; the SDK connection is single-use. Everything
// it touches is injected (timers, randomness, the page's event targets), so
// `net/` stays free of DOM globals.
//
// Triggers: the backoff timer, and a wake -- `online`, `pageshow`, `focus`,
// `visibilitychange` to visible. A wake while waiting cancels the timer and
// attempts at once; while connecting it does nothing (single flight); while
// connected it probes the socket, because after a lid close it can look open
// and be dead. An attempt that does not settle within `CONNECT_TIMEOUT_MS`
// has failed: it is superseded and the backoff goes on. Probe: the socket is already closed, or the injected `probe`
// (the `sync_clock` round trip) does not answer within `PROBE_TIMEOUT_MS`.

import type { ConnectionStatus } from "./connection-status";
import {
  CONNECT_TIMEOUT_MS,
  initialPolicy,
  type PolicyAction,
  type PolicyInput,
  type PolicyState,
  PROBE_TIMEOUT_MS,
  stepPolicy,
} from "./reconnect-policy";

type Listener = () => void;

/** The slice of `window`/`document` the supervisor listens on. */
export interface WakeTarget {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

export interface SupervisorDeps<C> {
  /** Starts one connection attempt. Its status reports go to `report`;
   * `isCurrent` says whether it is still the newest attempt, for guarding
   * every other callback it owns. */
  readonly open: (
    generation: number,
    report: (status: ConnectionStatus) => void,
    isCurrent: () => boolean,
  ) => C;
  /** Resolves when the connection answers, rejects when it does not. */
  readonly probe: (conn: C) => Promise<unknown>;
  /** Whether the connection's socket is known to be closed. */
  readonly isClosed: (conn: C) => boolean;
  readonly close: (conn: C) => void;
  readonly onStatus: (status: ConnectionStatus) => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly random: () => number;
  readonly window: WakeTarget;
  readonly document: WakeTarget & { readonly visibilityState: string };
}

export interface Supervisor<C> {
  /** The live connection, or the one being attempted. */
  current(): C;
  /** 1 while a connection is open and not yet closed, else 0. */
  liveCount(): number;
  /** The page is back (also what an elapsed backoff timer is). */
  wake(): void;
  stop(): void;
}

export function startSupervisor<C>(deps: SupervisorDeps<C>): Supervisor<C> {
  let generation = 0;
  let state: PolicyState = initialPolicy();
  let conn: C | undefined;
  let timer: unknown;
  let deadline: unknown;
  let probing = false;
  let stopped = false;
  let open = false;
  let lastStatus: ConnectionStatus | undefined;

  const emit = (status: ConnectionStatus): void => {
    if (status === lastStatus) return;
    lastStatus = status;
    deps.onStatus(status);
  };

  /** Closes the current connection once; the reference stays so callers
   * of `current()` always have something to ask. */
  const closeConn = (): void => {
    if (!open || conn === undefined) return;
    open = false;
    try {
      deps.close(conn);
    } catch (error) {
      console.error("[net] closing a superseded connection failed", error);
    }
  };

  const clearWait = (): void => {
    if (timer === undefined) return;
    deps.clearTimer(timer);
    timer = undefined;
  };

  const clearDeadline = (): void => {
    if (deadline === undefined) return;
    deps.clearTimer(deadline);
    deadline = undefined;
  };

  const run = (action: PolicyAction): void => {
    if (action.kind === "wait") {
      clearDeadline();
      // "Connection lost" holds steady through every attempt: the retries
      // report nothing.
      emit("disconnected");
      clearWait();
      timer = deps.setTimer(() => {
        timer = undefined;
        apply("wake");
      }, action.delayMs);
    } else if (action.kind === "attempt") {
      attempt();
    } else if (action.kind === "probe") {
      probe();
    }
  };

  const apply = (input: PolicyInput): void => {
    if (stopped) return;
    const next = stepPolicy(state, input, deps.random);
    state = next.state;
    run(next.action);
  };

  const attempt = (): void => {
    clearWait();
    generation += 1;
    const mine = generation;
    clearDeadline();
    // The old connection is superseded before the new one opens: its late
    // callbacks are ignored by generation.
    closeConn();
    try {
      conn = deps.open(
        mine,
        (status) => report(mine, status),
        () => mine === generation && !stopped,
      );
      open = true;
    } catch (error) {
      console.error("[net] opening a connection failed", error);
      apply("failed");
      return;
    }
    deadline = deps.setTimer(() => {
      deadline = undefined;
      if (mine !== generation || state.kind !== "connecting") return;
      // Superseded first: a late answer of this attempt is ignored.
      generation += 1;
      closeConn();
      apply("failed");
    }, CONNECT_TIMEOUT_MS);
  };

  const report = (from: number, status: ConnectionStatus): void => {
    if (from !== generation || stopped) return;
    if (status === "connected") {
      clearDeadline();
      apply("succeeded");
      emit("connected");
    } else if (status === "disconnected") {
      // A refused connect, a dropped socket, or a failed region: the
      // connection is of no further use.
      const input = state.kind === "connected" ? "dropped" : "failed";
      closeConn();
      apply(input);
    } else if (status === "connecting") {
      if (from === 1) emit("connecting");
    } else {
      emit(status);
    }
  };

  const supersede = (): void => {
    generation += 1;
    closeConn();
    apply("dropped");
  };

  const probe = (): void => {
    const target = conn;
    if (probing || target === undefined) return;
    if (deps.isClosed(target)) {
      supersede();
      return;
    }
    probing = true;
    const forGeneration = generation;
    let settled = false;
    const settle = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      probing = false;
      deps.clearTimer(probeTimer);
      if (!alive && forGeneration === generation && !stopped) supersede();
    };
    const probeTimer = deps.setTimer(() => settle(false), PROBE_TIMEOUT_MS);
    deps.probe(target).then(
      () => settle(true),
      () => settle(false),
    );
  };

  const wake = (): void => apply("wake");
  const onVisibility = (): void => {
    if (deps.document.visibilityState === "visible") wake();
  };
  deps.window.addEventListener("online", wake);
  deps.window.addEventListener("pageshow", wake);
  deps.window.addEventListener("focus", wake);
  deps.document.addEventListener("visibilitychange", onVisibility);

  attempt();

  return {
    current: () => conn as C,
    liveCount: () => (open ? 1 : 0),
    wake,
    stop: () => {
      stopped = true;
      clearWait();
      clearDeadline();
      deps.window.removeEventListener("online", wake);
      deps.window.removeEventListener("pageshow", wake);
      deps.window.removeEventListener("focus", wake);
      deps.document.removeEventListener("visibilitychange", onVisibility);
      generation += 1;
      closeConn();
    },
  };
}
