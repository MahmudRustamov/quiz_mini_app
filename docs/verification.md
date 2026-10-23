# Executed verification

Verified on 23 October 2026 in this workspace using Python 3.14.2, Node.js 22.23.4, PostgreSQL 17.11, Vite 7.3.7, and installed Google Chrome. Python 3.12 is the documented minimum; this session did not separately execute a Python 3.12 interpreter.

| Check | Executed result |
|---|---|
| `pytest -q` with isolated SQLite databases | **33 passed, 1 skipped** (the skipped test explicitly requires PostgreSQL row locks) |
| Same suite with dedicated PostgreSQL test database | **34 passed** |
| `alembic upgrade head` on real PostgreSQL | Both migrations applied successfully |
| `alembic check` | **No new upgrade operations detected** |
| Python `compileall` and shell `sh -n` | Passed |
| `npm run typecheck` | Passed with TypeScript strict mode |
| `npm run build` | Passed; production assets emitted to `frontend/dist/` |
| Playwright with installed Chrome | **4 passed**: student and teacher workflows on desktop (1440×1000) and mobile (390×844) |
| Desktop/mobile screenshot inspection | Results rendering, charts, typography, navigation and viewport width checked |
| Frontend package installation audit | Zero vulnerabilities reported at installation |

Backend tests cover signed Telegram initData validation, tampering, freshness and production dev-auth rejection; expiring/revocable sessions; local CORS; backend role checks; draft publication requirements; no answer-key exposure; answer saving and revision conflicts; reload/resume; server timer expiry on writes and reads; idempotent and concurrent starts/submissions; cross-user access rejection; 44-question exams with independently graded A/B subparts; deterministic Uzbek written normalization; pending written review; half-point expert scoring, correction audit history and converted-score averaging; missing official-table rejection; nonlinear lookup behavior using a clearly synthetic fixture; exports and statistics; explicit PDF/structured draft imports; simulated Rasch parameter recovery/missingness/extreme patterns; unstable small-cohort diagnostics; PCM probabilities and simulated calibration; reproducible Z/T calculations; configurable grade thresholds and boundaries; approval permissions; applying prevalidated parameters to a smaller cohort; publication gates; calibration invalidation after raw-score correction.

Browser tests use real FastAPI endpoints and real PostgreSQL data, without intercepted/mock API responses. Student checks: login, catalogue search, start confirmation, answer autosave, reload persistence, mark for review, next question, A/B answers, submission and result display. Teacher checks: login, draft creation, question/answer-key editing and persistence. Both viewport checks reject horizontal page overflow. Browser scenarios create labeled E2E records; completed E2E forms are closed. All forms created in this QA session were closed after verification; their labeled E2E histories remain preserved.

The first browser run exposed a `127.0.0.1` origin missing from local CORS. It was corrected and a regression test added. A teacher browser test initially navigated away before its login request completed; the test now waits for the authenticated dashboard. Initial migration checks exposed JSON/JSONB model drift and a quoted JSON default interpreted as bind parameters; both were fixed and the migration/schema checks rerun successfully. Raw-grade correction now invalidates stale calibration versions and prevents their reapproval.

Non-failing dependency warnings remain: PyMuPDF SWIG import deprecations, Zod comments whose pure annotations Rollup removes, and Playwright's terminal color-environment warning. The final application chunks are split below Vite's 500 kB warning threshold (largest chart chunk approximately 416 kB before gzip).

Not executed: live Telegram authentication/message delivery/webhook setup, real official-PDF conversion-value verification, local OCR with installed Uzbek language models, production hosting, load tests, independent statistical validation or an official equating study. These need user-supplied documents, credentials or an appropriate validation dataset. See `status.md` for complete limits.

The local web servers used for QA are stopped after verification. Startup commands are in the root README. Database contents and uploaded files remain on disk.

## Telegram /start follow-up fix

The configured bot token was checked directly with Telegram `getMe` and accepted; `getWebhookInfo` confirmed no registered webhook and three queued updates before starting polling. No token was printed. The local configuration had BOT_MODE=disabled and an HTTP localhost Mini App URL.

Added `scripts/bot.sh` to explicitly run local polling in a separate terminal and a read-only `check` command. `/start` now welcomes the user without a Web App button until a public HTTPS URL is configured, avoiding Telegram rejecting the entire message for the default HTTP URL. Group commands receive private-chat guidance. A local file lock prevents duplicate polling processes from this project; webhook/polling mutual exclusion remains enforced.

Executed the backend regression suite after this change: **49 passed, 1 skipped** (PostgreSQL-only concurrency test). New tests cover URL eligibility, local welcome fallback, HTTPS button behavior, group handling, read-only diagnostics, disabled polling guidance, existing-webhook refusal, and duplicate-process protection. Real Telegram sends and HTTPS Mini App opening are separate from these mocked handler tests.

Live follow-up: the corrected bot was then started with `scripts/bot.sh`. Telegram polling connected successfully and four incoming updates were handled without errors. The bot process is intentionally left running for the user's `/start` check. A public HTTPS Mini App URL is still absent, so the welcome currently has no Mini App button.
