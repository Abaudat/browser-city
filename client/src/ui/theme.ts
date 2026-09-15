// One shared visual language for every DOM UI surface (Artie's direction,
// story 1.11): system font stack, near-black panel, off-white text, one
// accent colour -- no pixel-font imitation, no frames, no UI sprites. The
// options menu, the connection notice, and later the boot name prompt
// (story 4.6) all pull these same custom properties rather than each
// inventing its own palette.

import { ensureStyle } from "./style";

export const UI_THEME_STYLE_ID = "bc-ui-theme";

const UI_THEME_CSS = `
:root {
  --bc-font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --bc-panel-bg: #14161a;
  --bc-text: #ececec;
  --bc-muted: #8b93a1;
  --bc-border: #2b2f36;
  --bc-accent: #5e9ed6;
  --bc-control-bg: #20242b;
  --bc-control-bg-hover: #272c34;
}
`;

/** Installs the shared custom properties into `doc`, once. Every surface
 * calls this before installing its own, surface-specific stylesheet. */
export function ensureUiTheme(doc: Document): void {
  ensureStyle(doc, UI_THEME_STYLE_ID, UI_THEME_CSS);
}
