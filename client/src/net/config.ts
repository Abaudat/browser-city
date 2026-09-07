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
