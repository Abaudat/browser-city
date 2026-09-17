// Story 2.8 (FR147), cycle 2 review (Quentin's finding 1): closes the gap
// between the boot gate settling and `main.ts` wiring up the post-mount
// guard. `runBootGate` alone can only compare against whatever the
// handshake had settled to by the time its own internal awaits
// (`fetchDefs`, a refetch) resolve; a version that changed during one of
// those awaits is otherwise mounted unverified. `runBootSequence` builds
// the post-mount guard immediately once the gate resolves and replays
// `handshake.latest()` -- the most recent version the connection has
// ever reported, tracked regardless of settlement (`handshake-latch.ts`)
// -- through it exactly once, synchronously, before returning anything
// to mount. The only `await` in this function is `runBootGate`'s own;
// nothing else can run between that resolving and the replay happening.
// `main.ts` must still register the returned guard for the rest of the
// session with no further `await` in between, to keep this gap closed
// all the way to the first mounted frame.

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
   * degrade, never after. */
  stopDrawing(): void;
}

export interface BootSequenceResult {
  readonly defs: BootGateResult["defs"];
  /** Wire this to every later handshake version for the rest of the
   * session (`net/connection.ts`'s own `onHandshake`) -- already caught
   * up with whatever arrived during the gate's own internal awaits. */
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

  const latest = deps.handshake.latest();
  if (latest && guard.onHandshake(latest)) {
    // The replay itself found a mismatch and already stopped drawing,
    // then reloaded or degraded -- nothing left to mount.
    return undefined;
  }

  return { defs: result.defs, guard };
}
