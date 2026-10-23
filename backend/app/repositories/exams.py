import hashlib
from fastapi import HTTPException
from sqlalchemy import select, func, delete
from app.models import Exam, Question, Option, QuestionPart, AnswerKey, Passage, Attempt, Response, User, ImportDocument


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


def shuffled_options(options, seed):
    """Matching pairs are authored in step, so label order would give the key away.

    Each left-hand part is created beside its own option (p1 with R1, p2 with R2),
    and both are serialized sorted by label. A student could then answer every row
    by position. Ordering on a digest of the attempt id keeps one sitting stable
    across reloads while giving each student a different arrangement.
    """
    return sorted(options, key=lambda o: hashlib.sha256(f'{seed}:{o.label}'.encode()).digest())


async def question_data(db, question, include_keys=False, shuffle_seed=None):
    options = (await db.scalars(select(Option).where(Option.question_id == question.id).order_by(Option.label))).all()
    if shuffle_seed and question.kind == 'matching':
        options = shuffled_options(options, shuffle_seed)
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
            'image_paths': question.image_paths, 'options': [{'label': o.label, 'text': o.text, 'image_path': o.image_path} for o in options],
            'parts': output_parts}


async def exam_data(db, exam, detail=False, keys=False, shuffle_seed=None):
    count = await db.scalar(select(func.count()).select_from(Question).where(Question.exam_id == exam.id))
    data = {'id': exam.id, 'title': exam.title, 'subject': exam.subject, 'description': exam.description,
            'duration_minutes': exam.duration_minutes, 'question_count': count, 'status': exam.status,
            'certificate_thresholds': exam.certificate_thresholds, 'essay_required': exam.essay_required, 'expert_count': exam.expert_count,
            'answer_released': exam.answer_released, 'results_published': exam.results_published}
    if detail:
        questions = (await db.scalars(select(Question).where(Question.exam_id == exam.id).order_by(Question.position))).all()
        data['questions'] = [await question_data(db, q, keys, shuffle_seed) for q in questions]
        passages = (await db.scalars(select(Passage).where(Passage.exam_id == exam.id))).all()
        data['passages'] = [{'id': p.id, 'title': p.title, 'text': p.text} for p in passages]
    return data


async def replace_question(db, exam_id, data, question_id=None):
    if data.passage_id:
        passage = await db.get(Passage, data.passage_id)
        if not passage or passage.exam_id != exam_id:
            raise HTTPException(422, 'Matn shu imtihonga tegishli emas')
    # Assets must be generated in this exam's import directory, never arbitrary URLs or paths.
    for image in [*data.image_paths, *(o.image_path for o in data.options if o.image_path)]:
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


async def reorder_questions(db, exam_id, question_ids):
    questions = (await db.scalars(select(Question).where(Question.exam_id == exam_id).order_by(Question.position))).all()
    before = [q.id for q in questions]
    if len(question_ids) != len(before) or set(question_ids) != set(before):
        raise HTTPException(422, 'Tartib ro‘yxati imtihondagi barcha savollarni bir martadan o‘z ichiga olishi kerak')
    # Clear every final slot before assigning any: PostgreSQL checks uniqueness immediately.
    for question in questions:
        question.position += 1000
    await db.flush()
    by_id = {q.id: q for q in questions}
    for position, question_id in enumerate(question_ids, 1):
        by_id[question_id].position = position
    await db.flush()
    return before


async def remove_questions(db, exam_id, question_id=None):
    ids = select(Question.id).where(Question.exam_id == exam_id)
    if question_id is not None: ids = ids.where(Question.id == question_id)
    parts = select(QuestionPart.id).where(QuestionPart.question_id.in_(ids))
    await db.execute(delete(AnswerKey).where(AnswerKey.part_id.in_(parts)))
    await db.execute(delete(QuestionPart).where(QuestionPart.question_id.in_(ids)))
    await db.execute(delete(Option).where(Option.question_id.in_(ids)))
    await db.execute(delete(Question).where(Question.id.in_(ids)))


async def remove_question(db, exam_id, question_id):
    question = await db.scalar(select(Question).where(Question.id == question_id, Question.exam_id == exam_id))
    if not question:
        raise HTTPException(404, 'Savol topilmadi')
    before = await question_data(db, question, True)
    position = question.position
    await remove_questions(db, exam_id, question_id)
    remaining = (await db.scalars(select(Question).where(Question.exam_id == exam_id, Question.position > position).order_by(Question.position))).all()
    # Flush each ascending move: the unique target slot must already be vacant.
    for item in remaining:
        item.position -= 1
        await db.flush()
    return before


async def remove_passage(db, exam_id, passage_id):
    passage = await db.scalar(select(Passage).where(Passage.id == passage_id, Passage.exam_id == exam_id))
    if not passage:
        raise HTTPException(404, 'Matn topilmadi')
    referenced = await db.scalar(select(Question.id).where(Question.passage_id == passage_id).limit(1))
    if referenced:
        raise HTTPException(409, 'Bu matnga bog‘langan savollar mavjud. Avval ularni o‘chiring yoki boshqa matnga bog‘lang')
    before = {'id': passage.id, 'title': passage.title, 'text': passage.text}
    await db.delete(passage)
    return before


async def remove_exam(db, exam):
    before = await exam_data(db, exam)
    await remove_questions(db, exam.id)
    await db.execute(delete(Passage).where(Passage.exam_id == exam.id))
    await db.execute(delete(ImportDocument).where(ImportDocument.exam_id == exam.id))
    await db.delete(exam)
    await db.flush()
    return before
