// A disposable local OIDC issuer for the e2e harness (story 4.5): plain
// Node `http` and `crypto`, an ephemeral RSA key generated per run, the
// discovery document, the JWKS, an auto-consenting authorize endpoint and a
// token endpoint -- the whole authorization-code-with-PKCE shape
// `oidc-client-ts` drives. No dependency, no real provider is ever
// contacted from CI, and no secret is needed: the key never leaves this
// process. Every login is the same subject until a spec changes it with
// `POST /admin/subject?sub=<value>`, so the OIDC identity (issuer + subject)
// is the same one on every device, as a real account is -- and a spec that
// picks its own subject shares no account with any other.
//
// `POST /admin/audience?aud=<value>` makes later ID tokens carry that
// audience instead of the client id (a token minted for another
// application); `POST /admin/audience` with no value restores it.

import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";

const KID = "e2e-key";

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export async function startLocalOidcIssuer({ port, clientId }) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: KID,
    use: "sig",
    alg: "RS256",
  };
  const issuer = `http://127.0.0.1:${port}`;
  const codes = new Map();
  let audienceOverride = null;
  let subject = "e2e-player";

  function idToken(nonce) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
    const payload = b64url(
      JSON.stringify({
        iss: issuer,
        sub: subject,
        aud: audienceOverride ?? clientId,
        iat: now,
        exp: now + 3600,
        ...(nonce ? { nonce } : {}),
      }),
    );
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
    return `${header}.${payload}.${b64url(signature)}`;
  }

  function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  function json(res, body) {
    cors(res);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    if (req.method === "OPTIONS") {
      cors(res);
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === "/.well-known/openid-configuration") {
      json(res, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (url.pathname === "/jwks") {
      json(res, { keys: [jwk] });
      return;
    }
    if (url.pathname === "/authorize") {
      // Auto-consent: straight back to the game with a one-time code.
      const redirect = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirect || !state || url.searchParams.get("client_id") !== clientId) {
        res.statusCode = 400;
        res.end("bad authorize request");
        return;
      }
      const code = randomBytes(16).toString("hex");
      codes.set(code, url.searchParams.get("nonce"));
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", state);
      res.statusCode = 302;
      res.setHeader("Location", back.toString());
      res.end();
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const code = form.get("code") ?? "";
        if (!codes.has(code)) {
          cors(res);
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        const nonce = codes.get(code);
        codes.delete(code);
        json(res, {
          access_token: randomBytes(8).toString("hex"),
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken(nonce),
        });
      });
      return;
    }
    if (url.pathname === "/admin/subject" && req.method === "POST") {
      subject = url.searchParams.get("sub") ?? "e2e-player";
      json(res, { subject });
      return;
    }
    if (url.pathname === "/admin/audience" && req.method === "POST") {
      audienceOverride = url.searchParams.get("aud");
      json(res, { audience: audienceOverride });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { issuer, close: () => server.close() };
}
