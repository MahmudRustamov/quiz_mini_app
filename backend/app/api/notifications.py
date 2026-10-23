from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from app.core.auth import admin, teacher
from app.core.config import get_settings
from app.core.db import get_db
from app.models import User, Exam
from app.repositories.exams import owned_attempt
from app.services.attempts import audit

router = APIRouter(prefix='/api')


@router.post('/teacher/attempts/{attempt_id}/notify')
async def notify_result(attempt_id: str, user=Depends(teacher), db=Depends(get_db)):
    if not get_settings().bot_token:
        raise HTTPException(503, 'BOT_TOKEN sozlanmagan')
    a = await owned_attempt(db, attempt_id, user, True)
    exam = await db.get(Exam, a.exam_id)
    student = await db.get(User, a.user_id)
    if not exam.results_published or a.status != 'submitted' or student.telegram_id <= 0:
        raise HTTPException(422, 'Natija yoki Telegram hisobi tayyor emas')
    from app.bot.main import get_bot
    try:
        await get_bot().send_message(student.telegram_id, f'{exam.title}: natijalaringiz e’lon qilindi. Ilovani oching: {get_settings().mini_app_url}')
    except Exception as exc:
        raise HTTPException(502, 'Telegram xabari yuborilmadi') from exc
    audit(db, user, 'notification.result', a.id)
    return {'sent': True}


class Announcement(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=3000)


@router.post('/admin/announcements')
async def announcement(payload: Announcement, user=Depends(admin), db=Depends(get_db)):
    if not get_settings().bot_token:
        raise HTTPException(503, 'BOT_TOKEN sozlanmagan')
    from app.bot.main import get_bot
    students = (await db.scalars(select(User).where(User.id.in_(payload.user_ids), User.active.is_(True)))).all()
    sent, failed = 0, 0
    for student in students:
        if student.telegram_id <= 0:
            failed += 1
            continue
        try:
            await get_bot().send_message(student.telegram_id, payload.text)
            sent += 1
        except Exception:
            failed += 1
    audit(db, user, 'notification.announcement', user.id, after={'sent': sent, 'failed': failed})
    return {'sent': sent, 'failed': failed}
