from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.core.db import engine
from app.api.routes import router


@asynccontextmanager
async def lifespan(app):
    yield
    await engine.dispose()

settings = get_settings()
app = FastAPI(title='Milliy Sertifikat API', version='1.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                   allow_credentials=False, allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
                   allow_headers=['Authorization', 'Content-Type'])
app.include_router(router)


@app.middleware('http')
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.post('/bot/webhook')
async def telegram_webhook(request: Request):
    import hmac
    if settings.bot_mode != 'webhook' or not hmac.compare_digest(request.headers.get('X-Telegram-Bot-Api-Secret-Token', ''), settings.webhook_secret):
        raise HTTPException(403)
    from aiogram.types import Update
    from app.bot.main import get_bot, dispatcher
    bot = get_bot()
    update = Update.model_validate(await request.json(), context={'bot': bot})
    await dispatcher.feed_update(bot, update)
    return {'ok': True}

from app.api.notifications import router as notification_router
app.include_router(notification_router)
