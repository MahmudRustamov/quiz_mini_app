import csv
import hashlib
import io
import json
from datetime import timedelta
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, Response as HTTPResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from app.core.config import get_settings
from app.core.db import get_db
from app.core.auth import current_user, teacher, admin, validate_init_data, create_session
from app.models import *
from app.schemas import *
from app.repositories.exams import get_exam, editable_exam, owned_attempt, exam_data, replace_question, question_data, remove_question, remove_passage, remove_exam, reorder_questions
from app.services.attempts import submit, snapshot, expire_if_due, expire_due, audit
from app.services.results import result_data, apply_calibration
from app.services.grading import convert_essay, validate_lookup
from app.services.imports import extract_pdf
from app.services.drafts import delete_uploads_after_commit
from app.psychometrics.rasch import calibrate

router = APIRouter(prefix='/api')


def display_name(name: str) -> str:
    # Minimize public identity: first name and surname initial only.
    names = name.split()
    if not names:
        return 'Talaba'
    return names[0] + (f' {names[1][0]}.' if len(names) > 1 else '')


def user_data(user):
    return {'id': user.id, 'name': user.name, 'avatar_url': user.avatar_url, 'role': user.role,
            'telegram_id': user.telegram_id, 'active': user.active}


@router.get('/config')
async def config():
    settings = get_settings()
    return {'dev_auth': settings.dev_auth and settings.environment == 'development'}


