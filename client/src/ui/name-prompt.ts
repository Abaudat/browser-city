// Story 4.6 (FR144): the name prompt. Its markup and its CSS live in
// `index.html`, so it exists -- and takes typing -- before any module has
// run; this module only *adopts* that element (the one exception to
// `mountX`, because mounting a second copy would be a second prompt). It
// validates with the server's own rule, replays a submit the shell's inline
// script held, and removes the prompt when the world is ready. It never
// draws an error: an empty or refused submit simply keeps focus.

import { planName } from "../identity/name-rule";

/** What the shell's inline script leaves on the form when a submit
 * arrives before this module has evaluated. */
interface HeldSubmit {
  readonly name: string;
  readonly at: number;
}
type PromptForm = HTMLFormElement & { bcSubmitted?: HeldSubmit };

export interface NamePromptOptions {
  /** The longest name; defaults to the field's own `maxlength`, which
   * `tests/unit/identity/shell-contract.test.ts` pins to `defs`'
   * `name_max_chars`. */
  readonly maxChars?: number;
  /** A valid name was submitted; `at` is when the player committed it
   * (ms since navigation). */
  readonly onSubmit: (name: string, at: number) => void;
}

export interface NamePromptHandle {
  /** The prompt is gone: the world replaces it in one cut. */
  remove(): void;
  /** The prompt is back, with `name` in it when given. */
  reopen(name?: string): void;
  /** Detach listeners; leaves the element as it is. */
  destroy(): void;
}

const SELECTOR = '[data-bc-surface="name-prompt"]';

/** Adopts the shell's prompt, or `undefined` when the document has none. */
export function adoptNamePrompt(
  doc: Document,
  options: NamePromptOptions,
): NamePromptHandle | undefined {
  const form = doc.querySelector<PromptForm>(SELECTOR);
  const input = form?.querySelector<HTMLInputElement>("input");
  if (!form || !input) return undefined;
  const root = doc.documentElement;

  const submit = (raw: string, at: number): void => {
    const result = planName(raw, options.maxChars ?? input.maxLength);
    if (!result.ok) {
      // Silent: the field's own state is the explanation.
      input.disabled = false;
      input.focus();
      return;
    }
    input.disabled = true;
    options.onSubmit(result.name, at);
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const held = form.bcSubmitted;
    form.bcSubmitted = undefined;
    if (held) submit(held.name, held.at);
    else if (!input.disabled) submit(input.value, performance.now());
  };
  form.addEventListener("submit", onSubmit);

  // A submit the shell held before this module existed.
  if (form.bcSubmitted) {
    const held = form.bcSubmitted;
    form.bcSubmitted = undefined;
    queueMicrotask(() => submit(held.name, held.at));
  }

  return {
    remove: () => {
      form.remove();
    },
    reopen: (name) => {
      root.removeAttribute("data-bc-returning");
      if (!form.isConnected) doc.body.append(form);
      if (name !== undefined) input.value = name;
      input.disabled = false;
      input.focus();
    },
    destroy: () => {
      form.removeEventListener("submit", onSubmit);
    },
  };
}
