# Milliy Sertifikat

Uzbek-language Telegram Mini App for mock examinations. React/TypeScript/Vite frontend, FastAPI/aiogram backend, async SQLAlchemy/PostgreSQL persistence, deterministic grading and versioned Rasch scoring. Runs locally on macOS without Docker or paid APIs.

The workspace was empty. No existing bot or examination documents were present. The application starts without fabricated exams, results or official conversion values. See [delivery status](docs/status.md) for missing source documents and precise implementation limits, [architecture](docs/architecture.md), and [verification](docs/verification.md).

## Start in this workspace

Dependencies are already installed in `backend/.venv` and `frontend/node_modules`. An isolated PostgreSQL cluster is initialized at `data/pg`. Its port is **55432** because 5432 was occupied. `backend/.env` points to this database and enables fixed local development accounts. No real Telegram credentials are configured.

From the project root, start PostgreSQL:

```bash
./scripts/database.sh start
```

In one terminal:

```bash
./scripts/backend.sh
```

In another terminal:

```bash
./scripts/frontend.sh
```

For Telegram bot replies, keep a **third terminal** open:

```bash
./scripts/bot.sh
```

The backend and frontend commands do not start Telegram polling. This helper explicitly enables local polling for its process, even when the default `.env` has `BOT_MODE=disabled`. A real token must be present in `backend/.env`. It refuses to poll if a webhook is registered or a second local copy of the bot is running. `/start` replies even with a local HTTP URL; the Mini App button appears only after a public HTTPS URL is configured. To check credentials and webhook status without polling or sending messages, run `./scripts/bot.sh check`.

Open **http://localhost:5173**. API documentation is at **http://localhost:8000/docs**. The login screen offers local student, teacher and administrator accounts when development authentication is enabled. These accounts are explicitly local and cannot be used through the production Telegram login.

To stop servers, use Ctrl+C in their terminals. Stop the isolated database with `./scripts/database.sh stop`.

## Fresh macOS installation

Use Python 3.12+ and Node.js 22.12+ (or a current supported Node LTS). PostgreSQL 17 works; no Docker is used.

```bash
brew install postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Choose one database option:

1. Use an existing local PostgreSQL service: `createdb milliy_sertifikat`. The example URL defaults to port 5432.
2. Start this project's isolated database with `./scripts/database.sh start`. Change `DATABASE_URL` in `backend/.env` to `postgresql+asyncpg://127.0.0.1:55432/milliy_sertifikat`.

The isolated cluster trusts local connections and binds only to loopback. Use a password-protected role for deployment or shared machines. The helper expects Homebrew tools in `/opt/homebrew/bin`; set `PG_BIN` on Intel Macs if needed. It initializes only a missing cluster, never resets an existing one.

Apply migrations and start the backend:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Install/start the frontend in a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

A checksum-verified Node 22.23.4 macOS arm64 runtime was installed only inside the ignored `.runtime/` directory for this workspace. The frontend helper uses it if `node` is absent from PATH. It is not a prerequisite on another machine with Node installed.

CORS permits `http://localhost:5173` and `http://127.0.0.1:5173` by default. Frontend API defaults to `http://localhost:8000`; configure `VITE_API_URL` to change it. Environment settings are read relative to `backend/`, so run backend commands there or use the helpers.

## Use the application

1. Sign in locally as teacher or administrator. Open **O‘qituvchi paneli** (on mobile it is also linked from Profil).
2. Create an exam draft; set duration, subject, essay requirement and expert count.
3. Add/edit questions in the validated JSON editor, or upload structured JSON/CSV. [The format example](data/question-format.example.json) is clearly marked sample content and is never imported automatically.
4. Upload a PDF to retain text, page images and embedded images. Inspect each page. Copy verified text into question definitions, assign image paths from the import, and enter explicit answer keys. Scanned pages need manual transcription or optional local OCR.
5. For shared passages, create a passage and use its returned `passage_id` in relevant questions. Use `image_paths` returned by this exam's PDF import for diagrams.
6. Verify text, diagrams, keys and scoring weights, then publish in **Sozlamalar**. Exams are immutable after publication. A student receives one resumable attempt per exam.
7. Students answer, flag, navigate, write their essay, and submit. Server deadlines are authoritative. Autosave failures are visible; keep the page open and retry until saving succeeds.
8. Review uncertain written parts. For essays, upload a verified official rubric, then each authorized expert submits their own 0–24 score in 0.5 steps. Each score is converted independently before averaging. Every correction is audited. Published results must be withdrawn before corrections.
9. Run Rasch diagnostics when suitable. An administrator must record validation evidence and an explicit reference population, mean and SD before approval. Flagged/nonconverged runs cannot be approved. Apply the approved calibration with **Urinishlarni baholash**. The same immutable form can score later attempts from a smaller cohort using its previously validated parameters.
10. An administrator publishes results. Raw-score rankings can be published while calibration/essays are pending; final certificate-style grades remain pending until all required scores exist. Releasing answer keys closes the form to new attempts and is blocked while attempts remain active.

