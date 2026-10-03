// How a remote player is drawn (story 4.4, FR138): a small bounded buffer of
// samples per character, sampled at the server clock minus the interpolation
// delay, linear between the two samples that bracket that instant. Samples
// are spaced by the server's `updated_at`, never by arrival time, so arrival
// jitter does not show. Past the newest sample the position holds -- it is
// never extrapolated.
//
// A gap longer than two send periods is a pause: the older position holds
// until one period before the newer sample, so a player who starts walking
// does not pop. A floor change, or a jump beyond `REMOTE_SNAP_CELLS`, snaps
// when the newer sample's time comes.

/** A jump longer than this many cells is a teleport, never a glide. */
export const REMOTE_SNAP_CELLS = 8;

/** Samples kept per character. */
export const REMOTE_MAX_SAMPLES = 16;

/** The rendered speed of a remote walker may exceed the walk speed by this
 * fraction, for stamp jitter and the quantum. */
export const REMOTE_SPEED_TOLERANCE = 0.5;

/** The delay is never shorter than this many send periods, so two samples
 * bracket the drawn instant at any rate on the dial. */
export const REMOTE_DELAY_PERIODS = 2;

export function remoteDelayMs(periodMs: number, delayKeyMs: number): number {
  return Math.max(delayKeyMs, REMOTE_DELAY_PERIODS * periodMs);
}

export interface RemoteMotionConfig {
  readonly periodMs: number;
  /** Already at least `REMOTE_DELAY_PERIODS` periods (`remoteDelayMs`). */
  readonly delayMs: number;
  readonly snapCells: number;
  readonly maxSamples: number;
}

export interface RemoteSample {
  /** The server's stamp of the write, in ms. */
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export interface RemotePose {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export class RemoteMotion {
  private readonly buffers = new Map<string, RemoteSample[]>();

  constructor(private readonly config: RemoteMotionConfig) {}

  /** A new sample, in place for an insert and appended for an update; a
   * sample for a stamp already held replaces it. */
  upsert(id: string, sample: RemoteSample): void {
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = [];
      this.buffers.set(id, buf);
    }
    let at = buf.length;
    while (at > 0 && buf[at - 1].tMs > sample.tMs) at--;
    if (at > 0 && buf[at - 1].tMs === sample.tMs) buf[at - 1] = sample;
    else buf.splice(at, 0, sample);
    if (buf.length > this.config.maxSamples) buf.splice(0, buf.length - this.config.maxSamples);
  }

  remove(id: string): void {
    this.buffers.delete(id);
  }

  ids(): string[] {
    return [...this.buffers.keys()];
  }

  bufferedSamples(id: string): number {
    return this.buffers.get(id)?.length ?? 0;
  }

  /** Where `id` is drawn when the server clock reads `serverNowMs`. */
  poseAt(id: string, serverNowMs: number): RemotePose | undefined {
    const buf = this.buffers.get(id);
    if (!buf || buf.length === 0) return undefined;
    const t = serverNowMs - this.config.delayMs;
    const first = buf[0];
    const last = buf[buf.length - 1];
    if (t <= first.tMs) return pose(first);
    if (t >= last.tMs) return pose(last);
    let i = 0;
    while (buf[i + 1].tMs <= t) i++;
    // Samples before the bracket can never be drawn again.
    if (i > 0) buf.splice(0, i);
    const a = buf[0];
    const b = buf[1];
    if (a.floor !== b.floor) return pose(a);
    if (Math.hypot(b.x - a.x, b.y - a.y) > this.config.snapCells) return pose(a);
    const gap = b.tMs - a.tMs;
    const start = gap > REMOTE_DELAY_PERIODS * this.config.periodMs ? b.tMs - this.config.periodMs : a.tMs;
    if (t < start) return pose(a);
    const u = (t - start) / (b.tMs - start);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, floor: a.floor };
  }
}

function pose(s: RemoteSample): RemotePose {
  return { x: s.x, y: s.y, floor: s.floor };
}
