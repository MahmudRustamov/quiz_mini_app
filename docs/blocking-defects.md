# Active sessions and draft deletion

Implemented the attached task while preserving all pre-existing working-tree fixes. No commit or push was made.

## Session lifetime

`SESSION_MINUTES` remains the idle window (default 30). `SESSION_ABSOLUTE_HOURS` defaults to 12. Session creation now records `issued_at`; authenticated activity extends expiry only when less than half the idle window remains, with expiry clamped to the issuance-based cap. Idle or absolutely expired sessions still receive 401; inactive users cannot renew. All Python comparisons of stored timestamps use `aware()`, including SQLite's naive values. The existing request transaction commits renewal and still purges expired rows during session creation. Telegram HMAC validation and its 300-second launch-data freshness window are unchanged. No frontend authentication changes were needed: exam polling/saving already sends the stored bearer token, and the client does not schedule logout from the original expires_at value.

Migration `0003_session_issued_at` adds/backfills a non-null timestamp without changing existing expiry or its index. Since historical issuance was not stored, the backfill infers it as `expires_at - 30 minutes`, matching the previous fixed default session lifetime. PostgreSQL uses an interval update; SQLite backfill preserves microseconds rather than truncating them through SQLite datetime(). The migration was applied to the configured application database and `alembic check` reported no new upgrade operations. Restart the backend if it is not running with reload. On another database, apply `cd backend && .venv/bin/alembic upgrade head` before starting the updated backend.

## Draft deletion

Added teacher-protected DELETE endpoints for exam questions, passages, and exams. All acquire the existing `editable_exam()` guard: draft status and zero attempts. Cross-exam child IDs return 404. Questions are removed in AnswerKey → QuestionPart → Option → Question order; remaining positions move down one at a time in ascending order with a flush per move. Passages referenced by any question return 409 instead of nulling references. Exam deletion also removes its passages/import documents, preserving audit records with actor, timestamp and deleted content metadata.

Upload cleanup is registered after database commit, so failed/rolled-back requests retain their files. Missing directories are harmless; symlinks are unlinked without following their targets. An operating-system cleanup error is logged by exam ID for manual cleanup and cannot undo a committed database transaction. No external worker is required.

The teacher dashboard has a confirmed delete action for draft exams. The editor has a confirmed delete action per draft question, handles server errors in the confirmation, refreshes renumbered rows and adjusts the current editor's position where needed. Published exams have no delete controls. Existing styles, `act()`/ErrorBox/success-note patterns and Uzbek text are retained.

## Executed evidence

| Check | Actual result |
|---|---|
| Initial regression run, unfixed SQLite | 22 failed |
| Initial regression run, unfixed PostgreSQL | 22 failed |
| Final 24 new backend regressions against isolated exact pre-fix source | **24 failed** |
| Full fixed SQLite suite | **78 passed, 1 skipped** (PostgreSQL-only concurrent locking test) |
| Full fixed PostgreSQL suite, dedicated `milliy_sertifikat_test` database on port 55432 | **79 passed** |
| Frontend `npx tsc --noEmit` | Passed |
| Frontend production build with explicit public VITE_API_URL | Passed |
| Desktop/mobile delete confirmations and existing auth/browser regressions | **20 passed** |
| Applied migration and Alembic schema check | Passed; no schema drift |
| `git diff --check` | Passed |

Regression evidence includes an 80-minute start/save/submit flow with no re-authentication, idle expiry, absolute caps, half-window throttling, creation-time caps and expired-row purge, inactive-user renewal refusal, migration backfill/precision/index checks, deletion/renumbering/publication, permissions and attempt guards, cross-exam scoping, referenced passages, all dependent rows, audit survival, present/missing/symlink upload directories, and rollback preservation. Browser deletion tests use synthetic fixtures; PostgreSQL API tests exercise the actual database constraints and request transactions.

PyMuPDF SWIG deprecation warnings and dependency build comment warnings remain non-failing. PostgreSQL was already running and has been left running; only the isolated frontend QA server is stopped.

## Files changed for this task

- `backend/app/core/config.py`, `backend/app/models/__init__.py`, `backend/app/core/auth.py`, `backend/alembic/versions/0003_session_issued_at.py`: sliding expiry and absolute lifetime.
- `backend/app/api/routes.py`, `backend/app/repositories/exams.py`, `backend/app/services/drafts.py`: guarded, audited deletion and post-commit upload cleanup.
- `frontend/src/pages/Teacher.tsx`: draft exam/question deletion confirmations.
- `backend/tests/test_sliding_sessions.py`, `backend/tests/test_session_migration.py`, `backend/tests/test_draft_deletion.py`, `frontend/tests/draft-delete.spec.ts`: regressions.
- `backend/.env.example`, `backend/.env.production.example`, `docs/architecture.md`, this document: configuration and invariant updates.

The previously modified `backend/app/main.py`, `backend/app/services/attempts.py`, `backend/app/services/imports.py`, `backend/tests/test_auth.py`, and `backend/tests/test_exam_flow.py` were verified byte-for-byte against the task-start snapshot. Existing route function bodies are unchanged; only the three new DELETE functions/imports were added. In auth.py only create_session/current_user changed; validate_init_data, aware and permissions remain unchanged.

Implementation references: [SQLAlchemy after_commit events](https://docs.sqlalchemy.org/en/20/orm/events.html#sqlalchemy.orm.SessionEvents.after_commit), [Alembic batch changes for SQLite](https://alembic.sqlalchemy.org/en/latest/batch.html).
