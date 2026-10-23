from fastapi import HTTPException
from sqlalchemy import select, func, delete
from app.models import Exam, Question, Option, QuestionPart, AnswerKey, Passage, Attempt, Response, User


async def get_exam(db, exam_id):
    exam = await db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(404, 'Imtihon topilmadi')
    return exam


async def owned_attempt(db, attempt_id, user, allow_teacher=False):
    attempt = await db.scalar(select(Attempt).where(Attempt.id == attempt_id).with_for_update())
    if not attempt or (attempt.user_id != user.id and not (allow_teacher and user.role in {'teacher', 'admin'})):
        raise HTTPException(404, 'Urinish topilmadi')
    return attempt


async def editable_exam(db, exam_id):
    exam = await db.scalar(select(Exam).where(Exam.id == exam_id).with_for_update())
    if not exam:
        raise HTTPException(404, 'Imtihon topilmadi')
    count = await db.scalar(select(func.count()).select_from(Attempt).where(Attempt.exam_id == exam_id))
    if count or exam.status != 'draft':
        raise HTTPException(409, 'Faqat hali boshlanmagan qoralamani tahrirlash mumkin')
    return exam


async def question_data(db, question, include_keys=False):
    options = (await db.scalars(select(Option).where(Option.question_id == question.id).order_by(Option.label))).all()
    parts = (await db.scalars(select(QuestionPart).where(QuestionPart.question_id == question.id).order_by(QuestionPart.label))).all()
    output_parts = []
    for part in parts:
        item = {'id': part.id, 'label': part.label, 'prompt': part.prompt, 'weight': part.weight}
        if include_keys:
            key = await db.get(AnswerKey, part.id)
            item.update({'accepted': key.accepted if key else [], 'case_sensitive': key.case_sensitive if key else False,
                         'manual_review': key.manual_review if key else False})
        output_parts.append(item)
    return {'id': question.id, 'position': question.position, 'kind': question.kind,
            'text': question.text, 'topic': question.topic, 'passage_id': question.passage_id,
            'image_paths': question.image_paths, 'options': [{'label': o.label, 'text': o.text} for o in options],
            'parts': output_parts}


async def exam_data(db, exam, detail=False, keys=False):
    count = await db.scalar(select(func.count()).select_from(Question).where(Question.exam_id == exam.id))
    data = {'id': exam.id, 'title': exam.title, 'subject': exam.subject, 'description': exam.description,
            'duration_minutes': exam.duration_minutes, 'question_count': count, 'status': exam.status,
            'certificate_thresholds': exam.certificate_thresholds, 'essay_required': exam.essay_required, 'expert_count': exam.expert_count,
            'answer_released': exam.answer_released, 'results_published': exam.results_published}
    if detail:
        questions = (await db.scalars(select(Question).where(Question.exam_id == exam.id).order_by(Question.position))).all()
        data['questions'] = [await question_data(db, q, keys) for q in questions]
        passages = (await db.scalars(select(Passage).where(Passage.exam_id == exam.id))).all()
        data['passages'] = [{'id': p.id, 'title': p.title, 'text': p.text} for p in passages]
    return data


async def replace_question(db, exam_id, data, question_id=None):
    if data.passage_id:
        passage = await db.get(Passage, data.passage_id)
        if not passage or passage.exam_id != exam_id:
            raise HTTPException(422, 'Matn shu imtihonga tegishli emas')
    # Assets must be generated in this exam's import directory, never arbitrary URLs or paths.
    for image in data.image_paths:
        if not image.startswith(f'{exam_id}/') or '..' in image or not image.lower().endswith('.png'):
            raise HTTPException(422, 'Rasm manzili noto‘g‘ri')
    duplicate = await db.scalar(select(Question).where(Question.exam_id == exam_id, Question.position == data.position))
    if duplicate and duplicate.id != question_id:
        raise HTTPException(409, 'Bu savol raqami mavjud')
    question = await db.get(Question, question_id) if question_id else None
    if question_id and (not question or question.exam_id != exam_id):
        raise HTTPException(404, 'Savol topilmadi')
    if not question:
        question = Question(exam_id=exam_id)
        db.add(question)
    else:
        parts = (await db.scalars(select(QuestionPart).where(QuestionPart.question_id == question.id))).all()
        for part in parts:
            await db.execute(delete(AnswerKey).where(AnswerKey.part_id == part.id))
        await db.execute(delete(QuestionPart).where(QuestionPart.question_id == question.id))
        await db.execute(delete(Option).where(Option.question_id == question.id))
    for field in ['position', 'kind', 'text', 'topic', 'passage_id', 'image_paths']:
        setattr(question, field, getattr(data, field))
    await db.flush()
    for option in data.options:
        db.add(Option(question_id=question.id, **option.model_dump()))
    for part in data.parts:
        record = QuestionPart(question_id=question.id, label=part.label, prompt=part.prompt, weight=part.weight)
        db.add(record)
        await db.flush()
        db.add(AnswerKey(part_id=record.id, accepted=part.accepted, case_sensitive=part.case_sensitive, manual_review=part.manual_review))
    await db.flush()
    return question
