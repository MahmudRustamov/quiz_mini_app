# Dynamic question editor — phased specification

Replace the raw JSON question editor in `frontend/src/pages/Teacher.tsx` with a
form-based editor whose fields change with the selected question type.

**Run one phase per session.** Each phase ships independently and leaves the app
working. Do not start a later phase before the earlier one is merged.

---

## Ground truth — read this before writing any code

These are the actual shapes in this repository. Earlier drafts of this task
assumed features that do not exist; the list below is authoritative.

### Question kinds — there are six, not four

`QuestionInput.kind` (`backend/app/schemas/__init__.py`) is
`Literal['single', 'matching', 'short', 'two_part', 'reading', 'image']`.

Phases 1–3 build forms for the first four. `reading` and `image` must keep
working through the JSON tab — a teacher opening one must not lose it.
`reading` questions carry `passage_id` and belong to the Passage feature
(`POST`/`DELETE /api/teacher/exams/{id}/passages`).

### How each kind maps onto the storage model

There is no `pairs` table and no `correct_answer` column. Everything is
expressed with `QuestionPart` + `AnswerKey` + `Option`:

| Kind | `options` | `parts` | `AnswerKey.accepted` |
|---|---|---|---|
| `single` | the four choices (`label` = `A`–`D`, `text`) | exactly one, `label: "main"` | `["A"]` — an **option label** |
| `matching` | the right-hand items (`label`, `text`) | **one part per left-hand item**; `part.prompt` holds the left text, `part.label` is a short id | `["B"]` — the matching option's label |
| `short` | empty | one, `label: "main"` | every acceptable written answer, verbatim |
| `two_part` | empty | exactly two, labels **`"A"` and `"B"` (uppercase)** | per-part acceptable answers |

`publish_exam` enforces the option-label rule for `single`, `reading`, `image`
and `matching`:

```python
if options and q.kind in {...} and any(a not in {o.label for o in options} for a in key.accepted):
    raise HTTPException(422, 'Kalit variantlarga mos emas')
```

`QuestionInput.unique_labels` requires exactly one part when a *choice* kind has
options — `matching` is deliberately excluded, which is what allows one part per
pair.

### Fields that do not exist

- **`Option` has no image column.** It is `label` + `text` only, and
  `OptionInput.text` is `min_length=1`, so an image-only option is impossible
  today. Phase 3 adds this.
- **There is no image upload endpoint.** Images reach `upload_dir` only through
  `extract_pdf`. `replace_question` additionally rejects any path that is not
  `{exam_id}/....png`. Phase 3 adds the endpoint.
- **There is no "grading criteria" field.** `QuestionPart` is `label`,
  `prompt`, `weight`; `AnswerKey` is `accepted`, `case_sensitive`,
  `manual_review`. Use `prompt` for sub-question text. Do not invent a column.
- **There is no AI import and no AI grading.** `grade_answer` does Unicode
  normalisation and exact matching. Ignore any requirement phrased around an AI
  model judging similarity.

### What already exists — reuse, do not rebuild

- `DELETE /api/teacher/exams/{id}/questions/{qid}` with ascending renumbering
  (`remove_question` in `backend/app/repositories/exams.py`).
- `DELETE .../passages/{pid}` (409 when a question still references it) and
  `DELETE /api/teacher/exams/{id}`.
- `DeleteConfirmation` modal in `Teacher.tsx`.
- `editable_exam()` — every mutating teacher route goes through it. It rejects
  anything that is not a draft with zero attempts, which is what keeps published
  exams safe. You do not need extra guards for that.

### House rules

- Dense, compact code matching the surrounding file. English comments, Uzbek
  user-facing strings.
- Use the existing design tokens (`--accent-soft`, `--soft`, `--line`,
  `--muted`) and components (`Pill`, `SectionTitle`, `ErrorBox`, `panel`).
  Do not introduce a UI framework, a rich-text editor, or a new visual language.
