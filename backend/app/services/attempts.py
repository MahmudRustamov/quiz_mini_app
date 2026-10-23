from sqlalchemy import select
from fastapi import HTTPException
from app.core.auth import aware
from app.models import Attempt, Question, QuestionPart, AnswerKey, Response, RawGrade, AuditLog, now
from app.services.grading import grade_answer


async def submit(db, attempt):
    if attempt.status == 'submitted':
        return attempt
    # All callers hold the attempt lock. A unique (attempt, part) index is the final guard.
    questions = (await db.scalars(select(Question).where(Question.exam_id == attempt.exam_id))).all()
    responses = {r.question_id: r for r in (await db.scalars(select(Response).where(Response.attempt_id == attempt.id))).all()}
    for question in questions:
        response = responses.get(question.id)
        parts = (await db.scalars(select(QuestionPart).where(QuestionPart.question_id == question.id))).all()
        for part in parts:
            key = await db.get(AnswerKey, part.id)
            if not key:
                raise HTTPException(409, 'Javob kaliti mavjud emas')
            answer = response.answers.get(part.label) if response else None
            score, status = grade_answer(answer, key.accepted, part.weight, key.case_sensitive, key.manual_review)
            db.add(RawGrade(attempt_id=attempt.id, part_id=part.id, score=score, maximum=part.weight, status=status))
    attempt.status = 'submitted'
    attempt.submitted_at = now()
    await db.flush()
    return attempt


async def expire_if_due(db, attempt):
    if attempt.status == 'in_progress' and aware(attempt.deadline) <= now():
        await submit(db, attempt)
    return attempt


async def snapshot(db, attempt):
    await expire_if_due(db, attempt)
    responses = (await db.scalars(select(Response).where(Response.attempt_id == attempt.id))).all()
    return {'id': attempt.id, 'exam_id': attempt.exam_id, 'status': attempt.status,
            'started_at': aware(attempt.started_at), 'deadline': aware(attempt.deadline),
            'submitted_at': aware(attempt.submitted_at) if attempt.submitted_at else None,
            'server_now': now(), 'essay_text': attempt.essay_text,
            'responses': [{'question_id': r.question_id, 'answers': r.answers, 'marked': r.marked,
                           'revision': r.revision, 'saved_at': aware(r.saved_at)} for r in responses]}


def audit(db, actor, action, entity, before=None, after=None):
    db.add(AuditLog(actor_id=actor.id, action=action, entity_id=entity, before=before, after=after))
