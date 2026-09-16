// The registry's own contract suite (story 1.12, AC5 -- Quentin's
// direction): every registered overlay is run through the same checks,
// table-driven off the registry itself, so Epic-later navmesh, chunk and
// citizen-route overlays inherit all of this the day they are added --
// with one line in `overlays.ts`'s list and no new test file.
//
// Deliberately framework-free: it returns the violations it found rather
// than asserting, so it is a plain, fully covered module under
// `src/debug/**` rather than test code that happens to live in `src/`.
// `client/tests/unit/debug/overlay-conformance.test.ts` is what turns an
// empty return into a green test.
//
// It drives the *real* mount, not a stand-in: "disable leaves nothing
// behind" is a claim about elements that actually reached a document.

import { DEBUG_PALETTE } from "./debug-style";

/** What the suite needs to exercise an overlay end to end -- satisfied by
 * `overlays.ts`'s own `DebugOverlaysHandle`. */
export interface ConformanceTarget {
  list(): readonly { readonly id: string; readonly label: string; readonly enabled: boolean }[];
  enable(id: string): boolean;
  disable(id: string): boolean;
  toggle(id: string): boolean;
  redraw(): void;
  /** The root every element an overlay draws lives under. */
  readonly root: SVGSVGElement;
}

function groupOf(target: ConformanceTarget, id: string): SVGGElement | null {
  return target.root.querySelector<SVGGElement>(`[data-bc-debug="${id}"]`);
}

function elementsOf(target: ConformanceTarget, id: string): readonly Element[] {
  const group = groupOf(target, id);
  return group ? [...group.querySelectorAll("*")] : [];
}

/** Every colour any element under `id`'s group paints with, `"none"`
 * excluded (an unpainted stroke or fill is not a colour). */
function coloursOf(target: ConformanceTarget, id: string): readonly string[] {
  const colours: string[] = [];
  for (const element of elementsOf(target, id)) {
    for (const attribute of ["stroke", "fill"]) {
      const value = element.getAttribute(attribute);
      if (value && value !== "none") colours.push(value);
    }
  }
  return colours;
}

/**
 * Runs every registered overlay through the whole contract and returns
 * one message per violation -- empty means conformant.
 *
 * `target` must be freshly mounted with nothing enabled: the first check
 * is that a debug tool is off until somebody asks for it.
 */
export function checkOverlayConformance(target: ConformanceTarget): string[] {
  const problems: string[] = [];
  const entries = target.list();

  if (entries.length === 0) {
    problems.push("no overlay is registered at all -- the registry is the only way one exists");
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      problems.push(`${entry.id}: two overlays share this id`);
    }
    seen.add(entry.id);
    if (entry.label.trim() === "") {
      problems.push(`${entry.id}: has no label, so no reader can tell what it shows`);
    }
    if (entry.enabled) {
      problems.push(`${entry.id}: is on before anything asked for it -- overlays start off`);
    }
  }

  for (const entry of entries) {
    const { id } = entry;

    if (groupOf(target, id)) {
      problems.push(`${id}: has a group on the page while disabled`);
    }

    if (!target.enable(id)) {
      problems.push(`${id}: the registry does not know its own registered id`);
      continue;
    }
    target.redraw();
    if (!groupOf(target, id)) {
      problems.push(`${id}: enabling it drew no group of its own`);
    }
    const afterFirst = elementsOf(target, id).length;

    // Idempotent: enabling an enabled overlay, and redrawing an
    // unchanged world, must not accumulate a second copy of everything.
    target.enable(id);
    target.redraw();
    if (elementsOf(target, id).length !== afterFirst) {
      problems.push(
        `${id}: redrawing changed its element count (${afterFirst} -> ${elementsOf(target, id).length}) with nothing else changed`,
      );
    }

    // Non-diegetic style, checked rather than eyeballed: every colour an
    // overlay paints with comes from the one shared palette.
    for (const colour of coloursOf(target, id)) {
      if (!DEBUG_PALETTE.includes(colour)) {
        problems.push(`${id}: paints with '${colour}', which is not in DEBUG_STYLE's palette`);
      }
    }

    // No leak across toggles: disabling takes away everything enabling
    // put there.
    target.disable(id);
    target.redraw();
    if (groupOf(target, id)) {
      problems.push(`${id}: disabling it left its group (and ${afterFirst} elements) behind`);
    }
    target.disable(id);
    if (target.list().find((e) => e.id === id)?.enabled) {
      problems.push(`${id}: disabling twice left it enabled`);
    }

    // And the same through `toggle`, which is what a devtools console
    // actually reaches for.
    target.toggle(id);
    target.redraw();
    if (!groupOf(target, id)) {
      problems.push(`${id}: toggling it on drew no group`);
    }
    target.toggle(id);
    target.redraw();
    if (groupOf(target, id)) {
      problems.push(`${id}: toggling it back off left its group behind`);
    }
  }

  return problems;
}