- `Teacher.tsx` is already 1634 lines. Put new editors in
  `frontend/src/pages/teacher/` as separate files rather than growing it.
- Mobile: the editor must stay usable in one column — readable inputs, tappable
  controls, no cramped rows. Do **not** build a second mobile-specific UI.
  Authoring is a desktop job; mobile only has to not break.
- Do not commit or push.

### Checks that must pass in every phase

```bash
cd backend && .venv/bin/python -m pytest -q
createdb milliy_sertifikat_test
TEST_DATABASE_URL="postgresql+asyncpg://127.0.0.1:55432/milliy_sertifikat_test" .venv/bin/python -m pytest -q
cd frontend && npx tsc --noEmit && npm run build
```

PostgreSQL is where the unique constraints actually bite — the SQLite run alone
will not catch position bugs.

---

## Phase 1 — dynamic form editor, no images

**Goal:** a teacher creates and edits `single`, `matching`, `short` and
`two_part` questions without seeing JSON. No backend change.

### Type selector

A `Savol turi` dropdown at the top of the editor pane. Changing it re-renders
the form below immediately. Four components, one per kind:

`SingleChoiceEditor` · `MatchingEditor` · `ShortAnswerEditor` · `TwoPartEditor`

Never render fields belonging to another kind. When switching would discard data
that cannot be carried over (options, pairs, extra parts), confirm first.

### Shared fields

Question text (textarea), `topic` (it drives the per-topic breakdown in
`result_data` — do not drop it), and per-part `weight` (`gt=0`, `le=100`, the
basis for partial credit). Position is assigned automatically and is never typed
by hand. Existing `image_paths` from a PDF import are displayed read-only;
uploading arrives in phase 3.

### Per-kind forms

- **A/B/C/D test** — four option rows (label + text), then a `To'g'ri javob`
  radio group at the bottom of the card. Write the chosen label into
  `parts[0].accepted`.
- **Moslashtirish** — a two-column pair table. Each row is one left item plus
  the right item it matches, with a delete button, and a `+ Juftlik` button
  below. On save, translate rows into the table above: right items become
  `options` with generated labels, each left item becomes a part whose `prompt`
  is the left text and whose `accepted` is `[matching option label]`. Keep each
  row's part label stable across edits.
- **Qisqa yozma javob** — a repeatable list of accepted answers
  (`parts[0].accepted`), plus `case_sensitive` and `manual_review` toggles.
- **Ikki qismli savol** — two cards, `A qism` and `B qism`. Each has its own
  sub-question text (`prompt`), accepted answers, weight and `manual_review`.
  Validate the two parts independently. The labels sent to the API must be
  uppercase `A` and `B`.

### Answer key placement

The key stays visible at the bottom of the editor — a fixed strip, never behind
an accordion or below a long scroll. Manual key verification is a core
invariant of this project (`docs/architecture.md`); the UI must support it.

### JSON tab

Keep a `JSON` tab beside the form. Form and JSON stay synchronised in both
directions. Invalid JSON is reported inline with a readable Uzbek message and
the error position — never a raw `Unexpected token` string — and must not wipe
the buffer. A question of kind `reading` or `image` opens straight into the JSON
tab with a note explaining why.

### Validation, status and drafts

Mirror the Pydantic rules client-side so a long question never fails with a 422
after typing: non-empty text, unique part labels, unique option labels, exactly
`A`+`B` for `two_part`, one part for a choice kind with options, every key entry
matching an existing option label, no empty option text, at least one accepted
answer unless `manual_review` is set.

Show errors inline. Show a per-question indicator in the list rail and a summary
built from the real counts, e.g. `28 tayyor · 4 tekshiruv kerak`. Nothing about
the count may be hardcoded — exams vary in length.

Autosave the in-progress buffer to `localStorage`, keyed by exam and question.
Never send an incomplete question to the server; `POST`/`PUT` only on an
explicit save of a validated question.

