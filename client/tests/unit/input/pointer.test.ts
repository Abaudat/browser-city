// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "../../../src/input/intent";
import type { PickContext, PickPlayer } from "../../../src/input/pick";
import { attachPointer, IGNORED_CURSOR_MS } from "../../../src/input/pointer";
import type { FootprintEntry, FootprintQuery } from "../../../src/world/footprint-index";

const SUBCELLS = 16;
const TILE = 16;
const STOREY = 48;

const BIN_DEF = 1;
const PLAIN_DEF = 2;

function entry(overrides: Partial<FootprintEntry> & { objectId: bigint }): FootprintEntry {
  return { defId: BIN_DEF, layer: 20, anchorX: 5, anchorY: 5, ...overrides };
}

/** The bin sits on cell (5, 5) and is reachable from a quarter-cell skirt
 * around it. */
function queryOf(cells: Record<string, FootprintEntry[]>): FootprintQuery {
  return {
    objectsAt: (floor, cellX, cellY) => cells[`${floor}:${cellX}:${cellY}`] ?? [],
  };
}

function contextOf(query: FootprintQuery, isVisible?: (id: bigint) => boolean): PickContext {
  return {
    index: query,
    ...(isVisible ? { isVisible } : {}),
    objectDefs: new Map([
      [BIN_DEF, { width: 1, height: 1, interactAt: { x0: -4, y0: -4, x1: 20, y1: 20 } }],
      [PLAIN_DEF, { width: 1, height: 1 }],
    ]),
    rankOf: () => 20,
    subcellsPerCell: SUBCELLS,
  };
}

const BIN_CELL = { "0:5:5": [entry({ objectId: 100n })] };

interface Harness {
  readonly element: HTMLElement;
  readonly intents: Intent[];
  readonly ignored: bigint[];
  readonly highlights: (bigint | undefined)[];
  cursor(): string;
  setPlayer(next: PickPlayer): void;
  refresh(): void;
  detach(): void;
}

/** Mounts the glue on a bare element with a world-pixel transform that is
 * the identity, so a test can name world pixels directly. */
function harness(
  cells: Record<string, FootprintEntry[]> = BIN_CELL,
  playerAt: PickPlayer = { x: 5.5, y: 5.5, floor: 0 },
  isVisible?: (id: bigint) => boolean,
): Harness {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const intents: Intent[] = [];
  const ignored: bigint[] = [];
  const highlights: (bigint | undefined)[] = [];
  let player = playerAt;

  const pointer = attachPointer({
    element,
    toWorldPx: (clientX, clientY) => ({ x: clientX, y: clientY }),
    context: () => contextOf(queryOf(cells), isVisible),
    player: () => player,
    tileSizePx: TILE,
    storeyHeightPx: STOREY,
    onIntent: (intent) => intents.push(intent),
    onIgnored: (objectId) => ignored.push(objectId),
    onHighlightChange: (objectId) => highlights.push(objectId),
  });

  return {
    element,
    intents,
    ignored,
    highlights,
    cursor: () => element.style.cursor,
    setPlayer: (next) => {
      player = next;
    },
    refresh: pointer.refresh,
    detach: pointer.detach,
  };
}

/** A world pixel inside cell (cx, cy) on floor 0 -- its own centre. */
function pixelInCell(cx: number, cy: number): { clientX: number; clientY: number } {
  return { clientX: cx * TILE + TILE / 2, clientY: cy * TILE + TILE / 2 };
}

function move(h: Harness, cx: number, cy: number): void {
  h.element.dispatchEvent(new MouseEvent("pointermove", { ...pixelInCell(cx, cy) }));
}

function click(h: Harness, cx: number, cy: number): void {
  h.element.dispatchEvent(new MouseEvent("pointerdown", { ...pixelInCell(cx, cy), button: 0 }));
}

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("hover feedback (FR173's grammar)", () => {
  it("an in-reach interactable gets the pointer cursor and the highlight", () => {
    const h = harness();
    move(h, 5, 5);
    expect(h.cursor()).toBe("pointer");
    expect(h.highlights.at(-1)).toBe(100n);
    h.detach();
  });

  it("an out-of-reach interactable gets the cursor but never the highlight", () => {
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    move(h, 5, 5);
    expect(h.cursor()).toBe("pointer");
    expect(h.highlights.at(-1)).toBeUndefined();
    h.detach();
  });

  it("empty ground leaves the cursor alone and highlights nothing", () => {
    const h = harness();
    move(h, 1, 1);
    expect(h.cursor()).toBe("default");
    expect(h.highlights.at(-1)).toBeUndefined();
    h.detach();
  });

  it("a prop that declares no interaction is treated exactly like empty ground", () => {
    const h = harness({ "0:5:5": [entry({ objectId: 200n, defId: PLAIN_DEF })] });
    move(h, 5, 5);
    expect(h.cursor()).toBe("default");
    expect(h.highlights.at(-1)).toBeUndefined();
    h.detach();
  });

  it("reports a highlight change once, not on every mouse move over the same object", () => {
    const h = harness();
    move(h, 5, 5);
    move(h, 5, 5);
    move(h, 5, 5);
    expect(h.highlights).toEqual([100n]);
    h.detach();
  });

  it("clears the highlight when the pointer leaves the canvas", () => {
    const h = harness();
    move(h, 5, 5);
    h.element.dispatchEvent(new MouseEvent("pointerleave"));
    expect(h.highlights.at(-1)).toBeUndefined();
    expect(h.cursor()).toBe("default");
    h.detach();
  });
});

