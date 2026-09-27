/** The frame a looping animation shows after `elapsedMS`, at
 * `framesPerSecond` over `frameCount` frames. */
export function loopFrameAt(
  elapsedMS: number,
  framesPerSecond: number,
  frameCount: number,
): number {
  return Math.floor((elapsedMS / 1000) * framesPerSecond) % frameCount;
}