@router.post('/auth/telegram', response_model=SessionOutput)
async def telegram_login(payload: TelegramLogin, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    try:
        data = validate_init_data(payload.init_data, settings.bot_token, settings.init_data_max_age)
    except (ValueError, KeyError, TypeError):
        raise HTTPException(401, 'Telegram ma’lumotlari tasdiqlanmadi')
    user = await db.scalar(select(User).where(User.telegram_id == data['id']))
    if not user:
        user = User(telegram_id=data['id'], name=(str(data.get('first_name') or '').strip() or 'Talaba')[:200],
                    role='admin' if data['id'] in settings.admin_telegram_ids else 'student')
        db.add(user)
        await db.flush()
    if not user.active:
        raise HTTPException(403, 'Hisob bloklangan')
    return await create_session(db, user)


@router.post('/auth/dev', response_model=SessionOutput)
async def dev_login(payload: DevLogin, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    if not settings.dev_auth or settings.environment != 'development':
        raise HTTPException(404)
    identities = {'student': (-1001, 'Mahalliy talaba'), 'teacher': (-1002, 'Mahalliy o‘qituvchi'), 'admin': (-1003, 'Mahalliy administrator')}
    tid, name = identities[payload.account]
    user = await db.scalar(select(User).where(User.telegram_id == tid))
    if not user:
        user = User(telegram_id=tid, name=name, role=payload.account)
        db.add(user)
        await db.flush()
    return await create_session(db, user)


@router.post('/auth/logout')
async def logout(user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    return {'ok': True}


@router.get('/me', response_model=UserOutput)
async def me(user=Depends(current_user)):
    return user_data(user)


@router.get('/exams', response_model=list[ExamOutput])
async def exams(user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    records = (await db.scalars(select(Exam).where(Exam.status == 'published').order_by(Exam.created_at.desc()))).all()
    return [await exam_data(db, e) for e in records]


@router.get('/exams/{exam_id}', response_model=ExamOutput)
async def exam_detail(exam_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    exam = await get_exam(db, exam_id)
    if exam.status != 'published':
        raise HTTPException(404)
    # Exam text is delivered only within a started attempt.
    return await exam_data(db, exam)


@router.post('/exams/{exam_id}/attempts', response_model=AttemptOutput)
async def start_attempt(exam_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.scalar(select(User).where(User.id == user.id).with_for_update())
    exam = await db.scalar(select(Exam).where(Exam.id == exam_id).with_for_update())
    if not exam or exam.status != 'published':
        raise HTTPException(404)
    attempt = await db.scalar(select(Attempt).where(Attempt.user_id == user.id, Attempt.exam_id == exam_id).with_for_update())
    if not attempt:
        attempt = Attempt(user_id=user.id, exam_id=exam_id, deadline=now() + timedelta(minutes=exam.duration_minutes))
        db.add(attempt)
        await db.flush()
    return await snapshot(db, attempt)


@router.get('/attempts', response_model=list[AttemptOutput])
async def my_attempts(user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    await expire_due(db, user_id=user.id)
    attempts = (await db.scalars(select(Attempt).where(Attempt.user_id == user.id).order_by(Attempt.started_at.desc()))).all()
    output = []
    for attempt in attempts:
        data = await snapshot(db, attempt)
        exam = await db.get(Exam, attempt.exam_id)
        data['exam_title'] = exam.title
        if attempt.status == 'submitted':
            result = await result_data(db, attempt)
            data['raw_percentage'] = result['raw_percentage']
            data['raw_score'] = result['raw_score']
            data['grade'] = result['grade']
        output.append(data)
    return output


@router.get('/attempts/{attempt_id}', response_model=AttemptOutput)
async def get_attempt(attempt_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user)
    data = await snapshot(db, attempt)
    exam = await db.get(Exam, attempt.exam_id)
    data['exam'] = await exam_data(db, exam, detail=True, shuffle_seed=attempt.id)
    return data


@router.put('/attempts/{attempt_id}/responses/{question_id}')
async def save_answer(attempt_id: str, question_id: str, payload: SaveResponse, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user)
    await expire_if_due(db, attempt)
    if attempt.status != 'in_progress':
        return JSONResponse({'detail': 'Imtihon yakunlangan', 'submitted': True}, status_code=409)
    question = await db.get(Question, question_id)
    if not question or question.exam_id != attempt.exam_id:
        raise HTTPException(404)
    parts = (await db.scalars(select(QuestionPart).where(QuestionPart.question_id == question_id))).all()
    if set(payload.answers) - {p.label for p in parts}:
        raise HTTPException(422, 'Noma’lum savol qismi')
    response = await db.scalar(select(Response).where(Response.attempt_id == attempt_id, Response.question_id == question_id))
    current_revision = response.revision if response else 0
    if payload.revision != current_revision:
        raise HTTPException(409, 'Javob boshqa oynada o‘zgargan. Sahifani yangilang')
    if not response:
        response = Response(attempt_id=attempt_id, question_id=question_id)
        db.add(response)
    response.answers = payload.answers
    response.marked = payload.marked
    response.revision = current_revision + 1
    response.saved_at = now()
    await db.flush()
    return {'revision': response.revision, 'saved_at': response.saved_at, 'server_now': now()}


@router.put('/attempts/{attempt_id}/essay')
async def save_essay(attempt_id: str, payload: EssaySave, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user)
    await expire_if_due(db, attempt)
    if attempt.status != 'in_progress':
        return JSONResponse({'detail': 'Vaqt tugagan', 'submitted': True}, status_code=409)
    exam = await db.get(Exam, attempt.exam_id)
    if not exam.essay_required:
        raise HTTPException(422, 'Bu imtihonda yozma ish yo‘q')
    attempt.essay_text = payload.text
    return {'saved_at': now()}


@router.post('/attempts/{attempt_id}/submit', response_model=AttemptOutput)
async def submit_attempt(attempt_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user)
    await submit(db, attempt)
    return await snapshot(db, attempt)


@router.get('/attempts/{attempt_id}/result')
async def result(attempt_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user, allow_teacher=True)
    await expire_if_due(db, attempt)
    if attempt.status != 'submitted':
        raise HTTPException(409, 'Imtihon hali yakunlanmagan')
    return await result_data(db, attempt, include_teacher=user.role in {'teacher', 'admin'})


@router.get('/rankings')
async def rankings(exam_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    exam = await get_exam(db, exam_id)
    if not exam.results_published:
        return {'rows': [], 'message': 'Natijalar hali e’lon qilinmagan'}
    attempts = (await db.scalars(select(Attempt).where(Attempt.exam_id == exam_id, Attempt.status == 'submitted'))).all()
    rows = []
    for attempt in attempts:
        student = await db.get(User, attempt.user_id)
        result = await result_data(db, attempt)
        rows.append({'name': display_name(student.name), 'is_me': student.id == user.id, 'raw_percentage': result['raw_percentage'],
                     'final_score': result['final_score'], 'grade': result['grade']})
    rows.sort(key=lambda r: r['raw_percentage'], reverse=True)
    return {'rows': rows, 'message': 'Xom foiz bo‘yicha reyting · norasmiy sinov'}


@router.get('/teacher/exams')
async def teacher_exams(user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    return [await exam_data(db, e) for e in (await db.scalars(select(Exam).order_by(Exam.created_at.desc()))).all()]


@router.post('/teacher/exams')
async def create_exam(payload: ExamInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    exam = Exam(**payload.model_dump(), created_by=user.id)
    db.add(exam)
    await db.flush()
    audit(db, user, 'exam.create', exam.id, after=payload.model_dump())
    return await exam_data(db, exam, detail=True, keys=True)


@router.get('/teacher/exams/{exam_id}')
async def teacher_exam(exam_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    return await exam_data(db, await get_exam(db, exam_id), detail=True, keys=True)


@router.patch('/teacher/exams/{exam_id}')
async def update_exam(exam_id: str, payload: ExamInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    exam = await editable_exam(db, exam_id)
    before = await exam_data(db, exam)
    for key, value in payload.model_dump().items():
        setattr(exam, key, value)
    audit(db, user, 'exam.update', exam_id, before, payload.model_dump())
    return await exam_data(db, exam)


@router.post('/teacher/exams/{exam_id}/passages')
async def create_passage(exam_id: str, payload: dict, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    text = str(payload.get('text', ''))
    if not 1 <= len(text) <= 100000:
        raise HTTPException(422, 'Matn uzunligi noto‘g‘ri')
    passage = Passage(exam_id=exam_id, title=str(payload.get('title', ''))[:250], text=text)
    db.add(passage)
    await db.flush()
    return {'id': passage.id, 'title': passage.title, 'text': passage.text}


@router.post('/teacher/exams/{exam_id}/images')
async def upload_image(exam_id: str, file: UploadFile = File(...), user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    maximum = get_settings().max_upload_mb * 1024 * 1024
    content = await file.read(maximum + 1)
    if len(content) > maximum:
        raise HTTPException(413, 'Rasm hajmi ruxsat etilgan chegaradan oshdi')
    if not content.startswith(b'\x89PNG\r\n\x1a\n'):
        raise HTTPException(422, 'Faqat PNG formatidagi rasm yuklang')
    directory = get_settings().upload_dir / exam_id
    await run_in_threadpool(directory.mkdir, parents=True, exist_ok=True)
    filename = f'{uuid4()}.png'
    await run_in_threadpool((directory / filename).write_bytes, content)
    path = f'{exam_id}/{filename}'
    audit(db, user, 'exam.image_upload', exam_id, after={'path': path})
    return {'path': path}


@router.post('/teacher/exams/{exam_id}/questions')
async def create_question(exam_id: str, payload: QuestionInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    q = await replace_question(db, exam_id, payload)
    audit(db, user, 'question.create', q.id, after=payload.model_dump())
    return await question_data(db, q, True)


@router.put('/teacher/exams/{exam_id}/questions/order')
async def order_questions(exam_id: str, payload: QuestionOrderInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    before = await reorder_questions(db, exam_id, payload.question_ids)
    audit(db, user, 'question.reorder', exam_id, before={'question_ids': before}, after=payload.model_dump())
    return payload.model_dump()


@router.put('/teacher/exams/{exam_id}/questions/{question_id}')
async def update_question(exam_id: str, question_id: str, payload: QuestionInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    q = await replace_question(db, exam_id, payload, question_id)
    audit(db, user, 'question.update', q.id, after=payload.model_dump())
    return await question_data(db, q, True)


@router.delete('/teacher/exams/{exam_id}/questions/{question_id}')
async def delete_question(exam_id: str, question_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    before = await remove_question(db, exam_id, question_id)
    audit(db, user, 'question.delete', question_id, before=before)
    return {'ok': True}


@router.delete('/teacher/exams/{exam_id}/passages/{passage_id}')
async def delete_passage(exam_id: str, passage_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    before = await remove_passage(db, exam_id, passage_id)
    audit(db, user, 'passage.delete', passage_id, before=before)
    return {'ok': True}


@router.delete('/teacher/exams/{exam_id}')
async def delete_exam(exam_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    exam = await editable_exam(db, exam_id)
    before = await remove_exam(db, exam)
    audit(db, user, 'exam.delete', exam_id, before=before)
    delete_uploads_after_commit(db, exam_id)
    return {'ok': True}


class PublishInput(BaseModel):
    verified: bool


@router.post('/teacher/exams/{exam_id}/publish')
async def publish_exam(exam_id: str, payload: PublishInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    exam = await editable_exam(db, exam_id)
    if not payload.verified:
        raise HTTPException(422, 'Savollar va javoblar qo‘lda tekshirilishi shart')
    questions = (await db.scalars(select(Question).where(Question.exam_id == exam_id).order_by(Question.position))).all()
    if not questions or [q.position for q in questions] != list(range(1, len(questions)+1)):
        raise HTTPException(422, 'Savollar raqami ketma-ket bo‘lishi kerak')
    for q in questions:
        parts = (await db.scalars(select(QuestionPart).where(QuestionPart.question_id == q.id))).all()
        options = (await db.scalars(select(Option).where(Option.question_id == q.id))).all()
        if not parts:
            raise HTTPException(422, 'Savol qismlari yo‘q')
        for part in parts:
            key = await db.get(AnswerKey, part.id)
            if not key or (not key.accepted and not key.manual_review):
                raise HTTPException(422, f'{q.position}-savol kaliti to‘liq emas')
            if options and q.kind in {'single', 'reading', 'image', 'matching'} and any(a not in {o.label for o in options} for a in key.accepted):
                raise HTTPException(422, 'Kalit variantlarga mos emas')
        if q.kind == 'single' and len(options) < 2:
            raise HTTPException(422, 'Test kamida ikkita variantga ega bo‘lishi kerak')
    exam.status = 'published'
    audit(db, user, 'exam.publish', exam_id, after={'verified': True})
    return await exam_data(db, exam)


@router.get('/teacher/attempts')
async def teacher_attempts(exam_id: str | None = None, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await expire_due(db, exam_id=exam_id)
    query = select(Attempt).order_by(Attempt.started_at.desc())
    if exam_id:
        query = query.where(Attempt.exam_id == exam_id)
    output = []
    for a in (await db.scalars(query)).all():
        student = await db.get(User, a.user_id)
        exam = await db.get(Exam, a.exam_id)
        assessed = await db.scalar(select(func.count()).select_from(EssayAssessment).where(EssayAssessment.attempt_id == a.id))
        output.append({'id': a.id, 'exam_id': a.exam_id, 'exam_title': exam.title, 'student_name': student.name,
                       'user_id': student.id, 'status': a.status, 'essay_required': exam.essay_required,
                       'assessed_experts': assessed, 'expert_count': exam.expert_count,
                       'submitted_at': a.submitted_at})
    return output


@router.get('/teacher/attempts/{attempt_id}')
async def teacher_attempt(attempt_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    a = await owned_attempt(db, attempt_id, user, True)
    await expire_if_due(db, a)
    student = await db.get(User, a.user_id)
    assessments = (await db.scalars(select(EssayAssessment).where(EssayAssessment.attempt_id == a.id))).all()
    return {'attempt': await snapshot(db, a), 'student': user_data(student),
            'result': await result_data(db, a, True) if a.status == 'submitted' else None,
            'assessments': [{'teacher_id': s.teacher_id, 'score': s.score, 'converted_score': s.converted_score,
                             'rubric_id': s.rubric_id, 'comment': s.comment, 'graded_at': s.graded_at} for s in assessments]}


@router.put('/teacher/attempts/{attempt_id}/essay-grade')
async def essay_grade(attempt_id: str, payload: EssayGradeInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user, True)
    exam = await db.get(Exam, attempt.exam_id)
    if attempt.status != 'submitted' or not exam.essay_required:
        raise HTTPException(409, 'Bu urinish yozma ish baholashga tayyor emas')
    if exam.results_published:
        raise HTTPException(409, 'Tuzatish uchun administrator natijalarni qaytarib olishi kerak')
    rubric = await db.get(EssayRubric, payload.rubric_id)
    if not rubric:
        raise HTTPException(422, 'Tasdiqlangan rasmiy jadval topilmadi')
    assessments = (await db.scalars(select(EssayAssessment).where(EssayAssessment.attempt_id == attempt_id))).all()
    if any(a.rubric_id != rubric.id for a in assessments):
        raise HTTPException(409, 'Barcha ekspertlar bitta jadval versiyasidan foydalanishi kerak')
    record = next((a for a in assessments if a.teacher_id == user.id), None)
    if not record and len(assessments) >= exam.expert_count:
        raise HTTPException(409, 'Kerakli ekspertlar soni to‘lgan')
    before = {'score': record.score, 'converted_score': record.converted_score, 'comment': record.comment} if record else None
    if not record:
        record = EssayAssessment(attempt_id=attempt_id, teacher_id=user.id, rubric_id=rubric.id)
        db.add(record)
    record.score = payload.score
    record.converted_score = convert_essay(payload.score, rubric.table)
    record.comment = payload.comment
    record.graded_at = now()
    audit(db, user, 'essay.grade', attempt_id, before, {'score': payload.score, 'converted_score': record.converted_score,
                                                     'rubric_id': rubric.id, 'comment': payload.comment})
    await db.flush()
    return {'score': record.score, 'converted_score': record.converted_score, 'teacher_id': user.id, 'graded_at': record.graded_at}


@router.put('/teacher/attempts/{attempt_id}/parts/{part_id}/grade')
async def review_part(attempt_id: str, part_id: str, payload: ReviewInput, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    attempt = await owned_attempt(db, attempt_id, user, True)
    exam = await db.get(Exam, attempt.exam_id)
    if exam.results_published or attempt.status != 'submitted':
        raise HTTPException(409, 'Baholash mumkin emas')
    grade = await db.scalar(select(RawGrade).where(RawGrade.attempt_id == attempt_id, RawGrade.part_id == part_id))
    key = await db.get(AnswerKey, part_id)
    if not grade or not key or not key.manual_review or payload.score > grade.maximum:
        raise HTTPException(422, 'Ruxsat etilmagan ball')
    before = {'score': grade.score, 'status': grade.status}
    grade.score = payload.score
    grade.status = 'correct' if payload.score == grade.maximum else 'incorrect'
    # Existing calibrations no longer represent the corrected response data.
    run_ids = (await db.scalars(select(CalibrationRun.id).where(CalibrationRun.exam_id == exam.id))).all()
    for run_id in run_ids:
        run = await db.get(CalibrationRun, run_id)
        run.approved = False
        run.diagnostics = {**run.diagnostics, 'flags': list(set(run.diagnostics.get('flags', []) + ['response_data_changed']))}
    audit(db, user, 'part.grade', grade.id, before, {'score': payload.score, 'reason': payload.reason})
    return {'ok': True, 'calibrations_invalidated': len(run_ids)}


@router.get('/teacher/rubrics')
async def rubrics(user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    records = (await db.scalars(select(EssayRubric).order_by(EssayRubric.created_at.desc()))).all()
    return [{'id': r.id, 'source_name': r.source_name, 'source_sha256': r.source_sha256, 'table': r.table} for r in records]


@router.post('/admin/rubrics')
async def upload_rubric(source: UploadFile = File(...), table_json: str = Form(...), verified: bool = Form(False),
                        user=Depends(admin), db: AsyncSession = Depends(get_db)):
    content = await source.read(get_settings().max_upload_mb * 1024 * 1024 + 1)
    if not verified or not content.startswith(b'%PDF') or len(content) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(422, 'PDF va qo‘lda tekshirilgan rasmiy jadval talab qilinadi')
    try:
        table = validate_lookup(json.loads(table_json))
    except (ValueError, TypeError):
        raise HTTPException(422, 'Jadvalda 0.0–24.0 oralig‘idagi 49 ta aniq qiymat bo‘lishi shart')
    rubric = EssayRubric(source_name=(source.filename or 'Baholash_mezoni.pdf')[:250],
                         source_sha256=hashlib.sha256(content).hexdigest(), table=table, verified_by=user.id)
    db.add(rubric)
    await db.flush()
    directory = get_settings().upload_dir / 'rubrics'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f'{rubric.id}.pdf').write_bytes(content)
    audit(db, user, 'rubric.verify', rubric.id, after={'source_sha256': rubric.source_sha256, 'table': table})
    return {'id': rubric.id, 'source_sha256': rubric.source_sha256}


@router.post('/teacher/exams/{exam_id}/import/pdf')
async def import_pdf(exam_id: str, file: UploadFile = File(...), ocr: bool = Form(False), user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    maximum = get_settings().max_upload_mb * 1024 * 1024
    content = await file.read(maximum + 1)
    if len(content) > maximum or not content.startswith(b'%PDF'):
        raise HTTPException(422, 'PDF hajmi yoki formati noto‘g‘ri')
    try:
        extracted = await run_in_threadpool(extract_pdf, content, get_settings().upload_dir / exam_id, exam_id, ocr)
    except Exception as exc:
        raise HTTPException(422, 'PDF o‘qilmadi. Shifrlash, sahifalar soni yoki formatni tekshiring') from exc
    doc = ImportDocument(exam_id=exam_id, source_name=(file.filename or 'exam.pdf')[:250],
                         source_sha256=hashlib.sha256(content).hexdigest(), extracted=extracted, created_by=user.id)
    db.add(doc)
    await db.flush()
    (get_settings().upload_dir / exam_id / f'{doc.id}.pdf').write_bytes(content)
    audit(db, user, 'exam.import_pdf', exam_id, after={'document_id': doc.id})
    return {'id': doc.id, 'source_name': doc.source_name, 'extracted': extracted}


@router.get('/teacher/exams/{exam_id}/imports')
async def imports(exam_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    records = (await db.scalars(select(ImportDocument).where(ImportDocument.exam_id == exam_id))).all()
    return [{'id': r.id, 'source_name': r.source_name, 'extracted': r.extracted} for r in records]


@router.post('/teacher/exams/{exam_id}/import/structured')
async def import_structured(exam_id: str, file: UploadFile = File(...), user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await editable_exam(db, exam_id)
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413)
    try:
        if (file.filename or '').lower().endswith('.csv'):
            entries = list(csv.DictReader(io.StringIO(content.decode('utf-8-sig'))))
            for row in entries:
                for key in ('parts', 'options', 'image_paths'):
                    if row.get(key): row[key] = json.loads(row[key])
                    else: row.pop(key, None)
                if not row.get('passage_id'): row.pop('passage_id', None)
        else:
            data = json.loads(content)
            entries = data['questions'] if isinstance(data, dict) else data
        if not 1 <= len(entries) <= 500:
            raise ValueError('Question count')
        validated = [QuestionInput.model_validate(item) for item in entries]
    except (ValueError, TypeError, KeyError):
        raise HTTPException(422, 'JSON/CSV tuzilishi noto‘g‘ri; hujjatdagi sxemani tekshiring')
    output = [await question_data(db, await replace_question(db, exam_id, q), True) for q in validated]
    audit(db, user, 'exam.import_structured', exam_id, after={'count': len(output)})
    return {'questions': output, 'verification_required': True}


@router.get('/assets/{exam_id}/{filename}')
async def asset(exam_id: str, filename: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    if any(x in filename for x in ('..', '/', '\\')) or not filename.endswith('.png'):
        raise HTTPException(404)
    if user.role not in {'teacher', 'admin'}:
        attempt = await db.scalar(select(Attempt).where(Attempt.exam_id == exam_id, Attempt.user_id == user.id))
        if not attempt:
            raise HTTPException(404)
        questions = (await db.scalars(select(Question).where(Question.exam_id == exam_id))).all()
        allowed = {p for q in questions for p in q.image_paths}
        allowed.update((await db.scalars(select(Option.image_path).join(Question, Option.question_id == Question.id)
                                        .where(Question.exam_id == exam_id, Option.image_path.is_not(None)))).all())
        if f'{exam_id}/{filename}' not in allowed:
            raise HTTPException(404)
    await get_exam(db, exam_id)
    path = get_settings().upload_dir / exam_id / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type='image/png', headers={'Cache-Control': 'private, no-store'})


@router.get('/teacher/exams/{exam_id}/statistics')
async def statistics(exam_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await get_exam(db, exam_id)
    attempts = (await db.scalars(select(Attempt).where(Attempt.exam_id == exam_id, Attempt.status == 'submitted'))).all()
    results = [await result_data(db, a, True) for a in attempts]
    percentages = [r['raw_percentage'] for r in results]
    import numpy as np
    return {'participants': len(results), 'mean_percentage': float(np.mean(percentages)) if percentages else None,
            'median_percentage': float(np.median(percentages)) if percentages else None,
            'sd_percentage': float(np.std(percentages)) if percentages else None,
            'pending_parts': sum(r['pending_parts'] for r in results),
            'pending_essays': sum(r['essay_required'] and not r['essay_ready'] for r in results),
            'distribution': [{'attempt_id': r['attempt_id'], 'percentage': r['raw_percentage']} for r in results]}


@router.post('/teacher/exams/{exam_id}/calibrations')
async def run_calibration(exam_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    await get_exam(db, exam_id)
    attempts = (await db.scalars(select(Attempt).where(Attempt.exam_id == exam_id, Attempt.status == 'submitted').order_by(Attempt.id))).all()
    parts = (await db.scalars(select(QuestionPart).join(Question).where(Question.exam_id == exam_id).order_by(QuestionPart.id))).all()
    if len(attempts) > 5000 or len(parts) > 500:
        raise HTTPException(422, 'Katta kalibrlashni CLI/statistik tahlil muhitida bajaring')
    matrix = []
    for a in attempts:
        grades = {g.part_id: g for g in (await db.scalars(select(RawGrade).where(RawGrade.attempt_id == a.id))).all()}
        matrix.append([float('nan') if p.id not in grades or grades[p.id].score is None else grades[p.id].score / grades[p.id].maximum for p in parts])
    try:
        result = await run_in_threadpool(calibrate, matrix)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    run = CalibrationRun(exam_id=exam_id, diagnostics=result['diagnostics'], created_by=user.id)
    db.add(run)
    await db.flush()
    for p, b, se in zip(parts, result['difficulties'], result['standard_errors']):
        db.add(ItemParameter(calibration_id=run.id, part_id=p.id, difficulty=b, standard_error=se))
    audit(db, user, 'calibration.run', run.id, after=result['diagnostics'])
    return {'id': run.id, 'approved': False, 'diagnostics': run.diagnostics}


@router.get('/teacher/exams/{exam_id}/calibrations')
async def calibrations(exam_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    records = (await db.scalars(select(CalibrationRun).where(CalibrationRun.exam_id == exam_id).order_by(CalibrationRun.created_at.desc()))).all()
    return [{'id': r.id, 'approved': r.approved, 'diagnostics': r.diagnostics, 'reference_name': r.reference_name,
             'reference_mean': r.reference_mean, 'reference_sd': r.reference_sd, 'validation_note': r.validation_note} for r in records]


@router.post('/admin/calibrations/{run_id}/approve')
async def approve_calibration(run_id: str, payload: CalibrationApproval, user=Depends(admin), db: AsyncSession = Depends(get_db)):
    run = await db.scalar(select(CalibrationRun).where(CalibrationRun.id == run_id).with_for_update())
    if not run:
        raise HTTPException(404)
    if run.approved:
        raise HTTPException(409, 'Bu versiya allaqachon tasdiqlangan')
    if not run.diagnostics['converged'] or run.diagnostics['flags']:
        raise HTTPException(422, 'Kalibrlash beqaror; diagnostikani tekshiring')
    for key, value in payload.model_dump().items(): setattr(run, key, value)
    run.approved = True
    audit(db, user, 'calibration.approve', run.id, after=payload.model_dump())
    return {'id': run.id, 'approved': True}


@router.post('/teacher/calibrations/{run_id}/score')
async def score_calibration(run_id: str, user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    run = await db.get(CalibrationRun, run_id)
    if not run or not run.approved:
        raise HTTPException(422, 'Tasdiqlangan kalibrlash talab qilinadi')
    attempts = (await db.scalars(select(Attempt).where(Attempt.exam_id == run.exam_id, Attempt.status == 'submitted').with_for_update())).all()
    scored = 0
    for a in attempts:
        if await apply_calibration(db, a, run): scored += 1
    audit(db, user, 'calibration.score', run.id, after={'scored': scored})
    return {'scored': scored, 'total': len(attempts)}


class ReleaseInput(BaseModel):
    results_published: bool
    answer_released: bool = False


@router.post('/admin/exams/{exam_id}/release')
async def release_results(exam_id: str, payload: ReleaseInput, user=Depends(admin), db: AsyncSession = Depends(get_db)):
    exam = await db.scalar(select(Exam).where(Exam.id == exam_id).with_for_update())
    if not exam:
        raise HTTPException(404)
    if payload.answer_released:
        active = await db.scalar(select(func.count()).select_from(Attempt).where(Attempt.exam_id == exam_id, Attempt.status == 'in_progress'))
        if active:
            raise HTTPException(409, 'Faol urinishlar bor; javob kalitini ochib bo‘lmaydi')
        # Closing prevents new students from starting after keys are released.
        exam.status = 'closed'
    exam.results_published = payload.results_published
    exam.answer_released = payload.answer_released
    audit(db, user, 'exam.release', exam_id, after=payload.model_dump())
    return await exam_data(db, exam)


@router.get('/teacher/students')
async def students(user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    return [user_data(u) for u in (await db.scalars(select(User).order_by(User.created_at.desc()))).all()]


@router.patch('/admin/users/{user_id}')
async def change_role(user_id: str, payload: RoleChange, user=Depends(admin), db: AsyncSession = Depends(get_db)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404)
    if user.id == target.id:
        raise HTTPException(422, 'O‘z administrator huquqingizni o‘zgartirmang')
    before = user_data(target)
    target.role, target.active = payload.role, payload.active
    audit(db, user, 'user.update', user_id, before, payload.model_dump())
    return user_data(target)


@router.get('/admin/audit')
async def audit_logs(entity_id: str | None = None, user=Depends(admin), db: AsyncSession = Depends(get_db)):
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(500)
    if entity_id: query = query.where(AuditLog.entity_id == entity_id)
    records = (await db.scalars(query)).all()
    return [{'actor_id': r.actor_id, 'action': r.action, 'entity_id': r.entity_id, 'before': r.before,
             'after': r.after, 'created_at': r.created_at} for r in records]


@router.get('/teacher/exams/{exam_id}/export')
async def export_results(exam_id: str, format: str = 'csv', user=Depends(teacher), db: AsyncSession = Depends(get_db)):
    if format not in {'csv', 'xlsx'}:
        raise HTTPException(422)
    import pandas as pd
    attempts = (await db.scalars(select(Attempt).where(Attempt.exam_id == exam_id, Attempt.status == 'submitted'))).all()
    rows = []
    for a in attempts:
        student = await db.get(User, a.user_id)
        result = await result_data(db, a, True)
        name = student.name
        if name.startswith(('=', '+', '-', '@', '\t', '\r')): name = "'" + name
        rows.append({'Talaba': name, 'Urinish': a.id, 'Xom ball': result['raw_score'], 'Foiz': result['raw_percentage'],
                     'Esse (75)': result['converted_essay_score'], 'T': result['t'], 'Yakuniy': result['final_score'],
                     'Daraja': result['grade'], 'Kalibrlash': result['calibration_id'], 'Holat': 'Norasmiy'})
    frame = pd.DataFrame(rows, columns=['Talaba', 'Urinish', 'Xom ball', 'Foiz', 'Esse (75)', 'T', 'Yakuniy', 'Daraja', 'Kalibrlash', 'Holat'])
    if format == 'csv':
        data = frame.to_csv(index=False).encode('utf-8-sig')
        media = 'text/csv'
    else:
        stream = io.BytesIO()
        frame.to_excel(stream, index=False)
        data = stream.getvalue()
        media = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    return HTTPResponse(data, media_type=media, headers={'Content-Disposition': f'attachment; filename="natijalar.{format}"'})
