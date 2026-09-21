// The camera: a pure, Pixi-free function of the player's own projected
// screen position (`screen-position.ts`'s own projection, floor already
// applied), the viewport size and the zoom -- never a container, never a
// ticker, never a DOM read (Quentin's direction, the camera/viewport
// story). "Centred at all times" is pinned here as no easing and no
// world-edge clamp: `computeCamera` is a pure function of its own three
// inputs, meant to be called fresh every frame a caller wants a centred
// camera. There is no lag, no interpolation and no clamp anywhere in this
// file -- a later story that wants either back names an exported constant
// and widens the property tests' own bound rather than reopening this
// contract silently.

/** The world container's own transform: `zoom` is the uniform scale every
 * world pixel is multiplied by, `offsetX`/`offsetY` is the translation
 * applied after that scale -- the same three numbers `onViewTransform`
 * has always reported. */
export interface Camera {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The camera that puts `(playerScreenX, playerScreenY)` -- a *pre-zoom*
 * world-pixel point, in the same space `screen-position.ts`'s
 * `screenPositionPx` returns -- at the centre of a `viewportWidth x
 * viewportHeight` viewport, at `zoom`.
 *
 * Whole-pixel snapped (`Math.round`): the only rounding this module
 * allows, and the only source of the ≤0.5px slack
 * `inv_camera_centres_player` budgets for -- a fractional camera offset
 * would draw every sprite in the scene half a pixel soft, which
 * `screenPositionPx`'s own whole-pixel discipline for a drawable's
 * *position* already refuses to do.
 */
export function computeCamera(
  playerScreenX: number,
  playerScreenY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): Camera {
  return {
    zoom,
    offsetX: Math.round(viewportWidth / 2 - playerScreenX * zoom),
    offsetY: Math.round(viewportHeight / 2 - playerScreenY * zoom),
  };
}

/** A world-pixel point (the same pre-zoom space [`computeCamera`] takes
 * its player position in) to the client/canvas pixel `camera` draws it
 * at -- the one projection every click, hover and camera-centring
 * computation in this client shares; nothing else re-derives `worldX *
 * zoom + offsetX` by hand. */
export function clientFromWorldPx(
  worldX: number,
  worldY: number,
  camera: Camera,
): { readonly x: number; readonly y: number } {
  return { x: worldX * camera.zoom + camera.offsetX, y: worldY * camera.zoom + camera.offsetY };
}

/** [`clientFromWorldPx`]'s inverse: the world-pixel point a client/canvas
 * pixel falls on, through `camera`. */
export function worldPxFromClient(
  clientX: number,
  clientY: number,
  camera: Camera,
): { readonly x: number; readonly y: number } {
  return {
    x: (clientX - camera.offsetX) / camera.zoom,
    y: (clientY - camera.offsetY) / camera.zoom,
  };
}
