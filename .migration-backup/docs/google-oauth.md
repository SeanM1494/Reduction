# Setting up Google sign-in

Everything here is done once, in the Google Cloud console, and produces two
secrets for Replit. Values that have to match something in the code are marked
**must match**; those are the ones worth copying rather than typing.

## 1. Project

<https://console.cloud.google.com> → project picker → **New Project**. Name it
anything (`Reduction` is fine); the name is internal and never shown to users.

## 2. APIs to enable: none

This is the step that usually gets over-done, so to be explicit: **you do not
need to enable any API.** Sign-in reads the user's id, email and name straight
out of the `id_token` returned by the OAuth token endpoint, which needs no API
enabled. The People API is only required if we later want profile data beyond
those claims, and we don't.

## 3. OAuth consent screen

**APIs & Services → OAuth consent screen.**

| Field | Value |
|---|---|
| User type | **External** |
| App name | `Reduction` — this is what the consent screen says the user is signing in to |
| User support email | your address |
| App logo | optional; uploading one triggers brand verification, so skip it for now |
| Application home page | your production URL, once you have one |
| Authorized domains | `replit.app` for a Replit deployment, plus your own domain later. Bare domain only — no scheme, no path, no subdomain |
| Developer contact | your address |

**Scopes:** add exactly these three, no more:

- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

All three are **non-sensitive**, which is why this matters: an app requesting
only these can be published to Production **without going through Google's
verification review**. Adding any sensitive scope changes that, and the review
takes weeks. **Must match** the `SCOPES` constant in `server/lib/google.ts`.

**Test users:** while publishing status is *Testing*, only listed test users can
sign in at all. Add your own Google account, or the first sign-in attempt will
fail with `access_denied` and look like a code bug. Publishing to Production
removes that limit.

## 4. Credentials

**APIs & Services → Credentials → Create Credentials → OAuth client ID.**

- **Application type: Web application.** Not "Single-page app" — the code
  exchange happens server-side with a client secret.
- **Authorized JavaScript origins:** leave empty. Those are for browser-side
  flows; this app never calls Google from the browser.
- **Authorized redirect URIs:** see below. Google matches these **exactly** —
  scheme, host, path, and the absence of a trailing slash all count. A
  mismatch fails with `redirect_uri_mismatch` before the user sees anything.

### The redirect URI

The path is always:

```
/api/auth/google/callback
```

**Must match** `GOOGLE_CALLBACK_PATH` in `server/lib/google.ts`. The full URI is
that path appended to whatever you set as `PUBLIC_BASE_URL`, so the two are
always constructed from the same value and cannot drift.

Register one per environment:

| Environment | Redirect URI |
|---|---|
| Replit dev | `https://<your-dev-host>/api/auth/google/callback` |
| Replit deployment | `https://<your-app>.replit.app/api/auth/google/callback` |
| Production domain | `https://<your-domain>/api/auth/google/callback` |

For the dev host, **copy the origin out of the webview's address bar rather
than guessing the format** — Replit has used several (`<slug>-<user>.replit.dev`
and longer UUID forms), and it can change if the Repl is recreated. If sign-in
suddenly starts failing with `redirect_uri_mismatch` on a Repl that used to
work, a changed dev host is the first thing to check.

You can register all three now; unused entries cost nothing.

## 5. Secrets in Replit

Add these in the Secrets tab — the workspace **and** the deployment separately,
since deployments do not inherit workspace secrets.

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from the credential you just created, ends in `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | from the same credential |
| `PUBLIC_BASE_URL` | the origin for that environment, e.g. `https://your-app.replit.app` — scheme and host only, **no trailing slash and no path** |

`PUBLIC_BASE_URL` is required rather than derived from the request's `Host`
header on purpose: the redirect URI has to match the console byte for byte, and
a header the client controls is no basis for that.

## 6. Checking it worked

With the secrets set, `GET /api/auth/providers` returns:

```json
{ "providers": { "google": true } }
```

If it returns `false`, one of the three values above is missing or empty — the
server treats partial configuration as unconfigured rather than failing halfway
through a sign-in.

Then visit `/api/auth/google/start` and confirm the browser lands on Google's
consent screen with the right app name. Errors come back as a redirect into the
app with a code rather than a JSON page, because this URL is reached by a
top-level navigation:

| `?auth_error=` | Meaning |
|---|---|
| `not_configured` | secrets missing on the server handling the callback |
| `declined` | the user cancelled at the consent screen, or is not a listed test user |
| `bad_callback` | Google returned without a code or state |
| `expired` | the handshake took longer than 10 minutes, or the state was replayed |
| `exchange_failed` | the token exchange or claim validation failed; check server logs |
| `start_failed` | the server could not record the handshake, usually a database problem |
