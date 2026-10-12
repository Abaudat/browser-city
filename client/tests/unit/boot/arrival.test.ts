// The arrival state machine (story 4.6, FR144/FR145): when the name prompt
// gives way to the world, and that a submit is sent exactly once -- held
// before the connection exists, never dropped, never duplicated.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Arrival, createArrival } from "../../../src/boot/arrival";

interface Probe {
  arrival: Arrival;
  created: string[];
  opened: number;
  reopened: (string | undefined)[];
  submittedAt: number[];
  settle: (ok: boolean) => void;
}

function probe(needsPrompt = true): Probe {
  const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const p: Probe = {
    created: [],
    opened: 0,
    reopened: [],
    submittedAt: [],
    settle: (ok) => {
      const next = pending.shift();
      if (!next) return;
      if (ok) next.resolve();
      else next.reject(new Error("refused"));
    },
    arrival: undefined as unknown as Arrival,
  };
  p.arrival = createArrival({
    needsPrompt,
    create: (name) => {
      p.created.push(name);
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    },
    open: () => {
      p.opened += 1;
    },
    reopen: (name) => {
      p.reopened.push(name);
    },
    onSubmitted: (at) => {
      p.submittedAt.push(at);
    },
  });
  return p;
}

describe("arrival", () => {
  it("opens when the scene is ready and the name was submitted, never before", () => {
    const p = probe();
    p.arrival.sceneReady();
    expect(p.opened).toBe(0);
    p.arrival.submit("Sam", 5);
    expect(p.opened).toBe(1);
    expect(p.submittedAt).toEqual([5]);
  });

  it("holds a submit made before the scene is ready, and opens when it is", () => {
    const p = probe();
    p.arrival.submit("Sam", 5);
    expect(p.opened).toBe(0);
    p.arrival.sceneReady();
    expect(p.opened).toBe(1);
  });

  it("holds a submit made before the connection exists and sends it once on connect", () => {
    const p = probe();
    p.arrival.submit("Sam", 1);
    expect(p.created).toEqual([]);
    p.arrival.setConnected(true);
    p.arrival.setConnected(true);
    expect(p.created).toEqual(["Sam"]);
  });

  it("never sends twice for one submit, whatever else happens", () => {
    const p = probe();
    p.arrival.setConnected(true);
    p.arrival.submit("Sam", 1);
    p.arrival.submit("Sam", 2);
    p.arrival.setConnected(false);
    p.arrival.setConnected(true);
    expect(p.created).toEqual(["Sam"]);
  });

  it("a returning player opens on the first frame with nothing to submit", () => {
    const p = probe(false);
    p.arrival.sceneReady();
    expect(p.opened).toBe(1);
    expect(p.created).toEqual([]);
  });

  it("opens for a player whose character is already known, without a submit", () => {
    const p = probe();
    p.arrival.sceneReady();
    p.arrival.characterKnown();
    expect(p.opened).toBe(1);
  });

  it("a server refusal puts the player back in the prompt with their text intact", async () => {
    const p = probe();
    p.arrival.setConnected(true);
    p.arrival.sceneReady();
    p.arrival.submit("Sam", 1);
    expect(p.opened).toBe(1);
    p.settle(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(p.reopened).toEqual(["Sam"]);
    p.arrival.submit("Sam2", 9);
    expect(p.created).toEqual(["Sam", "Sam2"]);
    expect(p.opened).toBe(2);
  });

  it("a stored flag whose identity reaches no character asks again", () => {
    const p = probe(false);
    p.arrival.sceneReady();
    expect(p.opened).toBe(1);
    p.arrival.characterAbsent();
    expect(p.reopened).toEqual([undefined]);
    p.arrival.submit("Sam", 3);
    expect(p.opened).toBe(2);
  });

  it("asks again even when that is learned before the first frame", () => {
    const p = probe(false);
    p.arrival.characterAbsent();
    expect(p.reopened).toEqual([undefined]);
    p.arrival.sceneReady();
    expect(p.opened).toBe(0);
  });

  it("is a no-op to report a character absent once one is known", () => {
    const p = probe(false);
    p.arrival.sceneReady();
    p.arrival.characterKnown();
    p.arrival.characterAbsent();
    expect(p.reopened).toEqual([]);
  });

  it("property: over any interleaving, a name is sent at most once and never before connect", () => {
    const event = fc.constantFrom(
      "submit",
      "connect",
      "disconnect",
      "scene",
      "known",
      "absent",
      "ok",
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), fc.boolean(), (events, needsPrompt) => {
        const p = probe(needsPrompt);
        let connectedYet = false;
        let n = 0;
        for (const e of events) {
          if (e === "submit") p.arrival.submit(`n${n++}`, n);
          else if (e === "connect") {
            connectedYet = true;
            p.arrival.setConnected(true);
          } else if (e === "disconnect") p.arrival.setConnected(false);
          else if (e === "scene") p.arrival.sceneReady();
          else if (e === "known") p.arrival.characterKnown();
          else if (e === "absent") p.arrival.characterAbsent();
          else p.settle(true);
          if (!connectedYet) expect(p.created).toEqual([]);
        }
        expect(p.created.length).toBeLessThanOrEqual(1);
      }),
    );
  });
});
