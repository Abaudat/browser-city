// Story 4.6 (FR144/FR145): when the name prompt gives way to the world.
// Pure: no DOM, no `net/`. The prompt is the page; the world streams behind
// it, and submitting only opens a gate. The gate opens when the scene's
// first frame is up *and* there is nothing left to ask -- the name was
// submitted, the character is already known, or this page is a returning
// player's. The submit is held until the connection exists and is sent
// exactly once; a server refusal returns the player to the prompt with
// what they typed.

export interface ArrivalDeps {
  /** The prompt is on screen: no stored arrival flag. */
  readonly needsPrompt: boolean;
  /** The `create_character(name)` call. Never awaited by the gate. */
  readonly create: (name: string) => Promise<void>;
  /** The prompt is gone and the body is the player's to drive. */
  readonly open: () => void;
  /** The prompt is back, with `name` in it when there was one. */
  readonly reopen: (name: string | undefined) => void;
  /** The name was submitted at `at` (ms since navigation). */
  readonly onSubmitted: (at: number) => void;
}

export interface Arrival {
  submit(name: string, at: number): void;
  setConnected(connected: boolean): void;
  /** `my_character` delivered a row. */
  characterKnown(): void;
  /** The first subscription applied and `my_character` is empty. */
  characterAbsent(): void;
  /** The scene's first frame rendered. */
  sceneReady(): void;
}

export function createArrival(deps: ArrivalDeps): Arrival {
  let needsPrompt = deps.needsPrompt;
  let connected = false;
  let character = false;
  let scene = false;
  let opened = false;
  let name: string | undefined;
  let sent = false;

  const settle = (): void => {
    if (opened || !scene) return;
    if (needsPrompt && name === undefined && !character) return;
    opened = true;
    deps.open();
  };

  const flush = (): void => {
    if (!connected || sent || name === undefined) return;
    sent = true;
    const sentName = name;
    deps.create(sentName).catch(() => {
      // Refused: back to the prompt, text intact, free to submit again.
      if (character) return;
      sent = false;
      name = undefined;
      opened = false;
      needsPrompt = true;
      deps.reopen(sentName);
    });
  };

  return {
    submit: (value, at) => {
      if (name !== undefined || character) return;
      name = value;
      deps.onSubmitted(at);
      flush();
      settle();
    },
    setConnected: (value) => {
      connected = value;
      flush();
    },
    characterKnown: () => {
      character = true;
      settle();
    },
    characterAbsent: () => {
      if (character || name !== undefined) return;
      if (needsPrompt && !opened) return;
      needsPrompt = true;
      opened = false;
      deps.reopen(undefined);
    },
    sceneReady: () => {
      scene = true;
      settle();
    },
  };
}
