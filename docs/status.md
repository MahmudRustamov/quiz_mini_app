# Delivery status

Implemented locally: async PostgreSQL schema and Alembic migration; Telegram HMAC authentication and opaque expiring sessions; protected student/teacher/admin APIs; React dashboard, catalogue, timed exam, resume/autosave, navigation, flags, essay entry, results/charts/history/rankings/profile; teacher question/answer-key JSON editor and shared passages; PDF/JSON/CSV draft import; page/embedded-image retention and two-column heuristics; optional local OCR; per-part deterministic and manual grading; versioned official essay-table ingestion and multiple expert grading with audit history; Rasch MML/EAP, PCM MML statistical module; calibration version/diagnostics/approval; explicit reference-based Z/T scoring; gated unofficial final results; student management; CSV/Excel exports; manual Telegram announcements/result notifications; local polling and production webhook modes; environment/deployment examples.

Required user inputs, deliberately absent:

- The actual 44-question PDF, answer-key image, and Baholash_mezoni.pdf were not in the workspace. No official questions, keys, or essay lookup values were invented.
- Upload the source PDF plus a manually transcribed and verified 49-row essay lookup table before essay conversion. Synthetic nonlinear conversion data appears only in tests.
- A real BOT_TOKEN and your administrator Telegram IDs are needed for live Telegram login, bot delivery and webhook registration. Local accounts are available only when DEV_AUTH is explicitly true in development.
- A representative calibration and external validation evidence are needed before approving a reference population. The software never equates cohort size with validity or asserts official comparability.

Scope and operational limits:

- PDF imports retain ordered text and page images for a teacher to construct/verify questions; automatic numbered-question segmentation and answer-key image OCR are not implemented. Local OCR requires Tesseract and uzb/eng language data. Two-column detection is a heuristic and requires visual review.
- The question/answer-key editor is a validated JSON editor, not a WYSIWYG document editor. Matching pairs and A/B parts are represented explicitly in this editor.
- The examination API calibrates independently scored binary parts. PCM estimation is implemented and simulation-tested as a Python module; the admin API does not publish PCM-calibrated results.
- Item standard errors are conditional-information approximations and exclude calibration uncertainty. Infit and convergence checks are diagnostics, not a full psychometric validation (no DIF, local-dependence analysis, equating study or bootstrap SE). Administrator validation is still required.
- Calibrated scoring is an explicit teacher action; pending raw grades are excluded from calibration and block individual standardized scoring. Manual raw-score correction invalidates approved calibration versions.
- Expired attempts finalize when next accessed by the API. There is no periodic expiry worker; the server deadline always rejects late writes.
- Telegram notification delivery is a manual action with no durable retry/outbox. Failures are reported; production delivery guarantees require an outbox/retry design.
- Production rate limiting, organizational teacher-to-exam assignment, distributed job scheduling, accessibility audit, upload malware scanning and load testing remain operational hardening work. Teachers currently form a trusted shared staff role with access to all exams/students; administrators control staff membership.
- No hosting deployment is performed. Credentials, live Telegram end-to-end verification, official rubric verification and official comparability remain outside this local delivery.

See README and verification.md for exact startup commands and executed checks.
