// No host, port or database name literal belongs anywhere else in client
// source (Tim, story 1.1). Local defaults match `spacetime.json` /
// `spacetime.local.json` at the repository root; production values arrive
// as build-time `VITE_` variables from the deploy workflow.

export interface NetConfig {
  readonly uri: string;
  readonly databaseName: string;
}

export const NET_CONFIG: NetConfig = {
  uri: import.meta.env.VITE_SPACETIME_URI ?? "ws://127.0.0.1:3000",
  databaseName: import.meta.env.VITE_SPACETIME_DB ?? "browser-city",
};

/** Story 4.5 (FR143): the one OIDC provider a player may link, a build-time
 * pair like `NET_CONFIG`. `null` when either is unset: the link offer is
 * then never made. */
export interface OidcConfig {
  readonly authority: string;
  readonly clientId: string;
}

function readOidcConfig(): OidcConfig | null {
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  return authority && clientId ? { authority, clientId } : null;
}

export const OIDC_CONFIG: OidcConfig | null = readOidcConfig();
