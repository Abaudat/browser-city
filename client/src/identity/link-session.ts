// Story 4.5 (FR143): the two moments of a link, with every effect injected.
// `offerLink` stores a one-time code on the server and sends the page to the
// provider; `resumeLinkIfPending` runs when the page boots back from the
// provider, strips the callback parameters, and redeems the code on a
// second connection as the OIDC identity. The OIDC library is reached only
// through `loadFlow` (a dynamic import), so a boot with nothing pending
// loads none of it.

import type { OidcConfig } from "../net/config";

type LinkFlow = typeof import("./link-flow");

export interface ResumeDeps {
  readonly config: OidcConfig | null;
  readonly search: string;
  readonly href: string;
  readonly redirectUri: string;
  readonly loadFlow: () => Promise<Pick<LinkFlow, "stripLinkCallback" | "finishLink">>;
  readonly completeLink: (idToken: string, code: string) => Promise<void>;
  readonly replaceUrl: (url: string) => void;
}

export type ResumeOutcome = "none" | "linked" | "failed";

/** The cheap pre-check, before the flow chunk is worth loading. */
function looksLikeCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") && params.has("state");
}

export async function resumeLinkIfPending(deps: ResumeDeps): Promise<ResumeOutcome> {
  if (!deps.config || !looksLikeCallback(deps.search)) return "none";
  try {
    const flow = await deps.loadFlow();
    const finished = await flow.finishLink(deps.config, deps.href, deps.redirectUri);
    deps.replaceUrl(flow.stripLinkCallback(deps.href));
    if (!finished) return "failed";
    await deps.completeLink(finished.idToken, finished.code);
    return "linked";
  } catch (error: unknown) {
    console.error("[identity] link was not completed", error);
    return "failed";
  }
}

export interface OfferDeps {
  readonly config: OidcConfig | null;
  readonly redirectUri: string;
  readonly loadFlow: () => Promise<Pick<LinkFlow, "startLink">>;
  readonly newCode: () => string;
  /** Resolves once the server has stored the code. */
  readonly beginLink: (code: string) => Promise<void>;
}

/** Rejects, without leaving the page, when the server refuses the code. */
export async function offerLink(deps: OfferDeps): Promise<void> {
  if (!deps.config) return;
  const code = deps.newCode();
  await deps.beginLink(code);
  const flow = await deps.loadFlow();
  await flow.startLink(deps.config, code, deps.redirectUri);
}
