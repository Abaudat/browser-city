// The only place in this client that creates an SVG element (Tim's
// direction, story 1.12) -- `scripts/ci/check-debug-boundary.sh` fails
// the build if `createElementNS` with the SVG namespace appears anywhere
// under `client/src/` outside `debug/`.
//
// SVG, not Pixi and not a second `<canvas>`: nothing an overlay draws
// enters a floor stack or the y-sorted pool, so the tool that inspects
// the sort can never perturb it; `check-no-canvas-ui.sh` and
// `check-no-masks.sh` stay exactly as they are, because an SVG `<text>`
// is DOM rather than Pixi text; and a Playwright spec asserts on
// elements and attributes instead of diffing pixels.

const SVG_NS = "http://www.w3.org/2000/svg";

/** One SVG element with its attributes set -- numbers stringified here so
 * no caller builds an attribute value by hand. */
export function svgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Readonly<Record<string, string | number>>,
): SVGElementTagNameMap[K] {
  const element = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, typeof value === "number" ? String(value) : value);
  }
  return element;
}

/** Empties a group without replacing it -- a redraw reuses its own group,
 * so an overlay's elements can never accumulate across frames. */
export function clearGroup(group: SVGGElement): void {
  while (group.firstChild) group.removeChild(group.firstChild);
}