describe("the hover follows the world, not only the mouse", () => {
  // Movement is keyboard-only (FR149), so the normal case is a mouse
  // resting on an object while the player walks. Without a refresh the
  // affordance lies: it stays lit after walking out of reach, and never
  // lights up on walking in.
  it("walking into reach lights the object up with the pointer still", () => {
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    move(h, 5, 5);
    expect(h.highlights.at(-1)).toBeUndefined();
    expect(h.cursor()).toBe("pointer");

    h.setPlayer({ x: 5.5, y: 5.5, floor: 0 });
    h.refresh();
    expect(h.highlights.at(-1)).toBe(100n);
    h.detach();
  });

  it("walking out of reach clears the highlight with the pointer still", () => {
    const h = harness();
    move(h, 5, 5);
    expect(h.highlights.at(-1)).toBe(100n);

    h.setPlayer({ x: 20, y: 20, floor: 0 });
    h.refresh();
    expect(h.highlights.at(-1)).toBeUndefined();
    // Still an interactable object under the cursor, just not from here.
    expect(h.cursor()).toBe("pointer");
    h.detach();
  });

  it("a refresh with the pointer outside the canvas changes nothing", () => {
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    move(h, 5, 5);
    h.element.dispatchEvent(new MouseEvent("pointerleave"));
    const before = h.highlights.length;

    h.setPlayer({ x: 5.5, y: 5.5, floor: 0 });
    h.refresh();
    expect(h.highlights.length).toBe(before);
    expect(h.highlights.at(-1)).toBeUndefined();
    expect(h.cursor()).toBe("default");
    h.detach();
  });

  it("a refresh before the pointer has ever entered the canvas changes nothing", () => {
    const h = harness();
    h.refresh();
    expect(h.highlights).toEqual([]);
    expect(h.cursor()).toBe("");
    h.detach();
  });

  it("an object hidden under a still cursor loses its highlight on refresh", () => {
    const hidden = new Set<bigint>();
    const h = harness(BIN_CELL, { x: 5.5, y: 5.5, floor: 0 }, (id) => !hidden.has(id));
    move(h, 5, 5);
    expect(h.highlights.at(-1)).toBe(100n);

    hidden.add(100n);
    h.refresh();
    expect(h.highlights.at(-1)).toBeUndefined();
    expect(h.cursor()).toBe("default");
    h.detach();
  });

  it("a refresh after detach never writes to the element again", () => {
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    move(h, 5, 5);
    h.detach();
    const cursorAtDetach = h.cursor();
    h.setPlayer({ x: 5.5, y: 5.5, floor: 0 });
    h.refresh();
    expect(h.cursor()).toBe(cursorAtDetach);
  });
});

describe("click feedback", () => {
  it("emits exactly one intent for an in-reach object, and shows nothing else", () => {
    const h = harness();
    move(h, 5, 5);
    click(h, 5, 5);
    expect(h.intents).toEqual([{ objectId: 100n, defId: BIN_DEF }]);
    expect(h.ignored).toEqual([]);
    // No confirmation effect of its own: the cursor is still just the
    // hover cursor.
    expect(h.cursor()).toBe("pointer");
    h.detach();
  });

  it("emits no intent out of reach, reports the ignore, and blips the cursor", () => {
    vi.useFakeTimers();
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    move(h, 5, 5);
    click(h, 5, 5);
    expect(h.intents).toEqual([]);
    expect(h.ignored).toEqual([100n]);
    expect(h.cursor()).toBe("not-allowed");

    // Briefly: it goes back to the hover cursor on its own, and never
    // pulses or flashes in between.
    vi.advanceTimersByTime(IGNORED_CURSOR_MS);
    expect(h.cursor()).toBe("pointer");
    h.detach();
    vi.useRealTimers();
  });

  it("an out-of-reach click never highlights the object it refused", () => {
    vi.useFakeTimers();
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    move(h, 5, 5);
    click(h, 5, 5);
    expect(h.highlights.every((id) => id === undefined)).toBe(true);
    h.detach();
    vi.useRealTimers();
  });

  it("emits nothing at all on empty ground -- no intent and no ignore", () => {
    const h = harness();
    click(h, 1, 1);
    expect(h.intents).toEqual([]);
    expect(h.ignored).toEqual([]);
    h.detach();
  });

  it("ignores a non-primary button, so a right-click never acts", () => {
    const h = harness();
    h.element.dispatchEvent(new MouseEvent("pointerdown", { ...pixelInCell(5, 5), button: 2 }));
    expect(h.intents).toEqual([]);
    h.detach();
  });

  it("detach removes every listener it added", () => {
    const h = harness();
    h.detach();
    click(h, 5, 5);
    move(h, 5, 5);
    expect(h.intents).toEqual([]);
    expect(h.highlights).toEqual([]);
  });

  it("a pending cursor blip is cancelled by detach, never firing afterwards", () => {
    vi.useFakeTimers();
    const h = harness(BIN_CELL, { x: 20, y: 20, floor: 0 });
    click(h, 5, 5);
    expect(h.cursor()).toBe("not-allowed");
    h.detach();
    vi.advanceTimersByTime(IGNORED_CURSOR_MS * 4);
    // Detached: the glue no longer owns this element's cursor, so it must
    // not write to it after the fact.
    expect(h.cursor()).toBe("not-allowed");
    vi.useRealTimers();
  });
});
