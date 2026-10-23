from functools import lru_cache
from pathlib import Path
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    environment: str = 'development'
    database_url: str = 'postgresql+asyncpg://localhost:5432/milliy_sertifikat'
    dev_auth: bool = False
    bot_token: str = ''
    admin_telegram_ids: list[int] = []
    session_minutes: int = 30
    session_absolute_hours: int = 12
    init_data_max_age: int = 300
    cors_origins: list[str] = ['http://localhost:5173', 'http://127.0.0.1:5173']
    mini_app_url: str = 'http://localhost:5173'
    bot_mode: str = 'disabled'
    webhook_secret: str = ''
    upload_dir: Path = Path('../data/uploads')
    max_upload_mb: int = 20

    @model_validator(mode='after')
    def safe_production(self):
        if self.environment not in {'development', 'test', 'production'}:
            raise ValueError('Unknown environment')
        if self.environment == 'production':
            if self.dev_auth or not self.bot_token:
                raise ValueError('Production requires Telegram authentication; DEV_AUTH must be false')
            if not self.database_url.startswith('postgresql+asyncpg://'):
                raise ValueError('Production requires PostgreSQL')
            if not self.mini_app_url.startswith('https://'):
                raise ValueError('Production Mini App URL must use HTTPS')
            if self.bot_mode == 'polling':
                raise ValueError('Use webhook mode in production')
        if self.bot_mode not in {'disabled', 'polling', 'webhook'}:
            raise ValueError('Unknown bot mode')
        if self.bot_mode == 'webhook' and len(self.webhook_secret) < 32:
            raise ValueError('Webhook secret must contain at least 32 characters')
        return self


@lru_cache
def get_settings():
    return Settings()