### Tests

Vitest/RTL for the editors: switching kinds, single-choice selection, pair
add/remove, multiple accepted answers, two-part validation, and — the one that
matters most — that each form produces exactly the `QuestionInput` payload the
backend expects. Add a Playwright case covering create → edit → reopen.

---

## Phase 2 — position management

**Goal:** insert, move, duplicate and reorder questions in a draft of any
length.

### Backend

```
PUT /api/teacher/exams/{exam_id}/questions/order
body: { "question_ids": ["...", "...", ...] }   # the complete new order
```

Behind `Depends(teacher)` and `editable_exam()`. Reject with 422 unless the list
is exactly the set of that exam's question ids — no duplicates, none missing,
none foreign. Write an `audit(...)` record.

**Renumbering must be two-phase.** `UniqueConstraint('exam_id', 'position')` is
not deferrable, so assigning final positions directly collides mid-update. Shift
every row to `position + 1000` first, flush, then assign `1..N`. The offset stays
positive, which satisfies `CheckConstraint('position > 0')`; the `le=500` bound
lives on `QuestionInput` and does not apply to a direct ORM write.

Deletion already renumbers correctly in `remove_question` — leave it alone.

### What phase 1 built — work inside it

`frontend/src/pages/teacher/QuestionWorkspace.tsx` owns the list rail, the
selection state and every mutation. All new controls belong there; do not add a
second component that also writes questions.

Three pieces of its state matter here:

- `buffers` and the `localStorage` drafts are keyed by **question id**
  (`draftKey(exam.id, activeId)`). Reordering does not change ids, so drafts
  survive it untouched. Deletion already calls `forget(id)` — duplication must
  not copy the original's draft to the new question.
- A new question currently takes `position = questions.length + 1` (line 20).
  Insert-above and insert-below cannot reuse that, see below.
- `selected` holds a question id. After any reorder it stays valid; after
  duplication select the new question.

### Insert without fighting the unique constraint

`replace_question` returns 409 on an occupied position, so do not try to create
a question directly at an occupied slot. Insert in two steps:

1. `POST` the question at the first free position (`questions.length + 1`).
2. `PUT .../questions/order` with the full id list in the order the teacher
   wants, which renumbers everything in one transaction.

Duplication works the same way: copy text, topic, options, parts and keys into
a new question at the end, then reorder it to sit directly below the original.

### Fix the validation re-render while you are here

`QuestionWorkspace` currently calls `inspectBuffer` once per question for the
readiness count (line 42) and again inside the list map (line 59). Both run on
every keystroke in the editor, so a 50-question exam does roughly 100
`JSON.parse` plus validation passes per character typed. Compute the per-question
validity once with `useMemo` keyed on `buffers` and `exam.questions`, and derive
both the count and the per-row pill from it. This is a prerequisite for longer
exams, not a nice-to-have.

### Frontend controls

In the list rail: insert above, insert below, move up, move down, duplicate,
and **move to position**. Reordering always sends one request with the full
order rather than per-question position edits. Disable the controls while
`busy`, and keep them hidden unless `exam.status === "draft"`, matching the
existing delete button.

**Move to position** is how a teacher moves a question a long way. Up and down
arrows are one step per click, so sending question 40 to slot 3 would take 37
clicks. Give the selected question a small number input next to its arrows:
typing `3` and confirming with Enter or blur moves it there and renumbers
everything else around it. Clamp the value to `1..N` and ignore a non-numeric or
unchanged entry rather than erroring.

This is deliberately **not** drag and drop. A drag across a 50-row scrolling
list needs auto-scroll to feel right, it fights page scrolling on touch inside
the Telegram Mini App, it needs a library plus a drag handle, and it needs a
keyboard alternative anyway — which is exactly the arrows and the number input.
The order endpoint takes a finished list, so drag and drop can be layered on
later with no backend change if teachers ask for it. Do not add it now.

