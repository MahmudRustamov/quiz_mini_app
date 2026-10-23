import argparse
import asyncio
import fcntl
import logging
from contextlib import contextmanager
from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlsplit

from aiogram import Bot, Dispatcher, Router
from aiogram.exceptions import TelegramNetworkError, TelegramUnauthorizedError
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from app.core.config import get_settings

logger = logging.getLogger(__name__)
router = Router()
dispatcher = Dispatcher()
dispatcher.include_router(router)


@lru_cache
def get_bot():
    return Bot(get_settings().bot_token)


def mini_app_ready(url: str) -> bool:
    """A local HTTP address must never prevent the bot from replying to /start."""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ''
        if parsed.scheme != 'https' or not host or parsed.username or parsed.password:
            return False
        if host == 'localhost' or host.endswith('.localhost'):
            return False
        try:
            return ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


@router.message(CommandStart())
async def start(message: Message):
    settings = get_settings()
    text = 'Milliy Sertifikat sinov platformasiga xush kelibsiz!'
    if message.chat.type != 'private':
        await message.answer(text + '\n\nIlovani ochish uchun botning shaxsiy chatida /start yuboring.')
        return
    if not mini_app_ready(settings.mini_app_url):
        # Telegram rejects the entire sendMessage request if a WebApp button has
        # an HTTP localhost URL. Send a useful welcome without that button.
        text += '\n\nIlova hozir mahalliy sinov rejimida. Telegram ichida ochish hali sozlanmagan.'
        if message.from_user and message.from_user.id in settings.admin_telegram_ids:
            text += '\n\nAdministrator: MINI_APP_URL uchun ochiq HTTPS manzilini kiriting.'
        await message.answer(text)
        return
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text='Ilovani ochish', web_app=WebAppInfo(url=settings.mini_app_url))
    ]])
    await message.answer(text + '\n\nImtihonlarni ilovada boshlang.', reply_markup=keyboard)


@router.message(Command('help', 'support'))
async def help_command(message: Message):
    await message.answer(
        'Testni boshlang, javoblarni belgilang va yakunlang. Yozma ish yoki natija '
        'bo‘yicha o‘qituvchingizga murojaat qiling. /start — ilovani ochish.'
    )


@contextmanager
def polling_lock():
    """Prevent two local copies of this project's bot from consuming updates."""
    directory = Path(__file__).resolve().parents[3] / '.runtime'
    directory.mkdir(exist_ok=True)
    with (directory / 'bot-polling.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Bot boshqa terminalda allaqachon ishlayapti. Faqat bitta bot jarayonini qoldiring.') from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


async def run_command(action: str, url: str | None = None):
    settings = get_settings()
    if not settings.bot_token:
        raise RuntimeError('backend/.env faylida BOT_TOKEN kiritilmagan.')
    if action == 'poll' and settings.bot_mode != 'polling':
        raise RuntimeError('Bot o‘chirilgan. Loyiha ildizidan ./scripts/bot.sh buyrug‘ini bajaring.')
    bot = get_bot()
    try:
        if action in {'check', 'poll'}:
            me = await bot.get_me(request_timeout=15)
            info = await bot.get_webhook_info(request_timeout=15)
            if action == 'check':
                print(f'Telegram ulanishi: OK (@{me.username})')
                print(f'BOT_MODE: {settings.bot_mode}')
                print(f'Webhook: {"o‘rnatilgan" if info.url else "o‘rnatilmagan"}')
                print(f'Kutilayotgan yangilanishlar: {info.pending_update_count}')
                print(f'Mini App HTTPS: {"tayyor" if mini_app_ready(settings.mini_app_url) else "hali sozlanmagan"}')
                return
            if info.url:
                raise RuntimeError(
                    'Webhook o‘rnatilgan; polling boshlanmadi. Mahalliy pollingga o‘tmoqchi '
                    'bo‘lsangiz, avval python -m app.bot.main delete-webhook buyrug‘ini bajaring.'
                )
            with polling_lock():
                logger.info('Bot ishga tushdi: @%s. Telegramda /start yuboring.', me.username)
                if not mini_app_ready(settings.mini_app_url):
                    logger.warning('Mini App HTTPS manzili hali sozlanmagan; /start tugmasiz javob beradi.')
                await dispatcher.start_polling(bot)
        elif action == 'set-webhook':
            if settings.bot_mode != 'webhook' or not url or not url.startswith('https://'):
                raise RuntimeError('BOT_MODE=webhook va --url https://.../bot/webhook talab qilinadi.')
            await bot.set_webhook(url, secret_token=settings.webhook_secret)
            logger.info('Webhook o‘rnatildi.')
        elif action == 'delete-webhook':
            await bot.delete_webhook()
            logger.info('Webhook olib tashlandi.')
        else:
            raise RuntimeError('Noma’lum bot buyrug‘i.')
    finally:
        await bot.session.close()


async def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['poll', 'check', 'set-webhook', 'delete-webhook'])
    parser.add_argument('--url')
    args = parser.parse_args()
    await run_command(args.action, args.url)


def main():
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    try:
        asyncio.run(cli())
    except TelegramUnauthorizedError:
        logger.error('Telegram tokenni qabul qilmadi. BotFather bergan BOT_TOKEN qiymatini tekshiring.')
        raise SystemExit(1) from None
    except TelegramNetworkError:
        logger.error('Telegramga ulanib bo‘lmadi. Internet, VPN yoki tarmoq cheklovini tekshiring.')
        raise SystemExit(1) from None
    except RuntimeError as exc:
        logger.error('%s', str(exc).replace(get_settings().bot_token, '[hidden]') if get_settings().bot_token else str(exc))
        raise SystemExit(1) from None
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
