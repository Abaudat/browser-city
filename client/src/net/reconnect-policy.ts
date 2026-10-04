// Story 4.8 (FR140, FR179, NFR4): when to try the connection again. Pure:
// no DOM, no timers, no SDK. States are `connecting`, `connected` and
// `waiting`; at most one attempt is ever in flight, retries never stop.

/** A wait that elapses is a `wake`: the policy attempts now.
 *
 * Exponential backoff with full jitter: attempt n waits a uniform delay in
 * `[0, min(capMs, baseMs * 2^n))`. */
export const BACKOFF = { baseMs: 1_000, capMs: 30_000 } as const;

/** A wake that finds a connected socket silent for this long drops it. */
export const PROBE_TIMEOUT_MS = 5_000;

/** A connection attempt that has not settled in this long has failed: a
 * handshake that never answers must not hold the single flight forever. */
export const CONNECT_TIMEOUT_MS = 10_000;

export type PolicyState =
  | { readonly kind: "connecting"; readonly failures: number }
  | { readonly kind: "connected"; readonly failures: 0 }
  | { readonly kind: "waiting"; readonly failures: number };

export type PolicyInput = "succeeded" | "failed" | "dropped" | "wake";

export type PolicyAction =
  | { readonly kind: "none" }
  | { readonly kind: "attempt" }
  | { readonly kind: "wait"; readonly delayMs: number }
  | { readonly kind: "probe" };

/** The state of a page that has just started its first attempt. */
export function initialPolicy(): PolicyState {
  return { kind: "connecting", failures: 0 };
}

/** The upper bound (exclusive of jitter) of the delay after `failures`
 * consecutive unsuccessful attempts since the last success (a lost
 * connection counts as one): 1 s, then 2 s, 4 s... up to the cap. Boot and
 * a drop share the schedule. */
export function backoffCeilingMs(failures: number): number {
  return Math.min(BACKOFF.capMs, BACKOFF.baseMs * 2 ** Math.min(Math.max(failures - 1, 0), 30));
}

const NONE: PolicyAction = { kind: "none" };

export function stepPolicy(
  state: PolicyState,
  input: PolicyInput,
  random: () => number,
): { state: PolicyState; action: PolicyAction } {
  const wait = (failures: number) => ({
    state: { kind: "waiting", failures } as const,
    action: { kind: "wait", delayMs: Math.floor(random() * backoffCeilingMs(failures)) } as const,
  });
  switch (state.kind) {
    case "connecting":
      if (input === "succeeded") return { state: { kind: "connected", failures: 0 }, action: NONE };
      if (input === "failed") return wait(state.failures + 1);
      return { state, action: NONE };
    case "connected":
      if (input === "dropped") return wait(1);
      if (input === "wake") return { state, action: { kind: "probe" } };
      return { state, action: NONE };
    case "waiting":
      if (input === "wake") {
        return {
          state: { kind: "connecting", failures: state.failures },
          action: { kind: "attempt" },
        };
      }
      return { state, action: NONE };
  }
}