Note the distinction: the teacher types a *target slot* as a move command. The
question's own `position` remains system-assigned and is never an editable field
on the question form.

### Tests

Backend: reorder a 5-question draft and assert `1..N` with no gaps; reverse the
whole order in one call (the case that collides if renumbering is single-phase);
reject a list with a missing id, a duplicate id, and an id from another exam;
confirm a published exam and one with attempts return 409; confirm the reordered
exam still publishes. **Run these against PostgreSQL** — SQLite does not enforce
the unique constraint the same way and will pass a broken implementation.

`backend/tests/test_editor_payloads.py` already drives the four form payloads
through create → publish → grade. Extend it, or follow its shape, so a reordered
exam is covered end to end rather than only at the endpoint.

Frontend: insertion and arrow moves produce the expected order payload;
move-to-position sends the right order for a long jump in both directions, and
clamps or ignores `0`, `N + 1` and a non-numeric entry; duplication does not
carry over the original's `localStorage` draft.

---

## Phase 3 — images

**Goal:** optional images on a question and on individual options.

### What phases 1–2 built — work inside it

The editor's own schema now lives in
`frontend/src/pages/teacher/questionModel.ts`. An option is
`z.object({ label: z.string(), text: z.string() })` there, and four functions
depend on that shape: `blankQuestion`, `toInput`, `validateQuestion` and
`canUseForm`. All four need updating together — a field added to only some of
them silently drops images when a question is reopened.

`validateQuestion` currently requires non-empty option text:

```ts
q.options.forEach((o, i) => { text(`options.${i}.label`, o.label, 30, true); text(`options.${i}.text`, o.text, 10000, true); });
```

That rule becomes "text or image, but not neither", and must match whatever the
backend's `OptionInput` validator enforces. Keep the two in step; the whole
point of phase 1 was that a teacher never discovers a rule by getting a 422.

Upload controls belong in `SingleChoiceEditor.tsx` and `MatchingEditor.tsx`
beside each option row, and in the shared question fields for the question-level
image. `QuestionWorkspace` already owns every network call — add the upload
there rather than letting leaf editors fetch.

### Upload endpoint

```
POST /api/teacher/exams/{exam_id}/images   (multipart, field: file)
→ { "path": "{exam_id}/{uuid}.png" }
```

Behind `editable_exam()`. Validate by magic bytes (`\x89PNG\r\n\x1a\n`), not by
filename or client content-type. Cap at `max_upload_mb`. Store under
`upload_dir / exam_id` with a generated name. Return the path in exactly the
form `replace_question` accepts, since it rejects anything that is not
`{exam_id}/....png`.

### Option images — schema change

Add `Option.image_path: Mapped[str | None]` with an Alembic migration in
`backend/alembic/versions/`, following the style of `0003_session_issued_at.py`.
Add the field to `OptionInput` and relax `text` so an option is valid with text,
an image, or both — but never neither. Keep `import_structured` working: it
builds `QuestionInput` from CSV/JSON and must not start rejecting existing
files.

### Authorization — the highest-risk part of this phase

`asset()` in `backend/app/api/routes.py` builds the student allowlist from
question images only:

```python
if f'{exam_id}/{filename}' not in {p for q in questions for p in q.image_paths}:
    raise HTTPException(404)
```

Option images must be added to that set, or every student gets a 404 on an
option image while teachers — who skip this branch entirely — see it fine. That
asymmetry is exactly the kind of bug that reaches production, because the person
building it is a teacher.

**`/api/assets/` has no tests today.** Grep confirms it: the route's role check,
its path-traversal guard and its exam scoping are all currently unverified.
Before adding option images, write tests for the behaviour that already exists —
a student with an attempt can fetch a question image, a student without one
cannot, a student cannot fetch another exam's image, a teacher can, and a
filename containing `..`, `/` or a non-`.png` suffix is rejected. Then extend
them to option images. Do not add the feature on top of an untested guard.