The default configurable unofficial thresholds are A+≥70, A≥65, B+≥60, B≥55, C+≥50, C≥46. Draft exam settings can customize them. The calibration stores the named reference population and its explicit parameters. `Z=(theta-mean)/SD`, `T=50+10Z`; invalid SD is rejected. For essay exams, final score is `(test T + average converted essay score)/2`. No scale clipping or undocumented multiplication is applied. All results are labeled **Norasmiy sinov natijasi**.

### Question format

Supported kinds: `single`, `matching`, `short`, `two_part`, `reading`, `image`. All use explicit scoring `parts`. A choice question normally uses one part named `main` whose accepted answer is an option label. Matching questions use one part per pair; shared option labels are available to each pair. A two-part question requires exactly `A` and `B`. Parts are scored independently and may have different positive weights.

For short answers, `accepted` contains exact accepted strings, `case_sensitive` is optional, and `manual_review=true` sends unmatched nonblank answers to a teacher. NFC, whitespace and apostrophe glyphs are normalized; Uzbek spelling and diacritics are preserved. Blank answers receive zero. Partial scores entered during manual review remain raw scores and cannot be treated as binary Rasch responses.

JSON import accepts an array or `{"questions":[...]}`. CSV columns are `position,kind,text,topic,options,parts,passage_id,image_paths`; nested fields must be JSON strings correctly quoted as CSV cells. Import is transactional: validation errors do not partially create a question set.

### PDF/OCR and official essay conversion

PDF parsing uses PyMuPDF; two-column ordering is a heuristic, and full-page renders preserve vector diagrams. Extracted material remains a draft requiring teacher verification. The application does not guess missing questions or answer keys from an image.

Optional offline OCR:

```bash
brew install tesseract tesseract-lang
```

Verify `tesseract --list-langs` includes `uzb` and `eng`. Enable OCR when uploading a scanned PDF. Errors and missing OCR support are shown in the import record; manual correction remains available.

**Baholash_mezoni.pdf was not supplied.** In the administrator's **Baholash jadvali** page, upload the actual PDF and a manually verified JSON map containing all 49 score keys (`"0.0"`, `"0.5"`, …, `"24.0"`) and their exact official 75-point values. This creates an immutable rubric version tied to the source PDF SHA256. No production conversion table is prefilled. Automated tests use a deliberately synthetic nonlinear fixture to verify lookup behavior; that is not an official table.

## Telegram

Set `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS` (JSON array), and HTTPS `MINI_APP_URL` in `backend/.env`. Real users authenticate only through cryptographically validated `Telegram.WebApp.initData`, never `initDataUnsafe`. Server sessions last 30 minutes by default. Development authentication fails configuration validation in production.

The official Telegram Web App JS SDK is loaded by `frontend/index.html`; it calls ready/expand and follows Telegram light/dark theme changes. A manual theme preference is retained locally. Backend authentication follows Telegram's [official validation method](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

For local bot polling, set `BOT_MODE=polling` and run separately:

```bash
cd backend
source .venv/bin/activate
python -m app.bot.main poll
```

`/start` shows the Mini App button when a public HTTPS URL is configured; with a local URL it sends a welcome explaining that Telegram opening is not yet configured; `/help` and `/support` show Uzbek guidance. Polling refuses to run while a webhook is registered. Announcements and result notifications are sent only from explicit staff actions in the UI; live delivery needs a real bot token and students who started that bot.

### Optional temporary HTTPS tunnels

