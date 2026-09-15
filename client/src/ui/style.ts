// The one injected-`<style>` mechanism every DOM UI surface shares
// (Tim's direction, story 1.11) -- pulled out of `options-menu.ts`, which
// grew it first, so a second surface never copies it by hand.

/** Appends a `<style>` element to `doc.head` exactly once per `id`,
 * however many times this is called (mounting the same surface twice, or
 * mounting two different surfaces that both call `ensureUiTheme`). */
export function ensureStyle(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = css;
  doc.head.appendChild(style);
}
