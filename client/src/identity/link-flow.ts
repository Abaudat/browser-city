// Story 4.5 (FR143): the OIDC half of linking, authorization code with PKCE
// through `oidc-client-ts`. Loaded by dynamic import only, when a link
// starts or the page boots with a pending callback, so the anonymous boot
// path pays nothing for it. Full-page redirect only (no popup, no iframe,
// no silent renew); no user is kept and the ID token is never stored.
// Never logs: it handles credentials.

import { InMemoryWebStorage, UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { OidcConfig } from "../net/config";

function manager(config: OidcConfig, redirectUri: string): UserManager {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  });
}

/** Whether `search` is a provider redirect back to the game. */
export function hasLinkCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") && params.has("state");
}

/** Sends the whole page to the provider; the link code travels in the
 * library's own state, never to the provider. */
export async function startLink(
  config: OidcConfig,
  code: string,
  redirectUri: string,
): Promise<void> {
  await manager(config, redirectUri).signinRedirect({ state: { code } });
}

export interface FinishedLink {
  readonly idToken: string;
  readonly code: string;
}

/** Completes the redirect. `null` when the provider's answer is refused or
 * carries no code. */
export async function finishLink(
  config: OidcConfig,
  callbackUrl: string,
  redirectUri: string,
): Promise<FinishedLink | null> {
  const m = manager(config, redirectUri);
  try {
    const user = await m.signinRedirectCallback(callbackUrl);
    await m.removeUser();
    const state = user.state as { code?: unknown } | undefined;
    return typeof state?.code === "string" && user.id_token
      ? { idToken: user.id_token, code: state.code }
      : null;
  } catch {
    return null;
  }
}

const CALLBACK_PARAMS = ["code", "state", "session_state", "iss", "error", "error_description"];

/** The path, query and hash to leave in the address bar once the callback
 * parameters are consumed. */
export function stripLinkCallback(href: string): string {
  const url = new URL(href);
  for (const p of CALLBACK_PARAMS) url.searchParams.delete(p);
  return `${url.pathname}${url.search}${url.hash}`;
}