Install Cloudflare's free tunnel client if you want to test inside Telegram:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
# Separate terminal:
cloudflared tunnel --url http://localhost:5173
```

Set `VITE_API_URL` to the backend tunnel HTTPS URL; set backend `CORS_ORIGINS` to a JSON array containing the frontend tunnel URL. Set `MINI_APP_URL` to the frontend HTTPS URL and configure BotFather's Mini App/menu button. Restart both services after environment changes. For Vite, add **the exact frontend tunnel hostname** to `server.allowedHosts` in `frontend/vite.config.ts`; do not allow all hosts. Temporary URLs change when tunnels restart. Telegram HTTPS testing requires both tunnels to remain active; no cloud hosting is required.

## Tests

Backend unit/API suite (isolated SQLite adapter; the PostgreSQL concurrency test is intentionally skipped):

```bash
cd backend
source .venv/bin/activate
pytest -q
```

For actual PostgreSQL row locks and constraints, create a dedicated disposable database:

```bash
createdb -h 127.0.0.1 -p 55432 milliy_sertifikat_test
cd backend
TEST_DATABASE_URL=postgresql+asyncpg://127.0.0.1:55432/milliy_sertifikat_test .venv/bin/pytest -q
```

The test suite recreates its own schema and data. Use only a dedicated `_test` database. Never point `TEST_DATABASE_URL` at the application database.

Frontend checks:

```bash
cd frontend
npm run typecheck
npm run build
```

Browser integration tests require the local backend/frontend and an installed Chrome browser. They use actual API/database responses and create explicitly labeled E2E exam records; completed E2E exams are archived. They test desktop and mobile sizes, autosave/reload, flags, independent A/B answers, submission, and teacher draft editing.

```bash
cd frontend
npx playwright test
```

The checked-in Playwright configuration uses macOS Chrome's standard path. Adjust `launchOptions.executablePath` or install Playwright's Chromium for another environment. QA screenshots are saved in `data/qa-*.png` and ignored by Git. Browser tests do not validate real Telegram login or message delivery without credentials.

## Optional deployment

No deployment or paid service is required for local development. Examples only:

- **Vercel:** set project root to `frontend`, build `npm run build`, output `dist`, and set `VITE_API_URL` to your HTTPS backend. `frontend/vercel.json` supports client routing.
- **Render/VPS:** `render.yaml` gives the backend command. Set values using `backend/.env.production.example`, run Alembic during release, then run Uvicorn. Use Python 3.12+; `requirements.txt` is the portable dependency range and `requirements.lock.txt` records the tested Python 3.14 environment.
- **Supabase PostgreSQL:** use a direct connection where networking supports it, or the session pooler. Use `postgresql+asyncpg://...?...ssl=require`. Avoid transaction poolers unless asyncpg prepared-statement settings are configured for that provider. Keep passwords in environment variables.
- **Uploads:** uploaded PDF/page/image files currently live under `UPLOAD_DIR`. Render's free filesystem is ephemeral. Use a persistent volume on a suitable plan or implement object storage before relying on deployment for durable imports. PostgreSQL records alone do not retain uploaded image bytes. A VPS can use a backed-up persistent directory. Do not claim free-hosting asset durability with the current local file store.
- **Bot:** set `BOT_MODE=webhook`, a random `WEBHOOK_SECRET` of at least 32 characters, and register:

```bash
cd backend
python -m app.bot.main set-webhook --url https://YOUR-BACKEND/bot/webhook
```

Webhook authentication checks Telegram's secret header. There is no polling task inside the web process. To return to local polling, explicitly run `python -m app.bot.main delete-webhook` before changing `BOT_MODE`.

Production startup rejects dev authentication, missing bot credentials, non-PostgreSQL databases and HTTP Mini App URLs. Set exact CORS origins; keep `.env`, database data and uploads out of Git. Free web services can sleep; initial requests may be delayed. Notifications have visible failures but no durable delivery queue. Review the remaining deployment hardening in [status.md](docs/status.md) before public use.

Statistical implementation references: [SQLAlchemy async sessions](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html) and [Rasch extreme-score estimation considerations](https://www.rasch.org/rmt/rmt122h.htm). The numerical method and assumptions are documented in `backend/app/psychometrics/rasch.py` and tested with simulated data; this is not an officially equated assessment.

## Deployed login troubleshooting

For the Vercel/ngrok deployment and the repaired `Load failed` issue, see [the reproduced failure, changed files, deployment steps and safe diagnostics](docs/login-load-failed.md). Production builds now require an explicit public HTTPS `VITE_API_URL`; local development still defaults to localhost. Use `VITE_API_URL=https://YOUR-BACKEND npm run build` for a deployment build.
