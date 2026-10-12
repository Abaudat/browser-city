// @vitest-environment jsdom
// Story 4.6 (FR144): the name prompt is the shell's own markup, adopted by
// the bundle. These tests run the real `index.html` body and its real
// inline script, so the shell and the module cannot drift apart.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoptNamePrompt } from "../../../src/ui/name-prompt";

const INDEX = readFileSync(`${process.cwd()}/index.html`, "utf8");

/** The shell's classic inline script: the one without `type="module"`. */
function inlineScript(): string {
  const scripts = [...INDEX.matchAll(/<script(?![^>]*\btype="module")[^>]*>([\s\S]*?)<\/script>/g)];
  return (scripts[0] as RegExpMatchArray)[1] as string;
}

function loadShell(): void {
  const body = INDEX.slice(INDEX.indexOf("<body>") + 6, INDEX.indexOf("</body>"));
  const markup = body.replace(/<script[\s\S]*?<\/script>/g, "");
  document.body.innerHTML = markup;
  document.documentElement.removeAttribute("data-bc-returning");
  new Function(inlineScript())();
}

function type(text: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('[data-bc-surface="name-prompt"] input');
  if (!input) throw new Error("no prompt");
  input.value = text;
  return input;
}

function press(): void {
  document
    .querySelector<HTMLFormElement>('[data-bc-surface="name-prompt"]')
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
  loadShell();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("the shell prompt", () => {
  it("is one form with one text field and nothing else to read", () => {
    const form = document.querySelector('[data-bc-surface="name-prompt"]') as HTMLElement;
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(form.textContent?.trim()).toBe("");
    expect(form.querySelector("input")?.getAttribute("placeholder")).toBe("Your name");
  });

  it("holds a submit made before the bundle exists, and the adopter replays it", async () => {
    type("  Sam  ");
    press();
    const form = document.querySelector("form") as HTMLFormElement & { bcSubmitted?: unknown };
    expect(form.bcSubmitted).toBeDefined();
    const got: [string, number][] = [];
    adoptNamePrompt(document, { maxChars: 24, onSubmit: (n, at) => got.push([n, at]) });
    await Promise.resolve();
    expect(got).toHaveLength(1);
    expect(got[0]?.[0]).toBe("Sam");
    expect(got[0]?.[1]).toBeGreaterThan(0);
    expect((document.querySelector("input") as HTMLInputElement).disabled).toBe(true);
  });

  it("an empty submit does nothing and keeps the field editable", async () => {
    const got: string[] = [];
    adoptNamePrompt(document, { maxChars: 24, onSubmit: (n) => got.push(n) });
    type("   ");
    press();
    await Promise.resolve();
    expect(got).toEqual([]);
    expect((document.querySelector("input") as HTMLInputElement).disabled).toBe(false);
  });

  it("submits through the adopter once the bundle is up, disabling the field", () => {
    const got: string[] = [];
    adoptNamePrompt(document, { maxChars: 24, onSubmit: (n) => got.push(n) });
    type("Zoë");
    press();
    expect(got).toEqual(["Zoë"]);
    expect((document.querySelector("input") as HTMLInputElement).disabled).toBe(true);
  });

  it("a name the rule refuses is never submitted and shows no message", () => {
    const got: string[] = [];
    adoptNamePrompt(document, { maxChars: 24, onSubmit: (n) => got.push(n) });
    type("a".repeat(30));
    press();
    expect(got).toEqual([]);
    expect(document.body.textContent?.replace(/\s+/g, " ").trim()).toBe("");
  });

  it("is removed in one cut and comes back with the text intact", () => {
    const handle = adoptNamePrompt(document, { maxChars: 24, onSubmit: () => {} });
    type("Sam");
    handle?.remove();
    expect(document.querySelector('[data-bc-surface="name-prompt"]')).toBeNull();
    handle?.reopen("Sam");
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Sam");
    expect(input.disabled).toBe(false);
  });

  it("returns undefined when the document has no prompt", () => {
    document.body.innerHTML = "";
    expect(adoptNamePrompt(document, { maxChars: 24, onSubmit: () => {} })).toBeUndefined();
  });
});

describe("the returning player", () => {
  it("is marked before first paint by the inline script when the flag is present", () => {
    localStorage.setItem("bc.arrived.v1", "1");
    loadShell();
    expect(document.documentElement.hasAttribute("data-bc-returning")).toBe(true);
  });

  it("is not marked without the flag", () => {
    expect(document.documentElement.hasAttribute("data-bc-returning")).toBe(false);
  });

  it("reopening shows the prompt again", () => {
    localStorage.setItem("bc.arrived.v1", "1");
    loadShell();
    const handle = adoptNamePrompt(document, { maxChars: 24, onSubmit: () => {} });
    handle?.reopen();
    expect(document.documentElement.hasAttribute("data-bc-returning")).toBe(false);
  });
});
