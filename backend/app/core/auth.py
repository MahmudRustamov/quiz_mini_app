import hashlib
import hmac
import json
import secrets
import time
from datetime import timedelta, timezone
from urllib.parse import parse_qsl
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.core.db import get_db
from app.models import AuthSession, User, now

bearer = HTTPBearer(auto_error=False)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

def validate_init_data(raw: str, token: str, max_age: int = 300) -> dict:
    pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
    values = dict(pairs)

    if len(values) != len(pairs) or not token:
        raise ValueError("Invalid initData")

    received_hash = values.pop("hash", "")

    if not received_hash:
        raise ValueError("Missing hash")

    data_check_string = "\n".join(
        f"{key}={value}"
        for key, value in sorted(values.items())
    )

    secret_key = hmac.new(
        b"WebAppData",
        token.encode(),
        hashlib.sha256
    ).digest()

    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(received_hash, expected_hash):
        raise ValueError("Invalid signature")

    try:
        auth_date = int(values["auth_date"])
        user = json.loads(values["user"])
    except (KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid Telegram data") from exc

    age = time.time() - auth_date

    if age < -30 or age > max_age:
        raise ValueError("Expired initData")

    if (
        not isinstance(user, dict)
        or type(user.get("id")) is not int
        or user["id"] <= 0
    ):
        raise ValueError("Invalid user")

    return user

async def create_session(db: AsyncSession, user: User):
    token = secrets.token_urlsafe(48)
    expires = now() + timedelta(minutes=get_settings().session_minutes)
    db.add(AuthSession(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user.id, expires_at=expires))
    return {'access_token': token, 'token_type': 'bearer', 'expires_at': expires}


async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: AsyncSession = Depends(get_db)):
    if not credentials:
        raise HTTPException(401, 'Tizimga kiring')
    session = await db.get(AuthSession, hashlib.sha256(credentials.credentials.encode()).hexdigest())
    if not session or aware(session.expires_at) <= now():
        raise HTTPException(401, 'Sessiya muddati tugadi')
    user = await db.get(User, session.user_id)
    if not user or not user.active:
        raise HTTPException(403, 'Kirish cheklangan')
    return user


def require_roles(*roles):
    async def dependency(user: User = Depends(current_user)):
        if user.role not in roles:
            raise HTTPException(403, 'Bu amal uchun ruxsat yo‘q')
        return user
    return dependency


teacher = require_roles('teacher', 'admin')
admin = require_roles('admin')
