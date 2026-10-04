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

/** The upper bound (exclusive of jitter) of the delay before retry `n`. */
export function backoffCeilingMs(failures: number): number {
  return Math.min(BACKOFF.capMs, BACKOFF.baseMs * 2 ** Math.min(failures, 30));
}

const NONE: PolicyAction = { kind: "none" };

export function stepPolicy(
  state: PolicyState,
  input: PolicyInput,
  random: () => number,
): { state: PolicyState; action: PolicyAction } {
  // `retry` is the zero-based index of the retry being waited for.
  const wait = (failures: number, retry: number) => ({
    state: { kind: "waiting", failures } as const,
    action: { kind: "wait", delayMs: Math.floor(random() * backoffCeilingMs(retry)) } as const,
  });
  switch (state.kind) {
    case "connecting":
      if (input === "succeeded") return { state: { kind: "connected", failures: 0 }, action: NONE };
      if (input === "failed") return wait(state.failures + 1, state.failures);
      return { state, action: NONE };
    case "connected":
      if (input === "dropped") return wait(0, 0);
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
