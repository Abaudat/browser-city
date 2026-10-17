// Story 4.6 (FR144): every spec boots through the real name prompt now. The
// extended `test` below arrives each `page` the way a player does -- it
// types a name into the shell's field and submits the form the moment the
// document exists -- so no spec gets a production bypass and none copies a
// helper. A spec that wants to drive the prompt itself (or must stay a
// visitor) sets `test.use({ arrive: false })`.
import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";

export { expect };

export const ARRIVE_NAME = "Tester";

/** Submits `name` through the prompt as soon as the shell has parsed --
 * the earliest a player could, so it also exercises the submit the bundle
 * has not yet evaluated. */
export async function arriveOnLoad(
  target: Page | BrowserContext,
  name = ARRIVE_NAME,
): Promise<void> {
  await target.addInitScript((typed) => {
    document.addEventListener("DOMContentLoaded", () => {
      const form = document.querySelector<HTMLFormElement>('[data-bc-surface="name-prompt"]');
      const input = form?.querySelector("input");
      if (!form || !input) return;
      input.value = typed;
      form.requestSubmit();
    });
  }, name);
}

/** Types and submits on a page already showing the prompt. */
export async function arriveNow(page: Page, name = ARRIVE_NAME): Promise<void> {
  const input = page.locator('[data-bc-surface="name-prompt"] input');
  await input.waitFor({ state: "visible" });
  await input.fill(name);
  await page.keyboard.press("Enter");
}

/** Installs, before any page script runs, the DEV-only note that this spec
 * assumes the pre-flat start in the shop (`PLAYER_START`). */
async function startInShop(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    (window as { __bcStart?: string }).__bcStart = "shop";
  });
}

export const test = base.extend<{
  arrive: boolean;
  /** Where the player starts: the shop the pre-flat specs assume (default),
   * or the home flat a new character really arrives in. New specs default to
   * `"home"` unless they really need the shop. */
  startAt: "shop" | "home";
  arrivingContexts: undefined;
}>({
  arrive: [true, { option: true }],
  startAt: ["shop", { option: true }],
  // A spec that opens its own contexts (`browser.newContext`) arrives them
  // too: the method is wrapped for the length of the test.
  arrivingContexts: [
    async ({ browser, arrive, startAt }, use) => {
      const original = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await original(options);
        if (startAt === "shop") await startInShop(context);
        if (arrive) await arriveOnLoad(context);
        return context;
      };
      await use(undefined);
      browser.newContext = original;
    },
    { auto: true },
  ],
  page: async ({ page, arrive, startAt }, use) => {
    if (startAt === "shop") await startInShop(page);
    if (arrive) await arriveOnLoad(page);
    await use(page);
  },
});