Validate option image paths through the same loop `replace_question` already
applies to `data.image_paths` (`{exam_id}/` prefix, no `..`, `.png` suffix) —
extend that loop rather than writing a second check that can drift from it.

### Frontend

Upload and remove controls on the question and on each option, with a preview
and a zoomable viewer. Render option images for students in `ExamSession.tsx`
(around line 324, beside the existing `q.image_paths` loop) and in results
review in `Results.tsx` (around line 319). An option that is image-only must
still be selectable and must still show its label.

Known gap to report rather than solve here: deleting a question does not delete
its uploaded files. Only `DELETE /teacher/exams/{id}` clears the directory, via
`delete_uploads_after_commit`.

---

## Phase 4 — preview, remaining kinds, PDF review

### Preview — extract the renderer, do not write a second one

The student question body is currently written **inline inside
`frontend/src/pages/ExamSession.tsx`** (roughly lines 317–390): the passage
block, `q.image_paths`, the matching option cards, the radio list and the
option images all live in that one component's JSX. `Results.tsx` carries a
third, separate rendering of the same material for review.

A preview built as a fresh copy of that markup is worse than no preview: it
would drift from the real exam view on the first change after it ships, and
teachers would be verifying against something students never see.

So the work is an extraction, not a new screen. Pull the question body into a
presentational component — `frontend/src/components/QuestionBody.tsx` — that
takes the question, the current answers and an `onAnswer` callback, and use it
in both `ExamSession` and the preview. Keep saving, revisions, deadlines and
network calls in `ExamSession`; the extracted component must not fetch anything,
or the preview drags the attempt machinery in with it. `ProtectedImage` in
`components/ui.tsx` is already shared and needs no change.

Preview renders entirely client-side from data the teacher already holds. Do not
add an endpoint for it — a new one risks serving answer keys.

Bringing `Results.tsx` onto the same component is worthwhile but optional; do it
only if it falls out cleanly, and say in the report whether you did.

### `reading` and `image` forms

Both grade exactly like `single`: `publish_exam` and `QuestionInput` treat
`single`, `reading` and `image` identically — options plus one scoring part
whose key is an option label. Do not invent grading differences. They differ
only in what the form must offer:

- **`reading`** — a passage picker listing the exam's existing passages plus
  inline creation. `POST /api/teacher/exams/{id}/passages` and
  `DELETE .../passages/{pid}` already exist; deletion returns 409 while a
  question still references the passage, so surface that message rather than
  letting it look like a failure.
- **`image`** — the single-choice form with the question-level image upload
  phase 3 built, nothing more.

`canUseForm` in `questionModel.ts` currently returns `false` for both kinds and
routes them to the JSON tab. Update it together with `blankQuestion`, `toInput`
and `validateQuestion`, the same four-function rule phase 3 followed.

### PDF side-by-side

In import review, show the stored page image (`extracted.pages[].page_image`)
beside the form so transcription needs no window switching. Flag imported
questions that still have no answer key. Imported questions are never
auto-published; teacher verification stays required.

### Orphan upload cleanup

Phases 1–3 left a known gap: removing an image from a question, or deleting the
question, leaves the file on disk. Only `DELETE /teacher/exams/{id}` clears the
directory, through `delete_uploads_after_commit` in `app/services/drafts.py`.

If you address it here, follow that function's pattern — never unlink while the
transaction can still roll back — and delete only files no remaining question or
option references. An import document's page images are referenced by the
import record, not by a question, so do not treat them as orphans.

### Not in scope unless teachers ask

A free-text grading-criteria field. It needs a new column and migration, and
`QuestionPart.prompt` covers the common case.

---

## Report after each phase

1. Files changed · 2. New components · 3. Backend changes · 4. Migrations ·
5. Tests run and their output · 6. Remaining limitations.
