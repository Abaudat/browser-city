// Story 2.8 (FR147), cycle 2 review (Quentin's finding 1): closes the gap
// between the boot gate settling and `main.ts` wiring up the post-mount
// guard. `runBootGate` alone can only compare against whatever the
// handshake had settled to by the time its own internal awaits
// (`fetchDefs`, a refetch) resolve; a version that changed during one of
// those awaits is otherwise mounted unverified. `runBootSequence` builds
// the post-mount guard immediately once the gate resolves and replays
// `handshake.latest()` -- the most recent version the connection has
// ever reported, tracked regardless of settlement (`handshake-latch.ts`)
// -- through it once, synchronously, before returning anything to mount.
// `main.ts` must still register the returned guard for the rest of the
// session with no further `await` in between, to keep this gap closed
// all the way to the first mounted frame.
//
// Cycle 3 review (Quentin's and Tim's converging findings): the first
// replay only closes the gap up to the gate resolving -- `Application.
// init()`'s own await (a WebGPU adapter/device request) is itself real
// async time between that replay and `main.ts` ever being able to wire
// the guard for real, and there may be no renderer at all yet during it
// (`stopDrawing()` reaching into Pixi state can throw before `init()`
// has run `TickerPlugin.init`). This function now takes the caller's own
// `appInitPromise`, awaits it after the first replay, and runs a
// *second* replay once it resolves -- by which point a renderer always
// exists. Either replay's own `stopDrawing()` call is never allowed to
// prevent the reload/degrade that follows it, whether or not it throws
// (`post-mount-guard.ts`'s own try/catch).

import type { BootGateDeps, BootGateResult } from "./boot-gate";
import { runBootGate } from "./boot-gate";
import type { HandshakeVersion } from "./handshake";
import type { HandshakeLatch } from "./handshake-latch";
import { createPostMountGuard, type PostMountGuard } from "./post-mount-guard";

export interface BootSequenceDeps extends Omit<BootGateDeps, "handshake"> {
  /** Unlike `BootGateDeps.handshake`, also exposes `latest()` -- this is
   * the one thing `runBootSequence` reads beyond what `runBootGate`
   * itself needs. */
  readonly handshake: Pick<HandshakeLatch, "settled" | "latest">;
  /** Stops the world from drawing anything further -- shared with
   * `post-mount-guard.ts`'s own deps, called before a reload or a
   * degrade, never after. May be called before a renderer exists (see
   * above); must never throw in a way that stops the reload/degrade that
   * follows it (this module and `post-mount-guard.ts` both guard that
   * regardless, but a null-safe implementation is still expected). */
  stopDrawing(): void;
  /** Resolves once Pixi's own `Application.init()` has -- real async
   * time (a WebGPU adapter/device request) the first replay cannot see
   * past. Awaited here, once, so a version that changes during it is
   * still caught by a second replay before this function ever returns
   * anything to mount. */
  readonly appInitPromise: Promise<unknown>;
}

export interface BootSequenceResult {
  readonly defs: BootGateResult["defs"];
  /** Wire this to every later handshake version for the rest of the
   * session (`net/connection.ts`'s own `onHandshake`) -- already caught
   * up with whatever arrived during the gate's own internal awaits and
   * during `appInitPromise`. */
  readonly guard: PostMountGuard;
}

export async function runBootSequence(
  deps: BootSequenceDeps,
): Promise<BootSequenceResult | undefined> {
  const result = await runBootGate(deps);
  if (!result) return undefined;

  const referenceVersion: HandshakeVersion = {
    defsVersion: result.defs.defsVersion,
    protocolVersion: deps.clientProtocolVersion,
  };
  const guard = createPostMountGuard({
    referenceVersion,
    readReloadedFor: deps.readReloadedFor,
    writeReloadedFor: deps.writeReloadedFor,
    stopDrawing: deps.stopDrawing,
    reload: deps.reload,
    onDegrade: deps.onDegrade,
  });

  const firstReplay = deps.handshake.latest();
  if (firstReplay && guard.onHandshake(firstReplay)) {
    // The first replay itself found a mismatch and already stopped
    // drawing, then reloaded or degraded -- nothing left to mount, and
    // no reason to wait for Application.init() either.
    return undefined;
  }

  await deps.appInitPromise;

  const secondReplay = deps.handshake.latest();
  if (secondReplay && guard.onHandshake(secondReplay)) {
    // A version changed while Application.init() was still pending --
    // caught here, by which point a renderer always exists.
    return undefined;
  }

  return { defs: result.defs, guard };
}
