# Telegram login: reproduced Load failed and repair

Inspected source and the live deployments on 23 October 2026:

- Frontend: https://quiz-mini-app-rho.vercel.app
- Backend: https://agreeing-washbowl-alarm.ngrok-free.dev

## Confirmed failure

The deployed JavaScript bundle `/assets/index-C0MJjr_U.js` already contained the correct ngrok backend URL, with no localhost fallback. A wrong deployed `VITE_API_URL` was therefore **not** the observed cause.

The existing auth hook already stored `access_token` in sessionStorage after POST `/api/auth/telegram`, then called GET `/api/me`. The original API helper attached `Authorization: Bearer ...`. There was no missing-token assignment in that chain.

The failing hop was reproduced with a browser user agent and independently with clean Chrome on the actual Vercel origin. No real user credentials or initData were used in those probes.

| Live request | Result before bypass/CORS fix |
|---|---|
| GET `/health` from a non-browser HTTP client | 200 JSON |
| Browser-style GET `/api/config` | 200 **ngrok warning HTML**, no `Access-Control-Allow-Origin` |
| Browser-style GET `/api/me` with a deliberately invalid diagnostic token | 200 **ngrok warning HTML**, no `Access-Control-Allow-Origin` |
| GET `/api/config` with `ngrok-skip-browser-warning: true` | 200 JSON, correct Vercel CORS origin |
| GET `/api/me` with bypass and invalid diagnostic token | 401 JSON, correct Vercel CORS origin |
| OPTIONS `/api/auth/telegram` for existing Authorization/Content-Type headers | 200 |
| OPTIONS `/api/me` including the bypass header | **400** until FastAPI allowed that header |

A successful POST and successful ordinary OPTIONS requests do not establish that the subsequent GET reaches FastAPI. Browser CORS rejects the warning response before JavaScript can inspect it; WebKit reports the fetch rejection as `Load failed`. The original hook forwarded that unqualified native message to the login page.

After the CORS code change, the running backend reloaded. Clean Chrome from the actual Vercel origin confirmed: GET `/api/config` without bypass still throws TypeError; with bypass it returns 200 JSON; GET `/api/me` with bypass and no token returns the expected 401 JSON. Thus the browser request path and bypass preflight now work on the backend. The Vercel frontend still needs the updated source deployed.

## Changes

- `frontend/src/services/api.ts`: shared transport applies the warning bypass only to subdomains of `ngrok-free.dev`, `ngrok-free.app`, and legacy `ngrok.io`; retains Authorization and caller headers; preserves multipart boundaries; handles HTTP, failed fetch, HTML/non-JSON and invalid JSON errors separately; handles 401 for downloads/images as well as JSON requests; logs only method, query-free endpoint, status and error code. Downloads share this transport.
- `frontend/src/components/ui.tsx`: protected images use the shared transport, retaining the same UI.
- `frontend/src/hooks/auth.tsx`: retains the Telegram POST → store token → GET `/me` chain; reuses a valid saved session before resubmitting potentially stale initData; attempts fresh Telegram login once for a 401; deduplicates startup auth in React StrictMode; prevents config-fetch errors overwriting the more specific login failure; logs only phase/status/code.
- `frontend/vite.config.ts`: production builds reject absent API URLs, localhost/HTTP URLs and URLs containing credentials/query/fragment. Runtime production no longer falls back to localhost. No dependency added.
- `backend/app/main.py`: explicitly allows `ngrok-skip-browser-warning` in CORS, retaining existing headers/origin restrictions; auth-route logs contain only method/path/status and an Authorization-presence boolean. Telegram HMAC validation and server session verification are unchanged.
- `frontend/playwright.config.ts`: optional isolated test-server URL through `PLAYWRIGHT_BASE_URL`.
- `frontend/tests/api-auth.spec.ts`: desktop/mobile regression tests for ngrok domain scoping, header preservation, Telegram login follow-up `/me`, session restore/expiry, failed GET, safe logs, HTML/JSON/HTTP failures, 401 cleanup, and downloads. These tests use explicitly synthetic mocked responses to isolate browser behavior; live tunnel probes are separate.
- `backend/tests/test_auth.py`: bypass preflight, rejected untrusted origins, valid HMAC login followed by authorized `/me` with DEV_AUTH disabled, and credential-free log checks.
- `backend/tests/test_bot.py`: uses a temporary lock location for the existing duplicate-polling test, avoiding interference with the real bot already running. Production bot behavior is unchanged.

The login page markup/design and all exam/grading features are unchanged. No development authentication was enabled; no token/database secrets were added to frontend code, environment examples or logs. No commits or pushes were made.

## Deploy the repair

In Vercel, set the public, nonsecret build environment variable:

```env
VITE_API_URL=https://agreeing-washbowl-alarm.ngrok-free.dev
```

Redeploy the updated frontend source. Vite replaces this variable at build time; changing an environment variable without a new build does not update an existing bundle. The value is a backend base URL, without an `/api` suffix. Do not put a BOT_TOKEN or database credentials in any VITE-prefixed variable.

Keep the backend running with this exact allowed frontend origin (no trailing slash):

```env
CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173","https://quiz-mini-app-rho.vercel.app"]
DEV_AUTH=false
```

Restart the backend if it is not running with reload. The application must load the updated CORS middleware. An ngrok warning bypass does not bypass Telegram authentication: HMAC, freshness checking, role enforcement and short-lived hashed server sessions remain required.

Production build/check from `frontend/`:

```bash
npm run typecheck
VITE_API_URL=https://agreeing-washbowl-alarm.ngrok-free.dev npm run build
```

Then reopen the Mini App from the Telegram bot for fresh initData. No manual token transfer is needed.

## Verification and remaining visibility

- Backend regression suite: **51 passed, 1 skipped** (PostgreSQL-only concurrency test).
- Focused Chrome regressions: **14 passed**, covering desktop and mobile. Synthetic frontend fixtures are not a claim of live user login.
- Negative production-build checks rejected missing API URL and localhost API URL.
- Live public bundle, browser GET behavior and ngrok preflight were checked as described above.
- `npm run typecheck`: passed.
- `VITE_API_URL=https://agreeing-washbowl-alarm.ngrok-free.dev npm run build`: passed.
- Inspected the emitted JavaScript: correct ngrok URL present, localhost API fallback absent, configured backend bot token and full database URL absent.
- Existing PyMuPDF SWIG deprecation and Zod/Rollup comment warnings are non-failing.
- The isolated frontend QA server was stopped; the user’s backend, bot and tunnels were left running.

A live authorized GET `/api/me` for the user's real Telegram session cannot be certified without that user's browser session. Local API tests do execute valid signed Telegram authentication followed by GET `/me` returning 200 with development auth disabled. After redeployment, if anything remains, capture only: request method and path, status (or failed/canceled), Content-Type and Access-Control-Allow-Origin, whether Authorization is present (boolean only), and safe `[api]`/`[auth]` metadata. Backend `auth_request` lines identify whether `/me` reached FastAPI and its status. Do not send a raw HAR, Authorization header, token value, POST body or raw Telegram initData.

References: [ngrok warning bypass](https://ngrok.com/docs/pricing-limits/free-plan-limits#removing-the-interstitial-page), [Vite build-time environment variables](https://vite.dev/guide/env-and-mode), [Telegram initData validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
